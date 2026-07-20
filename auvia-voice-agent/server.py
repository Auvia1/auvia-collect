# #server.py
# #!/usr/bin/env python3
# """
# Auvia Voice Agent — Standalone Server
# ======================================
# Run independently in a separate terminal:
#     cd auvia-voice-agent
#     uv run python server.py

# Architecture:
#   Vobiz ──► Node WS proxy ──► Python FastAPI /ws/{call_id}
#             ──► spawns pipeline.py subprocess (on dynamic port)
#             ──► Python websockets bridge ──► pipeline.py Pipecat server

# Node.js calls POST /call/prepare with session data before placing the Vobiz call.
# When Vobiz audio arrives via Node proxy, this server bridges it to Pipecat.
# """
# import asyncio
# import time
# import json
# import os
# import sys
# import socket
# import subprocess
# import uuid
# from pathlib import Path
# from typing import Optional
# from contextlib import asynccontextmanager

# import asyncpg
# import uvicorn
# import websockets
# from dotenv import load_dotenv
# from fastapi import FastAPI, WebSocket, WebSocketDisconnect
# from loguru import logger
# from pydantic import BaseModel

# # ── Load .env ──────────────────────────────────────────────────────────────────
# load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=True)

# # Sync Gemini key so google-genai SDK picks it up
# _gemini_key = os.getenv("GEMINI_API_KEY")
# if _gemini_key:
#     os.environ["GOOGLE_API_KEY"] = _gemini_key

# # ── Constants ──────────────────────────────────────────────────────────────────
# AGENT_PORT = int(os.getenv("AGENT_PORT", "8765"))
# NODE_URL   = os.getenv("NODE_URL", "http://localhost:5001")
# BOT_SECRET = os.getenv("AUVIA_BOT_SECRET", "auvia_bot_secret_2025")
# AGENT_DIR  = Path(__file__).parent

# # Resolve Python binary from .venv (same venv that runs server.py itself)
# def _find_python() -> str:
#     for candidate in [
#         AGENT_DIR / ".venv" / "bin" / "python",
#         AGENT_DIR / ".venv" / "Scripts" / "python.exe",
#     ]:
#         if candidate.exists():
#             return str(candidate)
#     return sys.executable  # fallback: same Python that runs this server

# PYTHON_BIN    = _find_python()
# PIPELINE_SCRIPT = str(AGENT_DIR / "pipeline.py")

# # ── Session store: call_id → session dict ──────────────────────────────────────
# pending_sessions: dict[str, dict] = {}

# # ── Shared DB pool ─────────────────────────────────────────────────────────────
# _db_pool: Optional[asyncpg.Pool] = None


# def find_free_port() -> int:
#     """Get a free TCP port dynamically."""
#     with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
#         s.bind(("127.0.0.1", 0))
#         return s.getsockname()[1]


# async def wait_for_port(port: int, host: str = "127.0.0.1", timeout: float = 10.0) -> bool:
#     """Wait until a TCP port is accepting connections."""
#     deadline = asyncio.get_event_loop().time() + timeout
#     while asyncio.get_event_loop().time() < deadline:
#         try:
#             _, writer = await asyncio.wait_for(
#                 asyncio.open_connection(host, port), timeout=0.3
#             )
#             writer.close()
#             await writer.wait_closed()
#             return True
#         except (ConnectionRefusedError, OSError, asyncio.TimeoutError):
#             await asyncio.sleep(0.2)
#     return False


# # =============================================================================
# # Bridge logic — connects Vobiz WebSocket (from Node proxy) to Pipecat subprocess
# # =============================================================================
# async def bridge_websockets(vobiz_ws: WebSocket, pipecat_uri: str, call_id: str):
#     """
#     Bridge frames bidirectionally between:
#       - vobiz_ws  : FastAPI WebSocket (Node proxy → Vobiz audio)
#       - pipecat_ws: Python websockets connection to pipeline.py
#     """
#     # 🔧 Construct the HTTP Origin header to bypass Pipecat's strict 403 CORS checks
#     origin_uri = pipecat_uri.replace("ws://", "http://").replace("wss://", "https://")

#     try:
#         # 🔧 Inject the origin parameter directly (compatible with websockets >= 14.0)
#         async with websockets.connect(
#             pipecat_uri,
#             origin=origin_uri
#         ) as pipecat_ws:
#             logger.info(f"🌉 Bridge connected for call {call_id}: {pipecat_uri}")

#             async def vobiz_to_pipecat():
#                 """Forward audio from Vobiz → Pipecat."""
#                 try:
#                     while True:
#                         msg = await vobiz_ws.receive()
#                         if "text" in msg:
#                             await pipecat_ws.send(msg["text"])
#                         elif "bytes" in msg:
#                             await pipecat_ws.send(msg["bytes"])
#                         elif "type" in msg and msg["type"] == "websocket.disconnect":
#                             break
#                 except (WebSocketDisconnect, Exception) as e:
#                     logger.debug(f"[Vobiz→Pipecat] ended ({type(e).__name__})")


#             async def pipecat_to_vobiz():
#                 """Forward audio from Pipecat → Vobiz."""
#                 try:
#                     async for message in pipecat_ws:
#                         try:
#                             if isinstance(message, bytes):
#                                 await vobiz_ws.send_bytes(message)
#                             else:
#                                 await vobiz_ws.send_text(message)
#                         except Exception:
#                             break
#                 except Exception as e:
#                     logger.debug(f"[Pipecat→Vobiz] ended ({type(e).__name__})")

#             # Run both directions concurrently; stop when either side closes
#             done, pending = await asyncio.wait(
#                 [
#                     asyncio.create_task(vobiz_to_pipecat()),
#                     asyncio.create_task(pipecat_to_vobiz()),
#                 ],
#                 return_when=asyncio.FIRST_COMPLETED,
#             )
#             for t in pending:
#                 t.cancel()

#     except (websockets.InvalidURI, websockets.WebSocketException, OSError) as e:
#         logger.error(f"Bridge error for call {call_id}: {e}")
#     except Exception as e:
#         logger.error(f"Unexpected bridge error for call {call_id}: {e}")


# # =============================================================================
# # Pipeline runner — spawns pipeline.py and bridges audio
# # =============================================================================
# # ── Pre-spawned sessions store: call_id → {"process": Popen, "port": int, "session": dict, "created_at": float}
# pre_spawned_sessions: dict[str, dict] = {}


# async def cleanup_stale_pre_spawns():
#     """Background loop to clean up pre-spawned processes that never connect."""
#     while True:
#         try:
#             await asyncio.sleep(10)
#             now = time.time()
#             to_delete = []
#             for call_id, item in list(pre_spawned_sessions.items()):
#                 # Clean up if pre-spawned more than 90 seconds ago
#                 if now - item["created_at"] > 90:
#                     logger.warning(f"⏰ Pre-spawned session {call_id} expired without connection. Cleaning up...")
#                     process = item["process"]
#                     try:
#                         process.terminate()
#                         process.wait(timeout=2)
#                     except Exception:
#                         try:
#                             process.kill()
#                         except Exception:
#                             pass
#                     to_delete.append(call_id)
#             for call_id in to_delete:
#                 pre_spawned_sessions.pop(call_id, None)
#         except asyncio.CancelledError:
#             break
#         except Exception as e:
#             logger.error(f"Error in cleanup background task: {e}")
#             await asyncio.sleep(5)


# # =============================================================================
# # Pipeline runner — spawns pipeline.py and bridges audio
# # =============================================================================
# def spawn_pipeline(session: dict) -> tuple[subprocess.Popen, int]:
#     call_id       = session.get("callId", str(uuid.uuid4()))
#     campaign_id   = session.get("campaignId", "")
#     clinic_id     = session.get("clinicId", "")
#     clinic_name   = session.get("clinicName", "Auvia Wellness")
#     contact_id    = session.get("contactId", "")
#     contact_name  = session.get("contactName", "")
#     contact_phone = session.get("contactPhone", "")
#     contact_amount= session.get("contactAmount", "")
#     payment_reason= session.get("paymentReason", "outstanding balance")
#     system_prompt = session.get("systemPrompt", "")

#     # Dynamic port for this call's pipeline subprocess
#     port = find_free_port()

#     # Environment for pipeline.py subprocess
#     env = {
#         **os.environ,
#         "CALL_ID":                   call_id,
#         "AUVIA_CAMPAIGN_ID":         campaign_id,
#         "AUVIA_CLINIC_ID":           clinic_id,
#         "AUVIA_CLINIC_NAME":         clinic_name,
#         "CONTACT_ID":                contact_id,
#         "CONTACT_NAME":              contact_name,
#         "CONTACT_PHONE":             contact_phone,
#         "CONTACT_AMOUNT":            contact_amount,
#         "CONTACT_PAYMENT_REASON":    payment_reason,
#         "AUVIA_LEAD_CALLBACK_URL":   f"{NODE_URL}/api/voice/lead",
#         "AUVIA_BOT_SECRET":          BOT_SECRET,
#         "PYTHONIOENCODING":          "utf-8",
#         "PYTHONUTF8":                "1",
#     }
#     if system_prompt:
#         env["AUVIA_SYSTEM_PROMPT"] = system_prompt

#     logger.info(f"🐍 Spawning pipeline.py on port {port} for call {call_id} ({contact_name}) in background...")
#     process = subprocess.Popen(
#         [PYTHON_BIN, PIPELINE_SCRIPT, "-t", "websocket", "--port", str(port)],
#         cwd=str(AGENT_DIR),
#         env=env,
#         stdout=subprocess.PIPE,
#         stderr=subprocess.PIPE,
#     )

#     # Stream subprocess output to our logger (non-blocking)
#     def _log_output(stream, prefix: str):
#         for line in stream:
#             try:
#                 logger.debug(f"[Pipeline:{call_id[:8]}] {prefix} {line.decode().rstrip()}")
#             except Exception:
#                 pass

#     import threading
#     threading.Thread(target=_log_output, args=(process.stdout, ""), daemon=True).start()
#     threading.Thread(target=_log_output, args=(process.stderr, "ERR"), daemon=True).start()

#     return process, port


# async def run_pipeline_for_call(vobiz_ws: WebSocket, session: dict):
#     call_id = session.get("callId", str(uuid.uuid4()))
#     try:
#         process, port = spawn_pipeline(session)
#     except Exception as e:
#         logger.error(f"Failed to spawn pipeline on demand: {e}")
#         return

#     # Wait for Pipecat's WebSocket server to become ready
#     ready = await wait_for_port(port, host="127.0.0.1", timeout=12.0)
#     if not ready:
#         logger.error(f"❌ Pipeline subprocess did not start in time for call {call_id}")
#         process.kill()
#         return

#     logger.info(f"✅ Pipeline ready on port {port}, bridging audio for call {call_id}")

#     # Bridge Vobiz WebSocket ↔ Pipecat subprocess
#     try:
#         await bridge_websockets(vobiz_ws, f"ws://127.0.0.1:{port}/ws-client", call_id)
#     finally:
#         logger.info(f"🔚 Call {call_id} ended — cleaning up pipeline process (pid={process.pid})")
#         loop = asyncio.get_running_loop()
#         try:
#             await loop.run_in_executor(None, lambda: process.wait(timeout=10.0))
#             logger.info(f"✅ Pipeline process (pid={process.pid}) exited naturally.")
#         except subprocess.TimeoutExpired:
#             logger.warning(f"⚠️ Pipeline process (pid={process.pid}) did not exit naturally — terminating...")
#             try:
#                 process.terminate()
#                 await loop.run_in_executor(None, lambda: process.wait(timeout=3.0))
#             except subprocess.TimeoutExpired:
#                 process.kill()


# # =============================================================================
# # FastAPI App
# # =============================================================================
# @asynccontextmanager
# async def lifespan(app: FastAPI):
#     global _db_pool
#     db_url = os.getenv("DATABASE_URL")
#     if db_url:
#         try:
#             from tools.pool import init_tool_db
#             # 🔧 FIX: Disabled statement cache to prevent PgBouncer crashes
#             _db_pool = await asyncpg.create_pool(dsn=db_url, statement_cache_size=0)
#             init_tool_db(_db_pool)
#             logger.info("✅ DB pool initialized")
#         except Exception as e:
#             logger.error(f"DB pool init failed: {e}")

#     logger.info(f"🚀 Auvia Voice Agent server started on port {AGENT_PORT}")
#     logger.info(f"   Python binary: {PYTHON_BIN}")
#     logger.info(f"   Pipeline script: {PIPELINE_SCRIPT}")

#     # Start garbage collector task for expired pre-spawned processes
#     cleanup_task = asyncio.create_task(cleanup_stale_pre_spawns())

#     yield

#     cleanup_task.cancel()
#     # Clean up any remaining pre-spawned processes on exit
#     for call_id, item in list(pre_spawned_sessions.items()):
#         try:
#             item["process"].terminate()
#         except Exception:
#             pass

#     if _db_pool:
#         await _db_pool.close()
#     logger.info("👋 Auvia Voice Agent server stopped")


# app = FastAPI(title="Auvia Voice Agent", lifespan=lifespan)


# class PrepareCallRequest(BaseModel):
#     callId: str
#     campaignId: str
#     clinicId: str
#     clinicName: str = "Auvia Wellness"
#     contactId: str = ""
#     contactName: str = ""
#     contactPhone: str = ""
#     contactAmount: str = ""
#     paymentReason: str = "outstanding balance"
#     systemPrompt: str = ""


# @app.get("/health")
# async def health():
#     return {
#         "status": "ok",
#         "pending_calls": len(pending_sessions) + len(pre_spawned_sessions),
#         "python": PYTHON_BIN,
#     }


# @app.post("/call/prepare")
# async def prepare_call(req: PrepareCallRequest):
#     """
#     Called by Node.js BEFORE placing the Vobiz outbound call.
#     Pre-spawns pipeline.py subprocess so it's fully booted when the call connects.
#     """
#     session = req.model_dump()
#     try:
#         process, port = spawn_pipeline(session)
#         pre_spawned_sessions[req.callId] = {
#             "process": process,
#             "port": port,
#             "session": session,
#             "created_at": time.time()
#         }
#         logger.info(f"📋 Session prepared & pipeline pre-spawned: {req.callId} on port {port} for {req.contactName}")
#     except Exception as e:
#         logger.error(f"Failed to pre-spawn pipeline for call {req.callId}: {e}")
#         pending_sessions[req.callId] = session

#     return {"status": "ready", "callId": req.callId}


# @app.websocket("/ws/{call_id}")
# async def websocket_endpoint(ws: WebSocket, call_id: str):
#     """
#     Node's WS proxy connects here when Vobiz audio starts flowing.
#     We accept the connection, check if we have a pre-spawned pipeline,
#     and bridge audio between Vobiz and the Pipecat subprocess.
#     """
#     await ws.accept()
#     logger.info(f"🔌 WebSocket connected for call {call_id}")

#     pre_spawned = pre_spawned_sessions.pop(call_id, None)
#     if pre_spawned:
#         process = pre_spawned["process"]
#         port = pre_spawned["port"]
        
#         # Wait up to 10 seconds for the pre-spawned process port to be ready (usually ready instantly)
#         ready = await wait_for_port(port, host="127.0.0.1", timeout=10.0)
#         if not ready:
#             logger.error(f"❌ Pre-spawned pipeline subprocess on port {port} not ready for call {call_id}")
#             process.kill()
#             try:
#                 await ws.close()
#             except Exception:
#                 pass
#             return

#         logger.info(f"✅ Pre-spawned pipeline ready on port {port}, bridging audio for call {call_id}")
#         try:
#             await bridge_websockets(ws, f"ws://127.0.0.1:{port}/ws-client", call_id)
#         finally:
#             logger.info(f"🔚 Call {call_id} ended — cleaning up pipeline process (pid={process.pid})")
#             loop = asyncio.get_running_loop()
#             try:
#                 await loop.run_in_executor(None, lambda: process.wait(timeout=10.0))
#                 logger.info(f"✅ Pipeline process (pid={process.pid}) exited naturally.")
#             except subprocess.TimeoutExpired:
#                 logger.warning(f"⚠️ Pipeline process (pid={process.pid}) did not exit naturally — terminating...")
#                 try:
#                     process.terminate()
#                     await loop.run_in_executor(None, lambda: process.wait(timeout=3.0))
#                 except subprocess.TimeoutExpired:
#                     process.kill()
#     else:
#         # Fallback: Spawn on demand
#         session = pending_sessions.pop(call_id, None)
#         if session is None:
#             logger.warning(f"⚠️ No session found for call {call_id} — using defaults")
#             session = {"callId": call_id}
#         else:
#             session["callId"] = call_id

#         try:
#             await run_pipeline_for_call(ws, session)
#         except WebSocketDisconnect:
#             logger.info(f"Call {call_id}: WebSocket disconnected")
#         except Exception as e:
#             logger.error(f"Call {call_id} error: {e}")
#             try:
#                 await ws.close()
#             except Exception:
#                 pass

#     logger.info(f"✅ Call {call_id} WebSocket handler complete")


# # =============================================================================
# # Entry point
# # =============================================================================
# if __name__ == "__main__":
#     uvicorn.run(
#         app,
#         host="0.0.0.0",
#         port=AGENT_PORT,
#         log_level="info",
#     )

#!/usr/bin/env python3
import asyncio
import time
import os
import sys
from pathlib import Path
from typing import Optional
from contextlib import asynccontextmanager

import asyncpg
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from loguru import logger
from pydantic import BaseModel

# ⚡ Import the bot directly instead of using subprocesses
from pipeline import run_bot

# ── Load .env ──────────────────────────────────────────────────────────────────
load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=True)

# Sync Gemini key so google-genai SDK picks it up
_gemini_key = os.getenv("GEMINI_API_KEY")
if _gemini_key:
    os.environ["GOOGLE_API_KEY"] = _gemini_key

# ── Constants ──────────────────────────────────────────────────────────────────
AGENT_PORT = int(os.getenv("AGENT_PORT", "8765"))
NODE_URL   = os.getenv("NODE_URL", "http://localhost:5001")
BOT_SECRET = os.getenv("AUVIA_BOT_SECRET")
AGENT_DIR  = Path(__file__).parent

# ── Session store: call_id → session dict ──────────────────────────────────────
pending_sessions: dict[str, dict] = {}
_db_pool: Optional[asyncpg.Pool] = None

# =============================================================================
# FastAPI App & Lifespan
# =============================================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    global _db_pool
    db_url = os.getenv("DATABASE_URL")
    if db_url:
        try:
            from tools.pool import init_tool_db
            # 🔧 FIX: Disabled statement cache to prevent PgBouncer crashes
            _db_pool = await asyncpg.create_pool(dsn=db_url, statement_cache_size=0)
            init_tool_db(_db_pool)
            logger.info("✅ DB pool initialized")
        except Exception as e:
            logger.error(f"DB pool init failed: {e}")

    logger.info(f"🚀 Auvia Voice Agent server started natively on port {AGENT_PORT}")

    yield

    if _db_pool:
        await _db_pool.close()
    logger.info("👋 Auvia Voice Agent server stopped")

app = FastAPI(title="Auvia Voice Agent", lifespan=lifespan)

class PrepareCallRequest(BaseModel):
    callId: str
    campaignId: str
    clinicId: str
    clinicName: str = "Auvia Wellness"
    contactId: str = ""
    contactName: str = ""
    contactPhone: str = ""
    contactAmount: str = ""
    paymentReason: str = "outstanding balance"
    systemPrompt: str = ""

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "pending_calls": len(pending_sessions)
    }

@app.post("/call/prepare")
async def prepare_call(req: PrepareCallRequest):
    """
    Called by Node.js BEFORE placing the Vobiz outbound call.
    Stores session context natively in memory.
    """
    session = req.model_dump()
    pending_sessions[req.callId] = session
    logger.info(f"📋 Session prepared: {req.callId} for {req.contactName}")
    return {"status": "ready", "callId": req.callId}

@app.websocket("/ws/{call_id}")
async def websocket_endpoint(ws: WebSocket, call_id: str):
    """
    Node's WS proxy connects here. We pass it directly to the Pipecat runner.
    """
    await ws.accept()
    logger.info(f"🔌 WebSocket connected for call {call_id}")

    session = pending_sessions.pop(call_id, None)
    if session is None:
        logger.warning(f"⚠️ No session found for call {call_id} — using defaults")
        session = {"callId": call_id}
    else:
        session["callId"] = call_id

    try:
        # ⚡ Native execution, no subprocess bridging required
        await run_bot(ws, session, _db_pool)
    except WebSocketDisconnect:
        logger.info(f"Call {call_id}: WebSocket disconnected")
    except Exception as e:
        logger.error(f"Call {call_id} error: {e}")
        try:
            await ws.close()
        except Exception:
            pass

    logger.info(f"✅ Call {call_id} WebSocket handler complete")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=AGENT_PORT, log_level="info")