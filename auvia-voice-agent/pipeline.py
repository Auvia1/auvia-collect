# #pipeline.py
# import os
# import sys
# import json
# import time
# import math
# import datetime
# import uuid
# import asyncio
# import httpx
# from pathlib import Path
# from dotenv import load_dotenv
# from loguru import logger

# from pipecat.frames.frames import (
#     Frame, AudioRawFrame, CancelFrame, EndFrame, UserIdleTimeoutUpdateFrame,
#     TextFrame, TranscriptionFrame, TTSStoppedFrame, UserStartedSpeakingFrame,
#     TTSSpeakFrame, TTSUpdateSettingsFrame, FunctionCallInProgressFrame,
#     BotStartedSpeakingFrame, BotStoppedSpeakingFrame, StartFrame
# )
# import re
# from rapidfuzz import process
# from rapidfuzz.fuzz import WRatio

# from pipecat.pipeline.pipeline import Pipeline
# from pipecat.pipeline.runner import PipelineRunner
# from pipecat.pipeline.task import PipelineTask, PipelineParams
# from pipecat.processors.aggregators.llm_context import LLMContext
# from pipecat.processors.aggregators.llm_response_universal import (
#     LLMContextAggregatorPair,
# )
# from pipecat.processors.frame_processor import FrameProcessor, FrameDirection
# from pipecat.runner.types import RunnerArguments
# from pipecat.runner.utils import create_transport
# from pipecat.services.sarvam.stt import SarvamSTTService
# from pipecat.services.google.llm import GoogleLLMService
# from pipecat.transports.base_transport import TransportParams
# from pipecat.services.sarvam.tts import SarvamTTSService
# from tools.vobiz_serializer import VobizFrameSerializer
# from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams

# from pipecat.audio.vad.silero import SileroVADAnalyzer
# from pipecat.audio.vad.vad_analyzer import VADParams

# FILLER_TEXT = {
#     "te-IN": "చూస్తున్నాను",
#     "hi-IN": "जाँच कर रहा हूँ",
#     "en-IN": "Checking",
# }

# HANGUP_TEXT = {
#     "te-IN": "మా సహాయం కోరినందుకు ధన్యవాదాలు.",
#     "hi-IN": "हमसे संपर्क करने के लिए धन्यवाद।",
#     "en-IN": "Thank you for calling.",
# }


# load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=True)

# # ─── Force Google SDK to use our .env key, not any system-level GOOGLE_API_KEY ──
# _gemini_key = os.getenv("GEMINI_API_KEY")
# if _gemini_key:
#     os.environ["GOOGLE_API_KEY"] = _gemini_key

# # ─── Config injected by the Node server via env ───────────────────────────────
# CAMPAIGN_ID = os.getenv("AUVIA_CAMPAIGN_ID")
# CLINIC_ID = os.getenv("AUVIA_CLINIC_ID")
# LEAD_CALLBACK_URL = os.getenv("AUVIA_LEAD_CALLBACK_URL", "http://localhost:5001/api/voice/lead")
# BOT_SECRET = os.getenv("AUVIA_BOT_SECRET", "auvia_bot_secret_2025")
# CALL_ID = os.getenv("CALL_ID", "")                    

# CONTACT_ID     = os.getenv("CONTACT_ID", "")          
# CONTACT_NAME   = os.getenv("CONTACT_NAME", "")       
# CONTACT_PHONE  = os.getenv("CONTACT_PHONE", "")      
# CONTACT_AMOUNT = os.getenv("CONTACT_AMOUNT", "")     
# CONTACT_REASON = os.getenv("CONTACT_PAYMENT_REASON", "outstanding balance")  
# CLINIC_NAME    = os.getenv("AUVIA_CLINIC_NAME", "Auvia Wellness")  

# NODE_PORT = os.getenv("PORT", "5001")


# # ─── Conversation transcript collector ───────────────────────────────────────
# class ConversationTracker:
#     def __init__(self):
#         self.turns: list[dict] = []   
#         self.call_start: float = time.time()

#     def add(self, speaker: str, text: str):
#         self.turns.append({
#             "from": speaker,
#             "text": text,
#             "at_seconds": round(time.time() - self.call_start, 1),
#         })

#     def duration(self) -> int:
#         return int(time.time() - self.call_start)

#     def full_text(self) -> str:
#         return "\n".join(f"{t['from'].upper()}: {t['text']}" for t in self.turns)


# async def extract_lead_from_transcript(tracker: ConversationTracker, llm: GoogleLLMService) -> dict:
#     if not tracker.turns:
#         return {}

#     today_str = datetime.date.today().strftime('%A, %B %d, %Y')

#     extraction_prompt = f"""You are an AI assistant that extracts structured lead data from voice call transcripts.

# Today's date is {today_str}. Use this as the reference date to resolve relative date expressions.

# TRANSCRIPT:
# {tracker.full_text()}

# Extract the following fields from the transcript. If a field was not mentioned, use null.
# Respond ONLY with a valid JSON object, no markdown, no explanation:
# {{
#   "name": "customer full name or null",
#   "phone": "phone number mentioned or null",
#   "amountDue": numeric amount in rupees or null,
#   "paymentContext": "one of: consultation_fee | lab_charges | pharmacy_bill | admission_charges | other",
#   "outcome": "one of: paid_now | link_sent | call_later | already_paid | not_interested | other",
#   "sentiment": "one of: friendly | happy | neutral | cooperative | frustrated | uncooperative",
#   "aiSummary": "1-2 sentence summary of the call outcome",
#   "notes": "any additional notes about the conversation or null",
#   "callbackDate": "YYYY-MM-DD formatted callback date if outcome is call_later, else null",
#   "callbackTime": "HH:MM:SS formatted callback time if outcome is call_later, else null"
# }}"""

#     try:
#         from google import genai
#         from google.genai import types as genai_types
#         client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
#         response = client.models.generate_content(
#             model="gemini-2.5-flash",
#             contents=extraction_prompt,
#             config=genai_types.GenerateContentConfig(
#                 response_mime_type="application/json",
#             ),
#         )
#         raw = response.text.strip()
#         if raw.startswith("```"):
#             raw = raw.split("```")[1]
#             if raw.startswith("json"):
#                 raw = raw[4:]
#         return json.loads(raw.strip())
#     except Exception as e:
#         logger.warning(f"Lead extraction failed: {e}")
#         return {
#             "outcome": "other",
#             "sentiment": "neutral",
#             "aiSummary": "Voice call completed. Lead extraction unavailable.",
#             "notes": tracker.full_text()[:500] if tracker.turns else None,
#         }


# async def post_lead_to_server(lead_data: dict, tracker: ConversationTracker, recording_url: str | None = None, breakdown: dict | None = None):
#     if not CAMPAIGN_ID or not CLINIC_ID:
#         logger.warning("AUVIA_CAMPAIGN_ID or AUVIA_CLINIC_ID not set — skipping lead capture")
#         return

#     payload = {
#         "campaignId": CAMPAIGN_ID,
#         "clinicId": CLINIC_ID,
#         "existingContactId": CONTACT_ID or None,
#         "callId": CALL_ID or None,
#         "durationSeconds": tracker.duration(),
#         "transcript": tracker.turns,
#         "recordingUrl": recording_url,
#         "billing": breakdown,
#         **lead_data,
#     }

#     try:
#         async with httpx.AsyncClient(timeout=10.0) as client:
#             resp = await client.post(
#                 LEAD_CALLBACK_URL,
#                 json=payload,
#                 headers={"x-bot-secret": BOT_SECRET},
#             )
#             if resp.status_code == 200:
#                 logger.info(f"✅ Lead captured and saved: {resp.json()}")
#             else:
#                 logger.error(f"Lead save failed ({resp.status_code}): {resp.text}")
#     except Exception as e:
#         logger.error(f"Failed to POST lead to server: {e}")


# # =============================================================================
# # 🛡️ DEFENSIVE PROCESSORS
# # =============================================================================

# class InitializationBuffer(FrameProcessor):
#     def __init__(self):
#         super().__init__()
#         self.is_started = False
#         self.pre_start_buffer = []

#     async def process_frame(self, frame: Frame, direction: FrameDirection):
#         if isinstance(frame, StartFrame):
#             await super().process_frame(frame, direction)
#             self.is_started = True
#             for buffered_frame in self.pre_start_buffer:
#                 await self.push_frame(buffered_frame, direction)
#             self.pre_start_buffer.clear()
#             await self.push_frame(frame, direction)
#             return

#         if not self.is_started:
#             if isinstance(frame, AudioRawFrame):
#                 self.pre_start_buffer.append(frame)
#             return

#         await super().process_frame(frame, direction)
#         await self.push_frame(frame, direction)

# class EchoImmunityFilter(FrameProcessor):
#     def __init__(self):
#         super().__init__()
#         self.bot_is_speaking = False

#     async def process_frame(self, frame: Frame, direction: FrameDirection):
#         try:
#             await super().process_frame(frame, direction)
#         except Exception as e:
#             if "StartFrame not received" in str(e): return
#             raise e
        
#         if isinstance(frame, BotStartedSpeakingFrame):
#             self.bot_is_speaking = True
#         elif isinstance(frame, BotStoppedSpeakingFrame):
#             self.bot_is_speaking = False

#         if isinstance(frame, UserStartedSpeakingFrame) and direction == FrameDirection.DOWNSTREAM:
#             if self.bot_is_speaking:
#                 logger.debug("🛡️ Shield Active: Swallowed VAD interruption (Backchannel/Noise).")
#                 return 

#         try:
#             await self.push_frame(frame, direction)
#         except Exception as e:
#             if "StartFrame not received" not in str(e): raise e

# class STTTextCleanerProcessor(FrameProcessor):
#     def __init__(self, session_identifier, clinic_id, db_pool=None, lang_processor=None):
#         super().__init__()
#         self.session_identifier = session_identifier
#         self.clinic_id = clinic_id
#         self.db_pool = db_pool
#         self.lang_processor = lang_processor
#         self.bot_is_speaking = False
        
#         self.lexicon_fixes = {
#             "పార్లమెంట్": "అపాయింట్మెంట్", "apartment": "appointment",
#             "అపార్ట్మెంట్": "అపాయింట్మెంట్", "తెలుగు": "telugu", "hindi": "hindi"
#         }
        
#         self.grunts = {"hmm", "hm", "hmmm", "ha", "haa", "ah", "ahh", "uh", "um", "oh", "हम्म", "ओह", "ఉం", "ఆ"}
#         self.backchannels = {"ok", "okay", "yeah", "yes", "yep", "हां", "जी", "अच्छा", "ఓకే", "అవును", "సరే"}
        
#         self._cached_doctors = []
#         self._doctors_fetched = False

#     async def _get_active_doctors(self) -> list:
#         if self._doctors_fetched: return self._cached_doctors
#         if not self.db_pool or not self.clinic_id: return []
#         try:
#             async with self.db_pool.acquire() as conn:
#                 records = await conn.fetch("SELECT DISTINCT LOWER(name) as name FROM doctors WHERE clinic_id = $1::uuid AND is_active = TRUE AND deleted_at IS NULL", self.clinic_id)
#                 self._cached_doctors = [r['name'] for r in records if r['name']]
#                 self._doctors_fetched = True
#                 return self._cached_doctors
#         except Exception:
#             return self._cached_doctors

#     async def process_frame(self, frame: Frame, direction: FrameDirection):
#         try:
#             await super().process_frame(frame, direction)
#         except Exception as e:
#             if "StartFrame not received" in str(e): return
#             raise e
        
#         if isinstance(frame, BotStartedSpeakingFrame):
#             self.bot_is_speaking = True
#         elif isinstance(frame, BotStoppedSpeakingFrame):
#             self.bot_is_speaking = False

#         if isinstance(frame, TranscriptionFrame):
#             stt_raw_text = frame.text.strip().lower()
#             clean_text = re.sub(r'[^\w\s\u0900-\u097F\u0C00-\u0C7F]', '', stt_raw_text).strip()
            
#             if self.bot_is_speaking:
#                 if len(clean_text) <= 2 or clean_text in self.grunts or clean_text in self.backchannels:
#                     logger.debug(f"🗑️ Dropped mid-sentence backchannel: '{stt_raw_text}'")
#                     return
#             else:
#                 if len(clean_text) <= 1 or clean_text in self.grunts:
#                     logger.debug(f"🗑️ Dropped ambient grunt: '{stt_raw_text}'")
#                     return

#             logger.info(f"[{self.session_identifier}] 🎤 USER SAID: {stt_raw_text}")

#             active_locale = self.lang_processor.active_locale if self.lang_processor else "en-IN"
#             filler_text = FILLER_TEXT.get(active_locale, FILLER_TEXT["en-IN"])
#             try:
#                 await self.push_frame(TTSSpeakFrame(text=filler_text), direction)
#             except Exception: pass

#             for wrong_val, right_val in self.lexicon_fixes.items():
#                 stt_raw_text = stt_raw_text.replace(wrong_val, right_val)

#             active_doctors = await self._get_active_doctors()
#             if active_doctors:
#                 tokens = stt_raw_text.split()
#                 for token in tokens:
#                     match = process.extractOne(token, active_doctors, scorer=WRatio)
#                     if match:
#                         matched_name, score, _ = match
#                         if score > 82:
#                             script_pattern = r'[\u0c00-\u0c7f\u0900-\u097f]'
#                             token_has_script = bool(re.search(script_pattern, token))
#                             match_has_script = bool(re.search(script_pattern, matched_name))
#                             if token_has_script == match_has_script:
#                                 stt_raw_text = stt_raw_text.replace(token, matched_name)
#             frame.text = stt_raw_text
                
#         try:
#             await self.push_frame(frame, direction)
#         except Exception as e:
#             if "StartFrame not received" not in str(e): raise e

# class AutoLanguageProcessor(FrameProcessor):
#     def __init__(self, session_identifier, greeting_text: str = ""):
#         super().__init__()
#         self.session_identifier = session_identifier
#         self.active_locale = self._detect_locale(greeting_text, strict=False) or "en-IN"

#     def _detect_locale(self, text: str, strict: bool = True):
#         if not text: return None
#         telugu_chars = re.findall(r'[\u0c00-\u0c7f]', text)
#         hindi_chars = re.findall(r'[\u0900-\u097f]', text)
#         if not strict:
#             if telugu_chars: return "te-IN"
#             if hindi_chars: return "hi-IN"
#             return "en-IN"
#         if len(telugu_chars) >= 4: return "te-IN"
#         if len(hindi_chars) >= 4: return "hi-IN"
#         if not telugu_chars and not hindi_chars: return "en-IN"
#         return None

#     async def process_frame(self, frame: Frame, direction: FrameDirection):
#         try:
#             await super().process_frame(frame, direction)
#         except Exception as e:
#             if "StartFrame not received" in str(e): return
#             raise e
        
#         if isinstance(frame, TextFrame):
#             ai_spoken_text = frame.text.lower().strip()
#             detected_locale = self._detect_locale(ai_spoken_text, strict=True)
#             if detected_locale and detected_locale != self.active_locale:
#                 self.active_locale = detected_locale
#                 try:
#                     await self.push_frame(TTSUpdateSettingsFrame(delta=SarvamTTSService.Settings(
#                         voice="ritu",
#                         language=detected_locale,
#                         pace=1.0
#                     )), direction)
#                 except Exception as ex: 
#                     logger.error(f"Failed to push language update frame: {ex}")

#         if isinstance(frame, FunctionCallInProgressFrame):
#             time_filler_text = ""
#             if frame.function_name == "voice_agent_book_appointment":
#                 time_filler_text = "ఒక్క నిమిషం" if self.active_locale == "te-IN" else "एक मिनट" if self.active_locale == "hi-IN" else "One moment"
#             if time_filler_text:
#                 try:
#                     await self.push_frame(TTSSpeakFrame(text=time_filler_text), direction)
#                 except Exception: pass

#         try:
#             await self.push_frame(frame, direction)
#         except Exception as e:
#             if "StartFrame not received" not in str(e): raise e

# class CallEndingProcessor(FrameProcessor):
#     def __init__(self, task_pipeline):
#         super().__init__()
#         self.task_pipeline = task_pipeline
#         self.call_ending = False

#     async def process_frame(self, frame: Frame, direction: FrameDirection):
#         try:
#             await super().process_frame(frame, direction)
#         except Exception as e:
#             if "StartFrame not received" in str(e): return
#             raise e
        
#         if isinstance(frame, TextFrame) and direction == FrameDirection.DOWNSTREAM:
#             cleaned_text = frame.text.strip().lower()
#             is_goodbye = ("ధన్యవాదాలు" in cleaned_text or "thank you for calling" in cleaned_text or "धन्यवाद" in cleaned_text)
#             if is_goodbye and len(cleaned_text) < 60:
#                 self.call_ending = True

#         if isinstance(frame, TTSStoppedFrame) and self.call_ending:
#             asyncio.create_task(self.task_pipeline.cancel())

#         try:
#             await self.push_frame(frame, direction)
#         except Exception as e:
#             if "StartFrame not received" not in str(e): raise e

# class BillingTracker(FrameProcessor):
#     def __init__(self, bot_context, session_identifier):
#         super().__init__()
#         self.tts_char_count = 0
#         self.llm_out_tokens = 0
#         self.timer_start = time.time()
#         self.bot_context = bot_context
#         self.session_identifier = session_identifier

#     async def process_frame(self, frame: Frame, direction: FrameDirection):
#         try:
#             await super().process_frame(frame, direction)
#         except Exception as e:
#             if "StartFrame not received" in str(e): return
#             raise e
        
#         if isinstance(frame, TextFrame) and direction == FrameDirection.DOWNSTREAM:
#             self.tts_char_count += len(frame.text)
#             self.llm_out_tokens += len(frame.text) / 4.0
            
#         try:
#             await self.push_frame(frame, direction)
#         except Exception as e:
#             if "StartFrame not received" not in str(e): raise e

#     def generate_breakdown(self) -> dict:
#         duration_seconds = time.time() - self.timer_start
#         duration_minutes = duration_seconds / 60.0
#         billed_minutes = math.ceil(duration_minutes) if duration_minutes > 0 else 1
#         inr_multiplier = 94.94
        
#         telephony_cost = billed_minutes * 0.65
#         stt_cost = duration_minutes * 0.50
#         recording_cost = billed_minutes * 0.10
        
#         # ✅ Corrected: Updated pricing (₹30 per 10k chars = ₹0.003/char)
#         tts_cost = self.tts_char_count * 0.003

#         messages_json = json.dumps(self.bot_context.messages)
#         llm_in_tokens = int(len(messages_json) / 4.0)
#         llm_out_tokens = int(self.llm_out_tokens)
#         llm_in_cost = (llm_in_tokens * (0.30 / 1_000_000)) * inr_multiplier
#         llm_out_cost = (llm_out_tokens * (1.05 / 1_000_000)) * inr_multiplier

#         whatsapp_msg_count = 0
#         for msg in self.bot_context.messages:
#             if msg.get("role") == "user" and "parts" in msg:
#                 for part in msg["parts"]:
#                     if "function_response" in part:
#                         func_resp = part["function_response"]
#                         if func_resp.get("name") == "voice_agent_book_appointment":
#                             resp_data = func_resp.get("response", {})
#                             if isinstance(resp_data, str):
#                                 try: resp_data = json.loads(resp_data)
#                                 except: pass
#                             if isinstance(resp_data, dict) and resp_data.get("status") == "success":
#                                 whatsapp_msg_count += 1

#         whatsapp_cost = whatsapp_msg_count * 0.20
#         total_cost = stt_cost + tts_cost + llm_in_cost + llm_out_cost + telephony_cost + whatsapp_cost + recording_cost
        
#         return {
#             "duration_seconds": round(duration_seconds, 2), 
#             "duration_minutes": round(duration_minutes, 2),
#             "billed_minutes": billed_minutes, 
#             "stt_cost": round(stt_cost, 4), 
#             "stt_provider": "Sarvam",
#             "tts_cost": round(tts_cost, 4), 
#             "tts_provider": "Sarvam AI", # ✅ Updated provider name
#             "tts_chars": self.tts_char_count,
#             "llm_in_cost": round(llm_in_cost, 4), 
#             "llm_in_tokens": llm_in_tokens,
#             "llm_out_cost": round(llm_out_cost, 4), 
#             "llm_out_tokens": llm_out_tokens,
#             "telephony_cost": round(telephony_cost, 4), 
#             "telephony_provider": "Vobiz",
#             "whatsapp_cost": round(whatsapp_cost, 4), 
#             "whatsapp_msg_type": "Utility Msg" if whatsapp_msg_count > 0 else "None",
#             "other_cost": round(recording_cost, 4), 
#             "total_cost": round(total_cost, 4),
#             "cost_per_minute": round(total_cost / max(duration_minutes, 1.0), 4)
#         }

# class PipecatBugFixProcessor(FrameProcessor):
#     async def process_frame(self, frame: Frame, direction: FrameDirection):
#         try:
#             await super().process_frame(frame, direction)
#         except Exception as e:
#             if "StartFrame not received" in str(e): return
#             raise e
        
#         if isinstance(frame, AudioRawFrame):
#             frame.pts = getattr(frame, 'pts', None)
#             frame.transport_destination = getattr(frame, 'transport_destination', None)
#             frame.id = getattr(frame, 'id', str(uuid.uuid4()))
#             frame.broadcast_sibling_id = getattr(frame, 'broadcast_sibling_id', None)
            
#         try:
#             await self.push_frame(frame, direction)
#         except Exception as e:
#             if "StartFrame not received" not in str(e): raise e


# # ─── Main bot entry point ─────────────────────────────────────────────────────
# async def bot(runner_args: RunnerArguments):
#     import asyncpg
#     from tools.pool import init_tool_db
#     from tools.pipecat_tools import register_all_tools, get_tools_schema
#     from tools.tenant_config import get_clinic_config

#     db_url = os.getenv("DATABASE_URL")
#     pool = None
#     async def init_db_in_background():
#         nonlocal pool
#         if db_url:
#             logger.info("Initializing database pool for tools...")
#             try:
#                 # 🔧 FIX: Disabled statement cache to prevent PgBouncer crashes
#                 pool = await asyncpg.create_pool(dsn=db_url, statement_cache_size=0)
#                 init_tool_db(pool)
#                 logger.info("✅ Database pool initialized.")
#             except Exception as e:
#                 logger.error(f"Failed to initialize database pool: {e}")
                
#     # 🛑 CRITICAL FIX: Await the DB connection directly so the prompt fetches correctly
#     await init_db_in_background()

#     clinic_config = await get_clinic_config(CLINIC_ID) if CLINIC_ID else {}
#     db_system_prompt = clinic_config.get("system_prompt", "") or os.getenv("AUVIA_SYSTEM_PROMPT", "")

#     # 🛡️ RESPONSIVE VAD: Tuned for mobile networks (e.g., Jio SIM) to prevent breaking
#         # ⚡ FAST VAD: Tuned for instant pickup
#     custom_vad = SileroVADAnalyzer(
#         params=VADParams(
#             stop_secs=0.8,     # Speak slightly faster (800ms silence to trigger AI)
#             start_secs=0.1,    # Pick up speech in 100ms so quick "Yes" or "Hello" isn't missed
#             confidence=0.5     # Lowered confidence so faint/quick voices aren't ignored
#         )
#     )

#     transport = await create_transport(
#         runner_args,
#         {
#             "webrtc": lambda: TransportParams(
#                 audio_in_enabled=True,
#                 audio_out_enabled=True,
#                 vad=custom_vad,
#             ),
#             "websocket": lambda: FastAPIWebsocketParams(
#                 audio_in_enabled=True,
#                 audio_out_enabled=True,
#                 audio_in_sample_rate=8000,
#                 audio_out_sample_rate=8000,
#                 serializer=VobizFrameSerializer(),
#                 add_wav_header=False,
#                 vad=custom_vad,
#             ),
#         },
#     )

#     stt = SarvamSTTService(
#         api_key=os.getenv("SARVAM_API_KEY"),
#         sample_rate=8000,
#         settings=SarvamSTTService.Settings(
#             model="saaras:v3",
#             high_vad_sensitivity=True,
#             vad_signals=True,
#         ),
#     )

#     tts = SarvamTTSService(
#         api_key=os.getenv("SARVAM_API_KEY"),
#         sample_rate=8000,
#         settings=SarvamTTSService.Settings(
#             model="bulbul:v3",
#             voice="ritu",
#         ),
#     )

#     llm = GoogleLLMService(
#         api_key=os.getenv("GEMINI_API_KEY"),
#         settings=GoogleLLMService.Settings(
#             model="gemini-2.5-flash",
#         )
#     )
#     register_all_tools(llm, CLINIC_ID)

#     tracker = ConversationTracker()

#     try:
#         amount_display = f"₹{float(CONTACT_AMOUNT):,.2f}" if CONTACT_AMOUNT else "an outstanding amount"
#     except ValueError:
#         amount_display = f"₹{CONTACT_AMOUNT}"

#     has_contact = bool(CONTACT_NAME and CONTACT_AMOUNT)

#     system_prompt = db_system_prompt
#     if not system_prompt:
#         logger.warning("⚠️ No system_prompt found in DB. AI may not know how to behave.")
#         system_prompt = "You are an AI assistant."

#     if has_contact:
#         system_prompt = (
#             system_prompt
#             .replace("{patient_name}", CONTACT_NAME)
#             .replace("{amount}", amount_display)
#             .replace("{payment_reason}", CONTACT_REASON)
#             .replace("{clinic_name}", CLINIC_NAME)
#         )
#         greeting_instruction = (
#             f"The call just connected. Start your workflow by confirming you are speaking with {CONTACT_NAME}."
#         )
#     else:
#         greeting_instruction = (
#             f"The call just connected. Greet the caller warmly."
#         )

#     if CONTACT_NAME:
#         greeting_text = f"Hello, am I speaking with {CONTACT_NAME}?"
#     else:
#         greeting_text = "Hello, how can I help you today?"

#     messages = [
#         {"role": "system", "content": system_prompt},
#     ]
#     context = LLMContext(messages, tools=get_tools_schema())
#     context_aggregator = LLMContextAggregatorPair(context)
    
#     lang_processor = AutoLanguageProcessor(CALL_ID, greeting_text)
#     billing_tracker = BillingTracker(context, CALL_ID)
#     bug_fixer = PipecatBugFixProcessor()
#     stt_cleaner = STTTextCleanerProcessor(CALL_ID, CLINIC_ID, pool, lang_processor)
#     initialization_buffer = InitializationBuffer()
#     echo_shield = EchoImmunityFilter()
#     call_ender = CallEndingProcessor(task_pipeline=None)

#     # Pipeline structure with defensive layers woven in
#     pipeline = Pipeline(
#         [
#             transport.input(),
#             initialization_buffer,
#             stt,
#             stt_cleaner,
#             echo_shield,
#             context_aggregator.user(),
#             llm,
#             billing_tracker,
#             lang_processor,
#             tts,
#             call_ender,
#             bug_fixer,
#             transport.output(),
#             context_aggregator.assistant(),
#         ]
#     )

#     # 🎧 CRITICAL FIX: Forces Pipecat to process audio at the correct 8000Hz telephony rate
#     task = PipelineTask(
#         pipeline,
#         params=PipelineParams(
#             audio_in_sample_rate=8000,
#             audio_out_sample_rate=8000
#         )
#     )

#     call_ender.task_pipeline = task

#     greeted = False

#     @transport.event_handler("on_client_connected")
#     async def on_client_connected(transport, client):
#         nonlocal greeted
#         if greeted:
#             logger.info("Client connected again — ignoring duplicate greeting trigger")
#             return
#         greeted = True
#         logger.info(f"Client connected — outbound call to: {CONTACT_NAME or 'unknown'}")
#         tracker.call_start = time.time()
        
#         # Send immediately and let Pipecat auto-append it to the LLM context
#         await task.queue_frames([TTSSpeakFrame(text=greeting_text, append_to_context=True)])


#     @transport.event_handler("on_error")
#     async def on_error(transport, error, fatal):
#         import re, asyncio
#         err_str = str(error)
#         is_rate_limit = "429" in err_str or "RESOURCE_EXHAUSTED" in err_str

#         if is_rate_limit and not fatal:
#             match = re.search(r'retry[^\d]+(\d+(?:\.\d+)?)', err_str, re.IGNORECASE)
#             wait_secs = min(float(match.group(1)) if match else 5.0, 30.0)
#             logger.warning(f"⚠️  Rate limit hit — retrying in {wait_secs:.0f}s")

#             from pipecat.frames.frames import TTSSpeakFrame
#             await task.queue_frames([
#                 TTSSpeakFrame(text="One moment please, I'll be right with you.")
#             ])

#             await asyncio.sleep(wait_secs)
#             logger.info("Retrying LLM after rate-limit wait...")
#             await task.queue_frames([LLMRunFrame()])
#         elif fatal:
#             logger.error(f"Fatal pipeline error: {error}")
#             await task.cancel()


#     has_saved = False

#     async def cleanup_and_save_lead(reason: str = "Client disconnected"):
#         nonlocal has_saved
#         if has_saved:
#             return
#         has_saved = True
#         logger.info(f"Saving recording and extracting lead data ({reason})")

#         rec_url = None

#         for msg in context.messages:
#             inner_msg = getattr(msg, "message", msg)
#             role = ""
#             content = ""

#             if isinstance(inner_msg, dict):
#                 role = inner_msg.get("role", "")
#                 parts = inner_msg.get("content", "")
#                 if isinstance(parts, list):
#                     content = " ".join(
#                         p.get("text", "") if isinstance(p, dict) else getattr(p, "text", "")
#                         for p in parts
#                     )
#                 else:
#                     content = str(parts)
#             else:
#                 role = getattr(inner_msg, "role", "")
#                 parts = getattr(inner_msg, "parts", "")
#                 if parts:
#                     if isinstance(parts, list):
#                         parts_list = []
#                         for p in parts:
#                             if isinstance(p, str):
#                                 parts_list.append(p)
#                             elif isinstance(p, dict):
#                                 parts_list.append(p.get("text", ""))
#                             else:
#                                 parts_list.append(getattr(p, "text", ""))
#                         content = " ".join(parts_list)
#                     else:
#                         content = str(parts)
#                 else:
#                     content = getattr(inner_msg, "content", "")
#                     if not isinstance(content, str):
#                         content = str(content)

#             role = str(role).strip().lower()
#             content = str(content).strip()

#             if role == "assistant" and content:
#                 tracker.add("agent", content)
#             elif role == "user" and content:
#                 tracker.add("customer", content)

#         if tracker.turns:
#             lead_data = await extract_lead_from_transcript(tracker, llm)
#             breakdown = billing_tracker.generate_breakdown()
#             await post_lead_to_server(lead_data, tracker, recording_url=rec_url, breakdown=breakdown)
#         else:
#             logger.info("No conversation turns recorded — skipping lead capture")

#     @transport.event_handler("on_client_disconnected")
#     async def on_client_disconnected(transport, client):
#         await cleanup_and_save_lead("Client disconnected handler")
#         await task.cancel()

#     runner = PipelineRunner(handle_sigint=runner_args.handle_sigint)
#     try:
#         await runner.run(task)
#     finally:
#         try:
#             db_init_task.cancel()
#         except Exception:
#             pass
#         await cleanup_and_save_lead("Pipeline task finished")
#         if pool:
#             logger.info("Closing database pool...")
#             await pool.close()


# if __name__ == "__main__":
#     from pipecat.runner.run import main
#     if len(sys.argv) == 1:
#         sys.argv.extend(["-t", "webrtc"])
#     main()

#pipeline.py
import os
import json
import time
import math
import datetime
import uuid
import asyncio
import httpx
import re
from pathlib import Path
from dotenv import load_dotenv
from loguru import logger
from fastapi import WebSocket

from rapidfuzz import process
from rapidfuzz.fuzz import WRatio

from pipecat.frames.frames import (
    Frame, AudioRawFrame, CancelFrame, EndFrame, UserIdleTimeoutUpdateFrame,
    TextFrame, TranscriptionFrame, TTSStoppedFrame, UserStartedSpeakingFrame,
    TTSSpeakFrame, TTSUpdateSettingsFrame, FunctionCallInProgressFrame,
    BotStartedSpeakingFrame, BotStoppedSpeakingFrame, StartFrame
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineTask, PipelineParams
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection
from pipecat.services.sarvam.stt import SarvamSTTService
from pipecat.services.google.llm import GoogleLLMService
from pipecat.services.sarvam.tts import SarvamTTSService
from pipecat.services.llm_service import FunctionCallParams
from pipecat.transports.websocket.fastapi import FastAPIWebsocketTransport, FastAPIWebsocketParams
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams

from tools.vobiz_serializer import VobizFrameSerializer
from tools.pipecat_tools import register_all_tools, get_tools_schema, send_payment_link_tool

load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=True)

_gemini_key = os.getenv("GEMINI_API_KEY")
if _gemini_key:
    os.environ["GOOGLE_API_KEY"] = _gemini_key

BACKEND_API_BASE = os.getenv("AUVIA_BACKEND_URL", "http://localhost:5001")
LEAD_ENDPOINT = f"{BACKEND_API_BASE}/api/voice/lead"
BOT_SECRET = os.getenv("AUVIA_BOT_SECRET")

FILLER_TEXT = {
    "te-IN": "చూస్తున్నాను",
    "hi-IN": "जाँच कर रहा हूँ",
    "en-IN": "Checking",
}
HANGUP_TEXT = {
    "te-IN": "మా సహాయం కోరినందుకు ధన్యవాదాలు.",
    "hi-IN": "हमसे संपर्क करने के लिए धन्यवाद।",
    "en-IN": "Thank you for calling.",
}

# ─── Conversation transcript collector ───────────────────────────────────────
class ConversationTracker:
    def __init__(self):
        self.turns: list[dict] = []   
        self.call_start: float = time.time()

    def add(self, speaker: str, text: str):
        self.turns.append({"from": speaker, "text": text, "at_seconds": round(time.time() - self.call_start, 1)})

    def duration(self) -> int:
        return int(time.time() - self.call_start)

    def full_text(self) -> str:
        return "\n".join(f"{t['from'].upper()}: {t['text']}" for t in self.turns)

async def extract_lead_from_transcript(tracker: ConversationTracker, llm: GoogleLLMService) -> dict:
    if not tracker.turns: return {}
    today_str = datetime.date.today().strftime('%A, %B %d, %Y')
    extraction_prompt = f"""You are an AI assistant that extracts structured lead data from voice call transcripts.
Today's date is {today_str}.
TRANSCRIPT:
{tracker.full_text()}

Extract fields. Respond ONLY with valid JSON.
{{
  "name": "customer full name or null",
  "phone": "phone number mentioned or null",
  "amountDue": numeric amount or null,
  "paymentContext": "consultation_fee | lab_charges | pharmacy_bill | admission_charges | other",
  "outcome": "paid_now | link_sent | call_later | already_paid | not_interested | other",
  "sentiment": "friendly | happy | neutral | cooperative | frustrated | uncooperative",
  "aiSummary": "1-2 sentence summary",
  "notes": "notes or null",
  "callbackDate": "YYYY-MM-DD or null",
  "callbackTime": "HH:MM:SS or null"
}}"""
    try:
        from google import genai
        from google.genai import types as genai_types
        client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=extraction_prompt,
            config=genai_types.GenerateContentConfig(response_mime_type="application/json")
        )
        raw = response.text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"): raw = raw[4:]
        return json.loads(raw.strip())
    except Exception as e:
        logger.warning(f"Lead extraction failed: {e}")
        return {"outcome": "other", "sentiment": "neutral", "aiSummary": "Extraction failed.", "notes": tracker.full_text()[:500]}

async def post_lead_to_server(session: dict, lead_data: dict, tracker: ConversationTracker, db_pool, recording_url: str | None = None, breakdown: dict | None = None):
    campaign_id = session.get("campaignId")
    clinic_id = session.get("clinicId")
    contact_id = session.get("contactId")
    call_id = session.get("callId")
    telephony_call_id = session.get("telephonyCallId")
    
    if not call_id or not db_pool:
        logger.error("❌ Missing call_id or db_pool for direct DB save.")
        return

    # Try to pull from Redis just in case it caught a stray webhook
    if not recording_url:
        try:
            import redis.asyncio as redis
            redis_url = os.getenv("REDIS_URL") or "redis://localhost:6379"
            r_client = redis.from_url(redis_url, decode_responses=True)
            if telephony_call_id:
                recording_url = await r_client.get(f"pending_recording:{telephony_call_id}")
            if not recording_url and call_id:
                recording_url = await r_client.get(f"pending_recording:{call_id}")
            await r_client.close()
        except Exception:
            pass

    # Ensure UUID types for Postgres compatibility
    db_call_uuid = uuid.UUID(call_id) if isinstance(call_id, str) else call_id
    db_contact_uuid = uuid.UUID(contact_id) if isinstance(contact_id, str) else contact_id
    db_campaign_uuid = uuid.UUID(campaign_id) if isinstance(campaign_id, str) else campaign_id
    db_clinic_uuid = uuid.UUID(clinic_id) if isinstance(clinic_id, str) else clinic_id

    # Parse amount safely
    try:
        amount_val = float(lead_data.get("amountDue")) if lead_data.get("amountDue") else None
    except:
        amount_val = None

    try:
        async with db_pool.acquire() as conn:
            async with conn.transaction():
                # Determine credits used safely
                credits_used = float(breakdown["billed_minutes"]) if breakdown and "billed_minutes" in breakdown else 0.0

                # 1. Upsert the Call Record (Now including credits_billed)
                # 🚀 THE FIX: Explicitly cast $6::int and $12::numeric so asyncpg doesn't crash!
                await conn.execute("""
                    INSERT INTO calls (
                        id, contact_id, campaign_id, clinic_id, attempt_number, 
                        call_status, outcome, duration_seconds, recording_url, 
                        transcript, ai_summary, sentiment, telephony_call_id, 
                        started_at, ended_at, updated_at, amount, billing, credits_billed
                    ) VALUES (
                        $1, $2, $3, $4, 1, 
                        'completed', $5, $6::int, $7, 
                        $8::jsonb, $9, $10, $11, 
                        NOW() - INTERVAL '1 second' * $6::int, NOW(), NOW(), $12::numeric, $13::jsonb, $14::numeric
                    )
                    ON CONFLICT (id) DO UPDATE SET
                        call_status = 'completed',
                        outcome = EXCLUDED.outcome,
                        duration_seconds = EXCLUDED.duration_seconds,
                        recording_url = COALESCE(calls.recording_url, EXCLUDED.recording_url), 
                        transcript = EXCLUDED.transcript,
                        ai_summary = EXCLUDED.ai_summary,
                        sentiment = EXCLUDED.sentiment,
                        telephony_call_id = COALESCE(calls.telephony_call_id, EXCLUDED.telephony_call_id),
                        ended_at = EXCLUDED.ended_at,
                        updated_at = EXCLUDED.updated_at,
                        amount = COALESCE(EXCLUDED.amount, calls.amount),
                        billing = EXCLUDED.billing,
                        credits_billed = EXCLUDED.credits_billed;
                """,
                db_call_uuid, db_contact_uuid, db_campaign_uuid, db_clinic_uuid, 
                lead_data.get("outcome", "other"), tracker.duration(), recording_url,
                json.dumps(tracker.turns), lead_data.get("aiSummary"), lead_data.get("sentiment"), telephony_call_id,
                amount_val, json.dumps(breakdown) if breakdown else '{}', credits_used)

                # 2. Safely deduct the fractional credits from the clinic's wallet (keeping credit_balance and credits columns synchronized)
                if credits_used > 0:
                    new_balance = await conn.fetchval(
                        "UPDATE clinics SET credit_balance = COALESCE(credit_balance, 0) - $1, credits = COALESCE(credits, 0) - $1::int, updated_at = NOW() WHERE id = $2 RETURNING credit_balance",
                        credits_used, db_clinic_uuid
                    )
                    
                    if new_balance is not None:
                        # Calculate what the balance was before this deduction
                        balance_before = new_balance + credits_used
                        
                        await conn.execute(
                            "INSERT INTO credit_transactions (clinic_id, type, amount, balance_before, balance_after, reference_id, description) VALUES ($1, 'deduction', $2, $3, $4, $5, $6)",
                            db_clinic_uuid, credits_used, balance_before, new_balance, db_call_uuid, f"Voice AI Call deduction ({tracker.duration()} seconds)"
                        )

                # 3. Log Call Cost Breakdown for analytics reporting
                if breakdown:
                    try:
                        dur_sec = float(breakdown.get("duration_seconds") or tracker.duration() or 0)
                        dur_min = float(breakdown.get("duration_minutes") or (dur_sec / 60.0) or 0)
                        stt_cost = float(breakdown.get("stt_cost") or 0)
                        stt_prov = str(breakdown.get("stt_provider") or "Sarvam")
                        tts_cost = float(breakdown.get("tts_cost") or 0)
                        tts_prov = str(breakdown.get("tts_provider") or "Sarvam AI")
                        tts_chars = int(breakdown.get("tts_chars") or 0)
                        llm_in_cost = float(breakdown.get("llm_in_cost") or 0)
                        llm_in_tok = int(breakdown.get("llm_in_tokens") or 0)
                        llm_out_cost = float(breakdown.get("llm_out_cost") or 0)
                        llm_out_tok = int(breakdown.get("llm_out_tokens") or 0)
                        telephony_cost = float(breakdown.get("telephony_cost") or 0)
                        telephony_prov = str(breakdown.get("telephony_provider") or "Vobiz")
                        whatsapp_cost = float(breakdown.get("whatsapp_cost") or 0)
                        whatsapp_msg_type = str(breakdown.get("whatsapp_msg_type") or "None")
                        other_cost = float(breakdown.get("other_cost") or 0)
                        credits_billed = float(breakdown.get("billed_minutes") or 0)
                        total_cost = float(breakdown.get("total_cost") or 0)
                        cost_per_minute = float(breakdown.get("cost_per_minute") or 0)

                        await conn.execute("""
                            INSERT INTO call_cost_breakdown (
                                call_id, clinic_id, duration_seconds, duration_minutes,
                                stt_cost, stt_provider, tts_cost, tts_provider, tts_chars,
                                llm_in_cost, llm_in_tokens, llm_out_cost, llm_out_tokens,
                                telephony_cost, telephony_provider, whatsapp_cost, whatsapp_msg_type,
                                other_cost, credits_billed, total_cost, cost_per_minute, bill
                            ) VALUES (
                                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22::jsonb
                            )
                        """,
                        db_call_uuid, db_clinic_uuid, dur_sec, dur_min,
                        stt_cost, stt_prov, tts_cost, tts_prov, tts_chars,
                        llm_in_cost, llm_in_tok, llm_out_cost, llm_out_tok,
                        telephony_cost, telephony_prov, whatsapp_cost, whatsapp_msg_type,
                        other_cost, credits_billed, total_cost, cost_per_minute, json.dumps(breakdown))
                    except Exception as cbe:
                        logger.error(f"❌ Failed to save cost breakdown directly to DB: {cbe}")
            
        logger.info(f"✅ Lead and Billing successfully saved directly to DB. Call ID: {call_id}")
    except Exception as e:
        logger.error(f"❌ Failed to save lead/billing directly to DB: {e}")

# =============================================================================
# 🛡️ DEFENSIVE PROCESSORS
# =============================================================================
class InitializationBuffer(FrameProcessor):
    def __init__(self):
        super().__init__()
        self.is_started = False
        self.pre_start_buffer = []

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        if isinstance(frame, StartFrame):
            await super().process_frame(frame, direction)
            self.is_started = True
            for buffered_frame in self.pre_start_buffer:
                await self.push_frame(buffered_frame, direction)
            self.pre_start_buffer.clear()
            await self.push_frame(frame, direction)
            return

        if not self.is_started:
            if isinstance(frame, AudioRawFrame):
                self.pre_start_buffer.append(frame)
            return

        await super().process_frame(frame, direction)
        await self.push_frame(frame, direction)

class EchoImmunityFilter(FrameProcessor):
    def __init__(self):
        super().__init__()
        self.bot_is_speaking = False

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        try: await super().process_frame(frame, direction)
        except Exception as e:
            if "StartFrame not received" in str(e): return
            raise e
        
        if isinstance(frame, BotStartedSpeakingFrame): self.bot_is_speaking = True
        elif isinstance(frame, BotStoppedSpeakingFrame): self.bot_is_speaking = False

        if isinstance(frame, UserStartedSpeakingFrame) and direction == FrameDirection.DOWNSTREAM:
            if self.bot_is_speaking: return 

        try: await self.push_frame(frame, direction)
        except Exception as e:
            if "StartFrame not received" not in str(e): raise e

class STTTextCleanerProcessor(FrameProcessor):
    def __init__(self, session_identifier, clinic_id, db_pool=None, lang_processor=None):
        super().__init__()
        self.session_identifier = session_identifier
        self.clinic_id = clinic_id
        self.db_pool = db_pool
        self.lang_processor = lang_processor
        self.bot_is_speaking = False
        self.lexicon_fixes = {"పార్లమెంట్": "అపాయింట్మెంట్", "apartment": "appointment", "అపార్ట్మెంట్": "అపాయింట్మెంట్"}
        # Removed valid affirmations from the ignore list
        self.grunts = {"hmm", "hm", "hmmm", "ha", "haa", "ah", "ahh", "uh", "um", "oh", "हम्म", "ओह", "ఉం", "ఆ"}

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        try: await super().process_frame(frame, direction)
        except Exception as e:
            if "StartFrame not received" in str(e): return
            raise e
        
        if isinstance(frame, BotStartedSpeakingFrame): self.bot_is_speaking = True
        elif isinstance(frame, BotStoppedSpeakingFrame): self.bot_is_speaking = False

        if isinstance(frame, TranscriptionFrame):
            stt_raw_text = frame.text.strip().lower()
            clean_text = re.sub(r'[^\w\s\u0900-\u097F\u0C00-\u0C7F]', '', stt_raw_text).strip()
            
            # 🚀 FIX: Drop grunts and 1-letter mic static, but ALLOW "yes/no" even if it overlaps with the bot
            if clean_text in self.grunts or len(clean_text) <= 1:
                logger.debug(f"[{self.session_identifier}] 🗑️ Dropped background noise/grunt: '{stt_raw_text}'")
                return

            logger.info(f"[{self.session_identifier}] 🎤 USER SAID: {stt_raw_text}")
            for wrong_val, right_val in self.lexicon_fixes.items():
                stt_raw_text = stt_raw_text.replace(wrong_val, right_val)
            frame.text = stt_raw_text
                
        try: await self.push_frame(frame, direction)
        except Exception as e:
            if "StartFrame not received" not in str(e): raise e

class AutoLanguageProcessor(FrameProcessor):
    def __init__(self, session_identifier, greeting_text: str = ""):
        super().__init__()
        self.session_identifier = session_identifier
        self.active_locale = self._detect_locale(greeting_text, strict=False) or "en-IN"

    def _detect_locale(self, text: str, strict: bool = True):
        if not text: return None
        telugu_chars = re.findall(r'[\u0c00-\u0c7f]', text)
        hindi_chars = re.findall(r'[\u0900-\u097f]', text)
        if not strict: return "te-IN" if telugu_chars else ("hi-IN" if hindi_chars else "en-IN")
        if len(telugu_chars) >= 4: return "te-IN"
        if len(hindi_chars) >= 4: return "hi-IN"
        if not telugu_chars and not hindi_chars: return "en-IN"
        return None

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        try: await super().process_frame(frame, direction)
        except Exception as e:
            if "StartFrame not received" in str(e): return
            raise e
        
        if isinstance(frame, TextFrame):
            ai_spoken_text = frame.text.lower().strip()
            detected_locale = self._detect_locale(ai_spoken_text, strict=True)
            if detected_locale and detected_locale != self.active_locale:
                self.active_locale = detected_locale
                try:
                    await self.push_frame(TTSUpdateSettingsFrame(delta=SarvamTTSService.Settings(voice="ritu", language=detected_locale, pace=1.0)), direction)
                except Exception: pass
        try: await self.push_frame(frame, direction)
        except Exception as e:
            if "StartFrame not received" not in str(e): raise e

class CallEndingProcessor(FrameProcessor):
    def __init__(self, task_pipeline):
        super().__init__()
        self.task_pipeline = task_pipeline
        self.call_ending = False

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        try: await super().process_frame(frame, direction)
        except Exception as e:
            if "StartFrame not received" in str(e): return
            raise e
        
        if isinstance(frame, TextFrame) and direction == FrameDirection.DOWNSTREAM:
            cleaned_text = frame.text.strip().lower()
            if ("ధన్యవాదాలు" in cleaned_text or "thank you for calling" in cleaned_text or "धन्यवाद" in cleaned_text) and len(cleaned_text) < 60:
                self.call_ending = True

        if isinstance(frame, TTSStoppedFrame) and self.call_ending:
            logger.info("👋 Goodbye finished. EXECUTING INSTANT HANGUP.")
            # ⚡ INSTANT HANGUP FIX: Kills the websocket immediately
            await self.task_pipeline.queue_frames([CancelFrame()])
            return

        try: await self.push_frame(frame, direction)
        except Exception as e:
            if "StartFrame not received" not in str(e): raise e

class BillingTracker(FrameProcessor):
    def __init__(self, bot_context, session_identifier):
        super().__init__()
        self.tts_char_count = 0
        self.llm_out_tokens = 0
        self.timer_start = time.time()
        self.bot_context = bot_context
        self.session_identifier = session_identifier

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        try:
            await super().process_frame(frame, direction)
        except Exception as e:
            if "StartFrame not received" in str(e): return
            raise e
        
        if isinstance(frame, TextFrame) and direction == FrameDirection.DOWNSTREAM:
            self.tts_char_count += len(frame.text)
            self.llm_out_tokens += len(frame.text) / 4.0
            
        try:
            await self.push_frame(frame, direction)
        except Exception as e:
            if "StartFrame not received" not in str(e): raise e

    def generate_breakdown(self) -> dict:
        duration_seconds = max(1.0, time.time() - self.timer_start)
        duration_minutes = duration_seconds / 60.0
        
        # 🚀 THE FIX: Restored telecom ceiling logic. 
        # 30 sec -> 1 min (1 credit). 1 min 12 sec -> 2 min (2 credits).
        billed_minutes = int(math.ceil(duration_minutes)) if duration_minutes > 0 else 1
        inr_multiplier = 94.94
        
        telephony_cost = billed_minutes * 0.65
        stt_cost = duration_minutes * 0.50
        recording_cost = billed_minutes * 0.10
        
        tts_cost = self.tts_char_count * 0.003

        messages_json = json.dumps(self.bot_context.messages)
        llm_in_tokens = int(len(messages_json) / 4.0)
        llm_out_tokens = int(self.llm_out_tokens)
        llm_in_cost = (llm_in_tokens * (0.30 / 1_000_000)) * inr_multiplier
        llm_out_cost = (llm_out_tokens * (1.05 / 1_000_000)) * inr_multiplier

        whatsapp_msg_count = 0
        for msg in self.bot_context.messages:
            if msg.get("role") == "user" and "parts" in msg:
                for part in msg["parts"]:
                    if "function_response" in part:
                        func_resp = part["function_response"]
                        if func_resp.get("name") == "voice_agent_book_appointment":
                            resp_data = func_resp.get("response", {})
                            if isinstance(resp_data, str):
                                try: resp_data = json.loads(resp_data)
                                except: pass
                            if isinstance(resp_data, dict) and resp_data.get("status") == "success":
                                whatsapp_msg_count += 1

        whatsapp_cost = whatsapp_msg_count * 0.20
        total_cost = stt_cost + tts_cost + llm_in_cost + llm_out_cost + telephony_cost + whatsapp_cost + recording_cost
        
        return {
            "duration_seconds": round(duration_seconds, 2), "duration_minutes": round(duration_minutes, 2),
            "billed_minutes": billed_minutes, "stt_cost": round(stt_cost, 4), "stt_provider": "Sarvam",
            "tts_cost": round(tts_cost, 4), "tts_provider": "Sarvam AI", "tts_chars": self.tts_char_count,
            "llm_in_cost": round(llm_in_cost, 4), "llm_in_tokens": llm_in_tokens,
            "llm_out_cost": round(llm_out_cost, 4), "llm_out_tokens": llm_out_tokens,
            "telephony_cost": round(telephony_cost, 4), "telephony_provider": "Vobiz",
            "whatsapp_cost": round(whatsapp_cost, 4), "whatsapp_msg_type": "Utility Msg" if whatsapp_msg_count > 0 else "None",
            "other_cost": round(recording_cost, 4), "total_cost": round(total_cost, 4),
            "cost_per_minute": round(total_cost / max(duration_minutes, 1.0), 4)
        }

class PipecatBugFixProcessor(FrameProcessor):
    async def process_frame(self, frame: Frame, direction: FrameDirection):
        try: await super().process_frame(frame, direction)
        except Exception as e:
            if "StartFrame not received" in str(e): return
            raise e
        
        if isinstance(frame, AudioRawFrame):
            frame.pts = getattr(frame, 'pts', None)
            frame.transport_destination = getattr(frame, 'transport_destination', None)
            frame.id = getattr(frame, 'id', str(uuid.uuid4()))
            frame.broadcast_sibling_id = getattr(frame, 'broadcast_sibling_id', None)
            
        try: await self.push_frame(frame, direction)
        except Exception as e:
            if "StartFrame not received" not in str(e): raise e

# ─── Main Bot Entry Point ─────────────────────────────────────────────────────
async def run_bot(websocket: WebSocket, session: dict, db_pool):
    CALL_ID = session.get("callId", str(uuid.uuid4()))
    CLINIC_ID = session.get("clinicId", "")
    CONTACT_NAME = session.get("contactName", "")
    CONTACT_AMOUNT = session.get("contactAmount", "")
    CONTACT_REASON = session.get("paymentReason", "outstanding balance")
    CLINIC_NAME = session.get("clinicName", "Auvia Wellness")
    db_system_prompt = session.get("systemPrompt", "You are an AI assistant.")

    try: amount_display = f"₹{float(CONTACT_AMOUNT):,.2f}" if CONTACT_AMOUNT else "an outstanding amount"
    except ValueError: amount_display = f"₹{CONTACT_AMOUNT}"

    system_prompt = db_system_prompt
    if CONTACT_NAME and CONTACT_AMOUNT:
        system_prompt = system_prompt.replace("{patient_name}", CONTACT_NAME).replace("{amount}", amount_display).replace("{payment_reason}", CONTACT_REASON).replace("{clinic_name}", CLINIC_NAME)

    greeting_text = f"Hello, am I speaking with {CONTACT_NAME}?" if CONTACT_NAME else "Hello, how can I help you today?"

    # 🚀 FIX: Only include the system prompt and the initial greeting. 
    # Do NOT inject the assistant message into history, letting the event handler speak it naturally.
    messages = [
        {"role": "system", "content": system_prompt}
    ]
    
    context = LLMContext(messages, tools=get_tools_schema())
    context_aggregator = LLMContextAggregatorPair(context)

    # 🛡️ STRICT VAD: Fixed for short words and concurrent CPU load
    custom_vad = SileroVADAnalyzer(params=VADParams(
        stop_secs=0.8, 
        start_secs=0.2,    # 🚀 CHANGED: Must be 0.2 to catch normal speech!
        confidence=0.70    # 🚀 Lowered slightly to pick up audio better
    ))

    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True, audio_out_enabled=True, add_wav_header=False,
            vad_enabled=True, vad_analyzer=custom_vad, audio_in_sample_rate=8000, audio_out_sample_rate=8000, serializer=VobizFrameSerializer()
        )
    )

    # 🎧 SAMPLE RATE FIX: Force exactly 8000Hz across all models
    stt = SarvamSTTService(api_key=os.getenv("SARVAM_API_KEY"), sample_rate=8000, settings=SarvamSTTService.Settings(model="saaras:v3", high_vad_sensitivity=True, vad_signals=True))
    tts = SarvamTTSService(api_key=os.getenv("SARVAM_API_KEY"), sample_rate=8000, settings=SarvamTTSService.Settings(model="bulbul:v3", voice="ritu"))
    llm = GoogleLLMService(api_key=os.getenv("GEMINI_API_KEY"), settings=GoogleLLMService.Settings(model="gemini-2.5-flash"))

    register_all_tools(llm, CLINIC_ID)

    async def send_payment_link_wrapper(params: FunctionCallParams, **kwargs):
        """Wrapper that automatically injects active call state variables."""
        # We accept **kwargs so Python doesn't crash when the LLM passes arguments, 
        # but we use our hardcoded session variables to ensure 100% accuracy.
        amt = float(CONTACT_AMOUNT) if CONTACT_AMOUNT else 0.0
        
        # Ensure we have the phone number from the session fallback
        ph = str(session.get("contactPhone", "")) 
        
        p_name = CONTACT_NAME
        c_id = CALL_ID
        
        return await send_payment_link_tool(params, amount=amt, phone=ph, patient_name=p_name, call_id=c_id)
    send_payment_link_wrapper.__name__ = "send_payment_link"
    
    # Register this wrapped version instead:
    llm.register_direct_function(send_payment_link_wrapper)

    tracker = ConversationTracker()
    lang_processor = AutoLanguageProcessor(CALL_ID, greeting_text)
    billing_tracker = BillingTracker(context, CALL_ID)
    bug_fixer = PipecatBugFixProcessor()
    stt_cleaner = STTTextCleanerProcessor(CALL_ID, CLINIC_ID, db_pool, lang_processor)
    initialization_buffer = InitializationBuffer()
    echo_shield = EchoImmunityFilter()
    call_ender = CallEndingProcessor(task_pipeline=None)

    pipeline = Pipeline([
        transport.input(),
        initialization_buffer,
        stt,
        stt_cleaner,
        echo_shield,
        context_aggregator.user(),
        llm,
        billing_tracker,
        lang_processor,
        tts,
        call_ender,
        bug_fixer,
        transport.output(),
        context_aggregator.assistant(),
    ])

    task = PipelineTask(pipeline, params=PipelineParams(allow_interruptions=True, audio_in_sample_rate=8000, audio_out_sample_rate=8000))
    call_ender.task_pipeline = task

    greeted = False

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        nonlocal greeted
        if greeted: return
        greeted = True
        logger.info(f"Client connected. Buffering for 500ms to allow Vobiz stream to open...")
        
        # ⚡ AUDIO SYNC FIX: Give Vobiz half a second to bridge the call before speaking
        await asyncio.sleep(0.5)
        
        tracker.call_start = time.time()
        # 🚀 FIX: append_to_context=True ensures the AI remembers it said the greeting
        await task.queue_frames([TTSSpeakFrame(text=greeting_text, append_to_context=True)])

    @transport.event_handler("on_error")
    async def on_error(transport, error, fatal):
        if fatal: await task.cancel()

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        await task.cancel()

    runner = PipelineRunner(handle_sigint=False)
    
    try:
        await runner.run(task)
    finally:
        # Transcript Extraction
        for msg in context.messages:
            inner_msg = getattr(msg, "message", msg)
            if isinstance(inner_msg, dict):
                role = str(inner_msg.get("role", "")).strip().lower()
                content = inner_msg.get("content", "")
                if isinstance(content, list): content = " ".join(p.get("text", "") if isinstance(p, dict) else getattr(p, "text", "") for p in content)
                content = str(content).strip()
            else:
                role = str(getattr(inner_msg, "role", "")).strip().lower()
                parts = getattr(inner_msg, "parts", "")
                if parts:
                    content = " ".join(p if isinstance(p, str) else (p.get("text", "") if isinstance(p, dict) else getattr(p, "text", "")) for p in parts)
                else: content = str(getattr(inner_msg, "content", "")).strip()

            if role == "assistant" and content: tracker.add("agent", content)
            elif role == "user" and content: tracker.add("customer", content)

        if tracker.turns:
            lead_data = await extract_lead_from_transcript(tracker, llm)
            breakdown = billing_tracker.generate_breakdown()
            await post_lead_to_server(session, lead_data, tracker, db_pool, None, breakdown)
        else:
            logger.info("No conversation turns recorded — skipping lead capture")