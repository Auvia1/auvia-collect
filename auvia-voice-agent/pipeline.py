#pipeline.py
import os
import sys
import json
import time
import math
import datetime
import uuid
import asyncio
import httpx
from pathlib import Path
from dotenv import load_dotenv
from loguru import logger

from pipecat.frames.frames import (
    AudioRawFrame, CancelFrame, EndFrame, Frame, LLMRunFrame, StartFrame, 
    UserStartedSpeakingFrame, TextFrame, TranscriptionFrame
)
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
from tools.vobiz_serializer import VobizFrameSerializer
from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams


load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=True)

# ─── Force Google SDK to use our .env key, not any system-level GOOGLE_API_KEY ──
_gemini_key = os.getenv("GEMINI_API_KEY")
if _gemini_key:
    os.environ["GOOGLE_API_KEY"] = _gemini_key

# ─── Config injected by the Node server via env ───────────────────────────────
CAMPAIGN_ID = os.getenv("AUVIA_CAMPAIGN_ID")
CLINIC_ID = os.getenv("AUVIA_CLINIC_ID")
LEAD_CALLBACK_URL = os.getenv("AUVIA_LEAD_CALLBACK_URL", "http://localhost:5001/api/voice/lead")
BOT_SECRET = os.getenv("AUVIA_BOT_SECRET", "auvia_bot_secret_2025")
CALL_ID = os.getenv("CALL_ID", "")                    

CONTACT_ID     = os.getenv("CONTACT_ID", "")          
CONTACT_NAME   = os.getenv("CONTACT_NAME", "")       
CONTACT_PHONE  = os.getenv("CONTACT_PHONE", "")      
CONTACT_AMOUNT = os.getenv("CONTACT_AMOUNT", "")     
CONTACT_REASON = os.getenv("CONTACT_PAYMENT_REASON", "outstanding balance")  
CLINIC_NAME    = os.getenv("AUVIA_CLINIC_NAME", "Auvia Wellness")  

NODE_PORT = os.getenv("PORT", "5001")


# ─── Conversation transcript collector ───────────────────────────────────────
class ConversationTracker:
    def __init__(self):
        self.turns: list[dict] = []   
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
    if not tracker.turns:
        return {}

    today_str = datetime.date.today().strftime('%A, %B %d, %Y')

    extraction_prompt = f"""You are an AI assistant that extracts structured lead data from voice call transcripts.

Today's date is {today_str}. Use this as the reference date to resolve relative date expressions.

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
  "notes": "any additional notes about the conversation or null",
  "callbackDate": "YYYY-MM-DD formatted callback date if outcome is call_later, else null",
  "callbackTime": "HH:MM:SS formatted callback time if outcome is call_later, else null"
}}"""

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


async def post_lead_to_server(lead_data: dict, tracker: ConversationTracker, recording_url: str | None = None, breakdown: dict | None = None):
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
        "billing": breakdown,
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


# =============================================================================
# 🛡️ DEFENSIVE PROCESSORS
# =============================================================================

class PipecatBugFixProcessor(FrameProcessor):
    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, AudioRawFrame):
            if not hasattr(frame, 'pts'): frame.pts = None
            if not hasattr(frame, 'transport_destination'): frame.transport_destination = None
            if not hasattr(frame, 'id'): frame.id = "fixed-audio-frame-id"
            if not hasattr(frame, 'broadcast_sibling_id'): frame.broadcast_sibling_id = None
        await self.push_frame(frame, direction)

class STTTextCleanerProcessor(FrameProcessor):
    """Filters out short garbage transcriptions caused by background noise."""
    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, TranscriptionFrame):
            stt_raw_text = frame.text.strip().lower()
            
            # 🛡️ STRICTER BACKGROUND CHATTER FILTER
            if len(stt_raw_text) <= 8 and len(stt_raw_text.split()) < 2:
                logger.warning(f"🛡️ Ignored likely background chatter: '{stt_raw_text}'")
                return
            if len(stt_raw_text) <= 2:
                return
                
        await self.push_frame(frame, direction)

class ContextSilenceFilter(FrameProcessor):
    """Swallows stale LLM text right after an interruption to prevent awkward overlaps."""
    def __init__(self):
        super().__init__()
        self.recently_interrupted = False
        self.interruption_time = 0.0

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        if isinstance(frame, UserStartedSpeakingFrame):
            self.recently_interrupted = True
            self.interruption_time = time.time()

        if isinstance(frame, TextFrame) and direction == FrameDirection.DOWNSTREAM:
            # 🛡️ INCREASED GRACE PERIOD: 0.8s
            if self.recently_interrupted and (time.time() - self.interruption_time < 0.8):
                logger.debug("🛡️ Swallowing stray text frame to protect TTS context ID.")
                return

        await super().process_frame(frame, direction)
        await self.push_frame(frame, direction)


class BillingTracker(FrameProcessor):
    def __init__(self, bot_context, session_identifier):
        super().__init__()
        self.tts_char_count = 0
        self.llm_out_tokens = 0
        self.timer_start = time.time()
        self.bot_context = bot_context
        self.session_identifier = session_identifier

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, TextFrame) and direction == FrameDirection.DOWNSTREAM:
            self.tts_char_count += len(frame.text)
            self.llm_out_tokens += len(frame.text) / 4.0
        await self.push_frame(frame, direction)

    def generate_breakdown(self) -> dict:
        duration_seconds = time.time() - self.timer_start
        duration_minutes = duration_seconds / 60.0

        billed_minutes = math.ceil(duration_minutes) if duration_minutes > 0 else 1
        inr_multiplier = 94.94

        telephony_cost = billed_minutes * 0.0071 * inr_multiplier
        stt_cost = billed_minutes * 0.0024 * inr_multiplier
        tts_cost = self.tts_char_count * (0.02 / 1000.0) * inr_multiplier
        llm_cost = self.llm_out_tokens * (0.015 / 1000.0) * inr_multiplier

        total_inr_cost = telephony_cost + stt_cost + tts_cost + llm_cost

        return {
            "duration": duration_seconds,
            "stt_cost": stt_cost,
            "tts_cost": tts_cost,
            "llm_cost": llm_cost,
            "telephony_cost": telephony_cost,
            "total_cost": total_inr_cost,
            "credits_billed": billed_minutes
        }


# ─── Main bot entry point ─────────────────────────────────────────────────────
async def bot(runner_args: RunnerArguments):
    import asyncpg
    from tools.pool import init_tool_db
    from tools.pipecat_tools import register_all_tools, get_tools_schema
    from tools.tenant_config import get_clinic_config

    db_url = os.getenv("DATABASE_URL")
    pool = None
    if db_url:
        logger.info("Initializing database pool for tools...")
        try:
            # 🔧 FIX: Disabled statement cache to prevent PgBouncer crashes
            pool = await asyncpg.create_pool(dsn=db_url, statement_cache_size=0)
            init_tool_db(pool)
        except Exception as e:
            logger.error(f"Failed to initialize database pool: {e}")

    clinic_config = await get_clinic_config(CLINIC_ID) if CLINIC_ID else {}
    db_system_prompt = clinic_config.get("system_prompt", "")

    # 🛡️ STRICTER VAD: Prevents background voices from interrupting the bot
    custom_vad = SileroVADAnalyzer(
        params=VADParams(
            stop_secs=1.2,     
            start_secs=0.8,    
            confidence=0.90    
        )
    )

    transport = await create_transport(
        runner_args,
        {
            "webrtc": lambda: TransportParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
            ),
            "websocket": lambda: FastAPIWebsocketParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
                audio_in_sample_rate=8000,
                audio_out_sample_rate=8000,
                serializer=VobizFrameSerializer(),
                add_wav_header=False,
            ),
        },
    )

    stt = SarvamSTTService(
        api_key=os.getenv("SARVAM_API_KEY"),
        settings=SarvamSTTService.Settings(
            model="saaras:v3",
            high_vad_sensitivity=True,
            vad_signals=True,
        ),
    )

    tts = SmallestTTSService(
        api_key=os.getenv("SMALLEST_API_KEY"),
        output_format="pcm",
        settings=SmallestTTSService.Settings(
            model=SmallestTTSModel.LIGHTNING_V3_1,
            voice="anitha",
        ),
    )

    llm = GoogleLLMService(
        api_key=os.getenv("GEMINI_API_KEY"),
        settings=GoogleLLMService.Settings(
            model="gemini-2.5-flash",
        )
    )
    register_all_tools(llm, CLINIC_ID)

    tracker = ConversationTracker()

    try:
        amount_display = f"₹{float(CONTACT_AMOUNT):,.2f}" if CONTACT_AMOUNT else "an outstanding amount"
    except ValueError:
        amount_display = f"₹{CONTACT_AMOUNT}"

    has_contact = bool(CONTACT_NAME and CONTACT_AMOUNT)

    system_prompt = db_system_prompt
    if not system_prompt:
        logger.warning("⚠️ No system_prompt found in DB. AI may not know how to behave.")
        system_prompt = "You are an AI assistant."

    if has_contact:
        system_prompt = (
            system_prompt
            .replace("{patient_name}", CONTACT_NAME)
            .replace("{amount}", amount_display)
            .replace("{payment_reason}", CONTACT_REASON)
            .replace("{clinic_name}", CLINIC_NAME)
        )
        greeting_instruction = (
            f"The call just connected. Start your workflow by confirming you are speaking with {CONTACT_NAME}."
        )
    else:
        greeting_instruction = (
            f"The call just connected. Greet the caller warmly."
        )

    messages = [
        {"role": "system", "content": system_prompt},
    ]
    context = LLMContext(messages, tools=get_tools_schema())
    context_aggregator = LLMContextAggregatorPair(context)
    
    billing_tracker = BillingTracker(context, CALL_ID)
    bug_fixer = PipecatBugFixProcessor()
    stt_cleaner = STTTextCleanerProcessor()
    silence_filter = ContextSilenceFilter()

    # Pipeline structure with defensive layers woven in
    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            stt_cleaner,          # 🛡️ 1. Drops garbage STT text immediately
            context_aggregator.user(),
            llm,
            silence_filter,       # 🛡️ 2. Swallows stale LLM outputs post-interruption
            billing_tracker,      # 💰 Tracks character count for billing
            tts,
            bug_fixer,            # 🛡️ 3. Ensures audio frames don't drop silently
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
        import re, asyncio
        err_str = str(error)
        is_rate_limit = "429" in err_str or "RESOURCE_EXHAUSTED" in err_str

        if is_rate_limit and not fatal:
            match = re.search(r'retry[^\d]+(\d+(?:\.\d+)?)', err_str, re.IGNORECASE)
            wait_secs = min(float(match.group(1)) if match else 5.0, 30.0)
            logger.warning(f"⚠️  Rate limit hit — retrying in {wait_secs:.0f}s")

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


    has_saved = False

    async def cleanup_and_save_lead(reason: str = "Client disconnected"):
        nonlocal has_saved
        if has_saved:
            return
        has_saved = True
        logger.info(f"Saving recording and extracting lead data ({reason})")

        rec_url = None

        for msg in context.messages:
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
                tracker.add("customer", content)

        if tracker.turns:
            lead_data = await extract_lead_from_transcript(tracker, llm)
            breakdown = billing_tracker.generate_breakdown()
            await post_lead_to_server(lead_data, tracker, recording_url=rec_url, breakdown=breakdown)
        else:
            logger.info("No conversation turns recorded — skipping lead capture")

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        await cleanup_and_save_lead("Client disconnected handler")
        await task.cancel()

    runner = PipelineRunner(handle_sigint=runner_args.handle_sigint)
    try:
        await runner.run(task)
    finally:
        await cleanup_and_save_lead("Pipeline task finished")
        if pool:
            logger.info("Closing database pool...")
            await pool.close()


if __name__ == "__main__":
    from pipecat.runner.run import main
    if len(sys.argv) == 1:
        sys.argv.extend(["-t", "webrtc"])
    main()