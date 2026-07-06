import os
import sys
import json
import time
import wave
import uuid
import asyncio
import httpx
from pathlib import Path
from dotenv import load_dotenv
from loguru import logger
from pipecat.frames.frames import AudioRawFrame, CancelFrame, EndFrame, Frame, LLMRunFrame, StartFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
)
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.services.sarvam.stt import SarvamSTTService
from pipecat.services.google.llm import GoogleLLMService
from pipecat.transports.base_transport import TransportParams
from pipecat.services.smallest.tts import SmallestTTSService, SmallestTTSModel

load_dotenv(override=True)

# ─── Force Google SDK to use our .env key, not any system-level GOOGLE_API_KEY ──
# The google-genai SDK prefers GOOGLE_API_KEY over any explicitly passed api_key
# when GOOGLE_API_KEY is set as a Windows system environment variable.
# By syncing it here, we ensure switching GEMINI_API_KEY in .env always takes effect.
_gemini_key = os.getenv("GEMINI_API_KEY")
if _gemini_key:
    os.environ["GOOGLE_API_KEY"] = _gemini_key


# ─── Config injected by the Node server via env ───────────────────────────────
CAMPAIGN_ID = os.getenv("AUVIA_CAMPAIGN_ID")
CLINIC_ID = os.getenv("AUVIA_CLINIC_ID")
LEAD_CALLBACK_URL = os.getenv("AUVIA_LEAD_CALLBACK_URL", "http://localhost:5001/api/voice/lead")
BOT_SECRET = os.getenv("AUVIA_BOT_SECRET", "auvia_bot_secret_2025")
CALL_ID = os.getenv("CALL_ID", "")                    # existing DB call ID

# ─── Contact-specific data for outbound call ─────────────────────────────────
CONTACT_ID     = os.getenv("CONTACT_ID", "")          # existing DB contact UUID
CONTACT_NAME   = os.getenv("CONTACT_NAME", "")       # e.g. "Ayush Kumar"
CONTACT_PHONE  = os.getenv("CONTACT_PHONE", "")      # e.g. "+9267949726"
CONTACT_AMOUNT = os.getenv("CONTACT_AMOUNT", "")     # e.g. "1.00"
CONTACT_REASON = os.getenv("CONTACT_PAYMENT_REASON", "outstanding balance")  # e.g. "consultation fee"

# ─── Recordings directory ────────────────────────────────────────────────────
RECORDINGS_DIR = Path(__file__).parent / "recordings"
RECORDINGS_DIR.mkdir(exist_ok=True)
NODE_PORT = os.getenv("PORT", "5001")


# ─── Audio recording ───────────────────────────────────────────────────────
class SharedAudioBuffer:
    """A single PCM buffer + WAV writer shared by two AudioTap processors
    (one on the mic path, one on the TTS path).

    Sample rate is auto-detected from the first AudioRawFrame written so
    the WAV header always matches the actual audio, preventing slo-mo/fast-mo
    playback caused by a hardcoded rate mismatch.
    """

    def __init__(self, filepath: str):
        self.filepath = filepath
        self.sample_rate: int = 0   # detected from first frame
        self._buf = bytearray()

    def write(self, data: bytes, sample_rate: int = 0):
        """Append PCM bytes. On the very first call, lock in the sample rate."""
        if self.sample_rate == 0 and sample_rate:
            self.sample_rate = sample_rate
            logger.debug(f"AudioBuffer: locked sample_rate={sample_rate} Hz from first frame")
        self._buf.extend(data)

    def save(self) -> bool:
        if not self._buf:
            logger.warning("AudioBuffer: no audio captured — skipping WAV write")
            return False
        rate = self.sample_rate or 16000   # fallback if no frame ever arrived
        try:
            with wave.open(self.filepath, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)       # 16-bit LE PCM
                wf.setframerate(rate)
                wf.writeframes(bytes(self._buf))
            logger.info(f"AudioBuffer: saved {len(self._buf)/1024:.1f} KB @ {rate} Hz → {self.filepath}")
            return True
        except Exception as e:
            logger.error(f"AudioBuffer: WAV write failed: {e}")
            return False


class AudioTap(FrameProcessor):
    """Lightweight pass-through FrameProcessor that writes AudioRawFrame bytes
    into a SharedAudioBuffer without causing double-push.

    KEY: We do NOT call super().process_frame() — that would auto-forward the frame
    through the base-class internal routing AND StartFrames would double-fire.
    Instead we forward ALL frames manually via push_frame(), and only additionally
    write AudioRawFrames into the buffer.
    """

    def __init__(self, buf: SharedAudioBuffer, label: str = ""):
        super().__init__()
        self._buf = buf
        self._label = label

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        # IMPORTANT: super().process_frame() only updates internal lifecycle state
        # (_started flag etc.) — it does NOT push/forward any frame automatically.
        # push_frame() is ALWAYS the sole mechanism for forwarding frames downstream.
        await super().process_frame(frame, direction)  # update lifecycle state
        if isinstance(frame, AudioRawFrame) and frame.audio:
            # Pass frame.sample_rate so the buffer auto-detects the correct rate
            # on the very first write — prevents slo-mo WAV playback.
            self._buf.write(frame.audio, sample_rate=frame.sample_rate)
        await self.push_frame(frame, direction)  # always forward


# ─── Conversation transcript collector ───────────────────────────────────────
class ConversationTracker:
    """Accumulates the full conversation so we can extract lead info at the end."""

    def __init__(self):
        self.turns: list[dict] = []   # [{ "from": "agent"|"user", "text": str, "at_seconds": float }]
        self.call_start: float = time.time()

    def add(self, speaker: str, text: str):
        self.turns.append({
            "from": speaker,
            "text": text,
            "at_seconds": round(time.time() - self.call_start, 1),
        })

    def duration(self) -> int:
        return int(time.time() - self.call_start)

    def full_text(self) -> str:
        return "\n".join(f"{t['from'].upper()}: {t['text']}" for t in self.turns)


async def extract_lead_from_transcript(tracker: ConversationTracker, llm: GoogleLLMService) -> dict:
    """
    Ask the LLM to extract structured lead data from the conversation transcript.
    Returns a dict with name, phone, amountDue, outcome, sentiment, aiSummary, notes.
    """
    if not tracker.turns:
        return {}

    extraction_prompt = f"""You are an AI assistant that extracts structured lead data from voice call transcripts.

TRANSCRIPT:
{tracker.full_text()}

Extract the following fields from the transcript. If a field was not mentioned, use null.
Respond ONLY with a valid JSON object, no markdown, no explanation:
{{
  "name": "customer full name or null",
  "phone": "phone number mentioned or null",
  "amountDue": numeric amount in rupees or null,
  "paymentContext": "one of: consultation_fee | lab_charges | pharmacy_bill | admission_charges | other",
  "outcome": "one of: paid_now | link_sent | call_later | already_paid | not_interested | other",
  "sentiment": "one of: friendly | happy | neutral | cooperative | frustrated | uncooperative",
  "aiSummary": "1-2 sentence summary of the call outcome",
  "notes": "any additional notes about the conversation or null"
}}"""

    # Use a direct API call for extraction (cheaper than running through full pipeline)
    try:
        from google import genai
        from google.genai import types as genai_types
        client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=extraction_prompt,
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
        )
        raw = response.text.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw.strip())
    except Exception as e:
        logger.warning(f"Lead extraction failed: {e}")
        return {
            "outcome": "other",
            "sentiment": "neutral",
            "aiSummary": "Voice call completed. Lead extraction unavailable.",
            "notes": tracker.full_text()[:500] if tracker.turns else None,
        }


async def post_lead_to_server(lead_data: dict, tracker: ConversationTracker, recording_url: str | None = None):
    """POST extracted lead data to the Node server's /api/voice/lead endpoint."""
    if not CAMPAIGN_ID or not CLINIC_ID:
        logger.warning("AUVIA_CAMPAIGN_ID or AUVIA_CLINIC_ID not set — skipping lead capture")
        return

    payload = {
        "campaignId": CAMPAIGN_ID,
        "clinicId": CLINIC_ID,
        "existingContactId": CONTACT_ID or None,
        "callId": CALL_ID or None,
        "durationSeconds": tracker.duration(),
        "transcript": tracker.turns,
        "recordingUrl": recording_url,
        **lead_data,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                LEAD_CALLBACK_URL,
                json=payload,
                headers={"x-bot-secret": BOT_SECRET},
            )
            if resp.status_code == 200:
                logger.info(f"✅ Lead captured and saved: {resp.json()}")
            else:
                logger.error(f"Lead save failed ({resp.status_code}): {resp.text}")
    except Exception as e:
        logger.error(f"Failed to POST lead to server: {e}")


# ─── Main bot entry point ─────────────────────────────────────────────────────
async def bot(runner_args: RunnerArguments):
    """Main bot entry point configured for pure WebRTC on Windows."""

    transport = await create_transport(
        runner_args,
        {
            "webrtc": lambda: TransportParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
            ),
        },
    )

    # Initialize AI services
    stt = SarvamSTTService(
        api_key=os.getenv("SARVAM_API_KEY"),
        settings=SarvamSTTService.Settings(
            model="saaras:v3",
            # high_vad_sensitivity: Sarvam's built-in VAD fires faster at end-of-speech
            # vad_signals: emits VAD events so the pipeline can react immediately
            # Together these cut response latency from ~15s down to ~1-3s
            high_vad_sensitivity=True,
            vad_signals=True,
        ),
    )

    tts = SmallestTTSService(
        api_key=os.getenv("SMALLEST_API_KEY"),
        output_format="pcm",
        settings=SmallestTTSService.Settings(
            model=SmallestTTSModel.LIGHTNING_V3_1_PRO,
            voice="meher",
        ),
    )

    llm = GoogleLLMService(
        api_key=os.getenv("GEMINI_API_KEY"),
        settings=GoogleLLMService.Settings(
            # gemini-2.5-flash: Has a working free tier on this key (unlike 2.0-flash)
            model="gemini-2.5-flash",
        )
    )

    # ─── Conversation tracker + audio recorder ───────────────────────────
    tracker = ConversationTracker()

    # Each call gets a unique WAV file named by session ID
    session_id = str(uuid.uuid4().hex[:12])
    recording_filename = f"call_{session_id}.wav"
    recording_filepath = str(RECORDINGS_DIR / recording_filename)
    recording_url = f"http://localhost:{NODE_PORT}/recordings/{recording_filename}"

    # Two taps: one before STT (captures raw mic audio = user voice),
    # one after TTS (captures bot synthesized audio).
    # Both write into the SAME shared buffer so the final WAV has the full
    # conversation mixed together (interleaved as they happen).
    # The fixed AudioTap uses push_frame() only (no super() call) which
    # avoids the StartFrame double-push that previously broke STT init.
    audio_buf  = SharedAudioBuffer(filepath=recording_filepath)
    user_tap   = AudioTap(audio_buf, label="user-mic")
    bot_tap    = AudioTap(audio_buf, label="bot-tts")


    # ─── Build the outbound call system prompt using real contact data ──────
    # Format amount nicely
    try:
        amount_display = f"${float(CONTACT_AMOUNT):,.2f}" if CONTACT_AMOUNT else "an outstanding amount"
    except ValueError:
        amount_display = f"${CONTACT_AMOUNT}"

    has_contact = bool(CONTACT_NAME and CONTACT_AMOUNT)

    if has_contact:
        system_prompt = (
            f"You are Meher, a professional and empathetic billing agent calling on behalf of Auvia Wellness. "
            f"You are making an OUTBOUND call to {CONTACT_NAME} regarding their {CONTACT_REASON} of {amount_display}. "
            f"Your ONLY goal is to: "
            f"1) Confirm you are speaking with {CONTACT_NAME}, "
            f"2) Inform them politely about the {CONTACT_REASON} of {amount_display}, "
            f"3) Offer to send a secure SMS/WhatsApp payment link, and "
            f"4) Confirm they received it and thank them. "
            f"Do NOT ask them what they need help with — you already know why you're calling. "
            f"Keep every response to 1-2 short sentences. Be warm, clear, and professional. "
            f"If they ask to call back later, schedule a callback politely and end the call. "
            f"If they have already paid, thank them and close the call."
        )
        greeting_instruction = (
            f"The call just connected. Open with: "
            f"'Hello, this is Auvia Wellness. Am I speaking with {CONTACT_NAME}?' "
            f"Then wait for their confirmation before proceeding."
        )
    else:
        # Fallback: no contact data — generic inbound mode
        system_prompt = (
            "You are Meher, a friendly billing assistant for Auvia Wellness. "
            "Help the caller with any billing questions, capture their name and outstanding amount, "
            "and offer a payment link if appropriate. Keep responses under 2 sentences."
        )
        greeting_instruction = (
            "The call just connected. Greet the caller warmly, introduce yourself as Meher from "
            "Auvia Wellness billing, and ask how you can help them today."
        )

    messages = [
        {"role": "system", "content": system_prompt},
    ]
    context = LLMContext(messages)
    context_aggregator = LLMContextAggregatorPair(context)

    # Pipeline with both user + bot recording taps:
    # user_tap is safe now because AudioTap only calls push_frame() (no super()),
    # which avoids the StartFrame double-push that silenced the bot.
    pipeline = Pipeline(
        [
            transport.input(),
            user_tap,  # ← records raw mic audio (user voice)
            stt,
            context_aggregator.user(),
            llm,
            tts,
            bot_tap,   # ← records bot TTS audio
            transport.output(),
            context_aggregator.assistant(),
        ]
    )

    task = PipelineTask(pipeline)

    greeted = False

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        nonlocal greeted
        if greeted:
            logger.info("Client connected again — ignoring duplicate greeting trigger")
            return
        greeted = True
        logger.info(f"Client connected — outbound call to: {CONTACT_NAME or 'unknown'}")
        tracker.call_start = time.time()
        messages.append({"role": "system", "content": greeting_instruction})
        await task.queue_frames([LLMRunFrame()])


    @transport.event_handler("on_error")
    async def on_error(transport, error, fatal):
        """Handle 429 rate-limit errors gracefully: wait and retry instead of crashing."""
        import re, asyncio
        err_str = str(error)
        is_rate_limit = "429" in err_str or "RESOURCE_EXHAUSTED" in err_str

        if is_rate_limit and not fatal:
            # Parse retry delay from error message (e.g. "retry in 21.7s")
            match = re.search(r'retry[^\d]+(\d+(?:\.\d+)?)', err_str, re.IGNORECASE)
            wait_secs = min(float(match.group(1)) if match else 5.0, 30.0)
            logger.warning(f"⚠️  Rate limit hit — retrying in {wait_secs:.0f}s")

            # Speak a hold message to the caller so the call doesn't go silent
            from pipecat.frames.frames import TTSSpeakFrame
            await task.queue_frames([
                TTSSpeakFrame(text="One moment please, I'll be right with you.")
            ])

            await asyncio.sleep(wait_secs)
            logger.info("Retrying LLM after rate-limit wait...")
            await task.queue_frames([LLMRunFrame()])
        elif fatal:
            logger.error(f"Fatal pipeline error: {error}")
            await task.cancel()



    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("Client disconnected — saving recording and extracting lead data")

        # 1. Finalise the WAV recording from the shared buffer
        saved = audio_buf.save()
        rec_url = recording_url if saved else None
        if rec_url:
            logger.info(f"Recording saved: {rec_url}")

        # 2. Rebuild transcript from LLM context messages (handling both dicts and objects)
        for msg in context.messages:
            # Unpack LLMSpecificMessage wrapper if present
            inner_msg = getattr(msg, "message", msg)

            role = ""
            content = ""

            if isinstance(inner_msg, dict):
                role = inner_msg.get("role", "")
                parts = inner_msg.get("content", "")
                if isinstance(parts, list):
                    content = " ".join(
                        p.get("text", "") if isinstance(p, dict) else getattr(p, "text", "")
                        for p in parts
                    )
                else:
                    content = str(parts)
            else:
                # Handle standard dataclasses/objects
                role = getattr(inner_msg, "role", "")
                parts = getattr(inner_msg, "parts", "")
                if parts:
                    if isinstance(parts, list):
                        parts_list = []
                        for p in parts:
                            if isinstance(p, str):
                                parts_list.append(p)
                            elif isinstance(p, dict):
                                parts_list.append(p.get("text", ""))
                            else:
                                parts_list.append(getattr(p, "text", ""))
                        content = " ".join(parts_list)
                    else:
                        content = str(parts)
                else:
                    content = getattr(inner_msg, "content", "")
                    if not isinstance(content, str):
                        content = str(content)

            role = str(role).strip().lower()
            content = str(content).strip()

            if role == "assistant" and content:
                tracker.add("agent", content)
            elif role == "user" and content:
                tracker.add("user", content)

        # 3. Extract structured lead data then POST to server
        if tracker.turns:
            lead_data = await extract_lead_from_transcript(tracker, llm)
            await post_lead_to_server(lead_data, tracker, recording_url=rec_url)
        else:
            logger.info("No conversation turns recorded — skipping lead capture")

        await task.cancel()

    runner = PipelineRunner(handle_sigint=runner_args.handle_sigint)
    await runner.run(task)


if __name__ == "__main__":
    from pipecat.runner.run import main
    # Force the WebRTC target if no transport type was given explicitly
    if len(sys.argv) == 1:
        sys.argv.extend(["-t", "webrtc"])
    main()