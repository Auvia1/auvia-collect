import os

# 🚀 1. Prevent PyTorch from choking the Event Loop
os.environ["GRPC_DNS_RESOLVER"] = "native"
os.environ["GRPC_POLL_STRATEGY"] = "poll"
os.environ["OMP_NUM_THREADS"] = "1"

import torch
torch.set_num_threads(1)

import asyncio
import json
import uuid
import datetime
import urllib.parse
import httpx
from pathlib import Path
from typing import Optional
from contextlib import asynccontextmanager

import asyncpg
import redis.asyncio as redis
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, Response
from loguru import logger
from pydantic import BaseModel

from pipeline import run_bot

load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=True)

if os.getenv("GEMINI_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = os.getenv("GEMINI_API_KEY")

AGENT_PORT = int(os.getenv("AGENT_PORT", "8765"))
BOT_SECRET = os.getenv("AUVIA_BOT_SECRET")

# 🚀 2. Global DB and Redis clients for multi-worker shared state
_db_pool: Optional[asyncpg.Pool] = None
_redis_client: Optional[redis.Redis] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _db_pool, _redis_client
    
    redis_url = os.getenv("REDIS_URL")
    if redis_url:
        try:
            _redis_client = redis.from_url(redis_url, decode_responses=True)
            await _redis_client.ping()
            logger.info("✅ Redis connected successfully for cross-worker state")
        except Exception as e:
            logger.error(f"❌ Redis connection failed: {e}")

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

    if _db_pool: await _db_pool.close()
    if _redis_client: await _redis_client.close()

app = FastAPI(title="Auvia Voice Agent", lifespan=lifespan)

class PrepareCallRequest(BaseModel):
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
        "redis_connected": _redis_client is not None,
        "db_connected": _db_pool is not None
    }

# =============================================================================
# 🚀 1. FRONTEND INITIATION (Bypasses Node.js)
# =============================================================================
@app.post("/call/initiate")
async def initiate_call(req: PrepareCallRequest, request: Request):
    """Frontend calls this. Python fetches auth, triggers Vobiz, and maps the session."""
    if not _db_pool:
        return Response(status_code=500, content="Database not connected")

    db_call_id = None
    try:
        # Fetch Clinic's Vobiz Credentials & Phone Number
        async with _db_pool.acquire() as conn:
            clinic_row = await conn.fetchrow(
                "SELECT vobiz_auth_id, vobiz_auth_token, phone FROM clinics WHERE id = $1", 
                uuid.UUID(req.clinicId)
            )
            
        if not clinic_row or not clinic_row["vobiz_auth_id"]:
            return {"status": "error", "message": "Clinic Vobiz credentials missing"}

        auth_id = clinic_row["vobiz_auth_id"]
        auth_token = clinic_row["vobiz_auth_token"]
        from_phone = clinic_row["phone"]

        # 1. Insert a new record in calls under 'queued' status before Vobiz call
        async with _db_pool.acquire() as conn:
            call_row = await conn.fetchrow(
                """INSERT INTO calls (contact_id, campaign_id, clinic_id, attempt_number, call_status, started_at, telephony_call_id, amount)
                   VALUES ($1, $2, $3, 1, 'queued', NOW(), 'vobiz-pending', $4)
                   RETURNING id""",
                uuid.UUID(req.contactId) if req.contactId else None,
                uuid.UUID(req.campaignId) if req.campaignId else None,
                uuid.UUID(req.clinicId),
                float(req.contactAmount) if req.contactAmount else 0.0
            )
            db_call_id = str(call_row["id"])

        # Dynamically build Webhook URLs based on server's public host/domain
        public_url = os.getenv("PUBLIC_API_URL") or os.getenv("PUBLIC_URL")
        if not public_url:
            host = request.headers.get("host", "collectagent.nexovai.in")
            public_url = f"https://{host}"

        public_url = public_url.rstrip("/")

        # Place outbound call using Vobiz REST API
        vobiz_url = f"https://api.vobiz.ai/api/v1/Account/{auth_id}/Call/"
        headers = {
            "X-Auth-ID": auth_id,
            "X-Auth-Token": auth_token,
            "Content-Type": "application/json"
        }
        
        payload = {
            "from": ''.join(filter(str.isdigit, from_phone)),
            "to": ''.join(filter(str.isdigit, req.contactPhone)),
            "answer_url": f"{public_url}/vobiz-answer?callId={db_call_id}",
            "answer_method": "POST",
            "hangup_url": f"{public_url}/vobiz-hangup?callId={db_call_id}",
            "hangup_method": "POST",
            "record": True,
            "record_url": f"{public_url}/vobiz-recording?callId={db_call_id}",
            "record_method": "POST"
        }

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                vobiz_url,
                headers=headers,
                json=payload,
                timeout=15.0
            )
            
            if resp.status_code not in [200, 201]:
                logger.error(f"❌ Vobiz API Error: {resp.status_code} - {resp.text}")
                # Mark call as failed in database
                async with _db_pool.acquire() as conn:
                    await conn.execute(
                        "UPDATE calls SET call_status = 'failed', ended_at = NOW() WHERE id = $1",
                        uuid.UUID(db_call_id)
                    )
                return {"status": "error", "message": "Failed to initiate call with telecom provider"}
                
            vobiz_data = resp.json()
            vobiz_call_id = vobiz_data.get("request_uuid") or vobiz_data.get("api_id") or str(uuid.uuid4())

        # Update the call row with actual telephony UUID
        async with _db_pool.acquire() as conn:
            await conn.execute(
                "UPDATE calls SET telephony_call_id = $1 WHERE id = $2",
                vobiz_call_id, uuid.UUID(db_call_id)
            )

        # Save session under the ACTUAL Vobiz Call ID so the WebSocket finds it instantly
        session_data = req.model_dump()
        session_data["callId"] = db_call_id
        session_data["telephonyCallId"] = vobiz_call_id
        
        if _redis_client:
            await _redis_client.setex(f"ws_session:{vobiz_call_id}", 600, json.dumps(session_data))
            logger.info(f"✅ Call Initiated & Cached: {vobiz_call_id} (DB ID: {db_call_id}) for {req.contactName}")

        return {"status": "dialing", "callId": db_call_id, "telephonyCallId": vobiz_call_id}

    except Exception as e:
        logger.error(f"❌ Initiation Error: {e}")
        if db_call_id:
            try:
                async with _db_pool.acquire() as conn:
                    await conn.execute(
                        "UPDATE calls SET call_status = 'failed', ended_at = NOW() WHERE id = $1",
                        uuid.UUID(db_call_id)
                    )
            except:
                pass
        return {"status": "error", "message": str(e)}


# =============================================================================
# 🚀 2. VOBIZ ANSWER WEBHOOK (Generates XML)
# =============================================================================
@app.post("/vobiz-answer")
async def vobiz_answer(request: Request):
    """Vobiz hits this when the patient answers. We return the Stream and Record XML."""
    public_url = os.getenv("PUBLIC_API_URL") or os.getenv("PUBLIC_URL")
    if not public_url:
        host = request.headers.get("host", "collectagent.nexovai.in")
        public_url = f"https://{host}"
    
    public_url = public_url.rstrip("/")
    host_only = public_url.replace("https://", "").replace("http://", "")

    db_call_id = request.query_params.get("callId", "")

    try:
        body_bytes = await request.body()
        body_str = body_bytes.decode('utf-8', errors='ignore')

        if "{" in body_str:
            data = json.loads(body_str)
        else:
            parsed = urllib.parse.parse_qs(body_str)
            data = {k: v[0] for k, v in parsed.items()}
            
        call_sid = data.get("CallUUID") or data.get("CallSid") or data.get("request_uuid") or data.get("callId", "unknown")
        logger.info(f"📞 Vobiz answered! Returning XML for call_sid={call_sid}, db_call_id={db_call_id}")

    except Exception as e:
        logger.error(f"❌ Failed to parse Vobiz payload: {e}")
        call_sid = "unknown"

    ws_url = f"wss://{host_only}/ws/{call_sid}"
    record_webhook = f"{public_url}/vobiz-recording?callId={db_call_id}"

    vobiz_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Record 
        recordSession="true" 
        redirect="false" 
        maxLength="7200"
        callbackUrl="{record_webhook}" 
        callbackMethod="POST" 
        playBeep="true" 
        fileFormat="mp3" 
    />
    <Stream 
        bidirectional="true" 
        keepCallAlive="true" 
        contentType="audio/x-mulaw;rate=8000"
    >{ws_url}</Stream>
</Response>"""

    return Response(content=vobiz_xml, media_type="application/xml")


# =============================================================================
# 🚀 3. VOBIZ HANGUP WEBHOOK (Cleanup and Callback logic)
# =============================================================================
@app.post("/vobiz-hangup")
async def vobiz_hangup(request: Request):
    db_call_id = request.query_params.get("callId")
    logger.info(f"🔌 Vobiz Hangup received for db_call_id: {db_call_id}")
    
    if db_call_id and _db_pool:
        try:
            async with _db_pool.acquire() as conn:
                # 1. Retrieve call and clinic info
                call_row = await conn.fetchrow(
                    "SELECT clinic_id, call_status, outcome FROM calls WHERE id = $1 LIMIT 1",
                    uuid.UUID(db_call_id)
                )
                if call_row:
                    clinic_id = call_row["clinic_id"]
                    current_status = call_row["call_status"]
                    current_outcome = call_row["outcome"]
                    
                    # 2. If call didn't reach definitive outcome, convert to callback queue
                    if not current_outcome or current_outcome == "other":
                        tomorrow = datetime.date.today() + datetime.timedelta(days=1)
                        callback_date = tomorrow.strftime("%Y-%m-%d")
                        callback_time = "10:00:00"
                        
                        body_bytes = await request.body()
                        body_str = body_bytes.decode('utf-8', errors='ignore')
                        data = {}
                        if "{" in body_str:
                            try: data = json.loads(body_str)
                            except: pass
                        else:
                            try:
                                parsed = urllib.parse.parse_qs(body_str)
                                data = {k: v[0] for k, v in parsed.items()}
                            except: pass
                        
                        status_from_vobiz = (data.get("CallStatus") or data.get("status") or "").lower()
                        cause_from_vobiz = (data.get("HangupCause") or data.get("hangup_cause") or "").lower()
                        
                        label = "Unanswered"
                        if current_status == "in_progress":
                            label = "Hung up"
                        elif "busy" in [status_from_vobiz, cause_from_vobiz]:
                            label = "Busy"
                        elif "no-answer" in [status_from_vobiz, cause_from_vobiz]:
                            label = "Unanswered"
                        elif "failed" in [status_from_vobiz, cause_from_vobiz]:
                            label = "Failed"
                        else:
                            label = "Unanswered" if current_status == "queued" else "Hung up"
                            
                        await conn.execute(
                            """UPDATE calls 
                               SET call_status = 'completed', 
                                   outcome = 'call_later',
                                   callback_date = $1,
                                   callback_time = $2,
                                   amount = 0,
                                   ai_summary = $3,
                                   ended_at = COALESCE(ended_at, NOW()),
                                   updated_at = NOW()
                               WHERE id = $4""",
                            callback_date, callback_time, label, uuid.UUID(db_call_id)
                        )
                        logger.info(f"✅ Call {db_call_id} marked as callback 'call_later' ({label})")
                    else:
                        if current_status in ["in_progress", "queued"]:
                            await conn.execute(
                                """UPDATE calls 
                                   SET call_status = 'completed', 
                                       ended_at = COALESCE(ended_at, NOW()),
                                       updated_at = NOW()
                                   WHERE id = $1""",
                                uuid.UUID(db_call_id)
                            )
                            logger.info(f"✅ Call {db_call_id} updated call_status to 'completed'")
                    
                    # 3. Decrement active calls counter in Redis
                    if clinic_id and _redis_client:
                        current_count = await _redis_client.decr(f"active_calls:{clinic_id}")
                        if current_count < 0:
                            await _redis_client.set(f"active_calls:{clinic_id}", 0)
                            
        except Exception as err:
            logger.error(f"Error handling call record on hangup: {err}")
            
    return {"status": "success"}


# =============================================================================
# 🚀 4. VOBIZ RECORDING WEBHOOK (Updates DB Directly)
# =============================================================================
@app.post("/vobiz-recording")
async def vobiz_recording(request: Request):
    """Catches the MP3 URL from Vobiz and updates the Postgres call log natively."""
    db_call_id = request.query_params.get("callId")
    try:
        data = {}
        try:
            form_data = await request.form()
            data = dict(form_data)
        except Exception:
            pass

        if not data:
            try: data = await request.json()
            except Exception: pass

        call_uuid = data.get("call_uuid") or data.get("CallUUID") or data.get("CallSid") or data.get("callId")
        record_url = data.get("recording_url") or data.get("RecordingURL") or data.get("recordingUrl") or data.get("RecordingUrl") or data.get("RecordUrl")

        if not record_url:
            return {"status": "ignored"}

        logger.info(f"🎙️ Recording received for telephony sid={call_uuid}, db_call_id={db_call_id}. Updating database...")

        if _db_pool:
            async with _db_pool.acquire() as conn:
                updated_id = None
                if db_call_id:
                    updated_id = await conn.fetchval(
                        """UPDATE calls 
                           SET recording_url = $1, 
                               vobiz_call_sid = $2, 
                               call_status = CASE WHEN call_status = 'in_progress' THEN 'completed' ELSE call_status END,
                               ended_at = COALESCE(ended_at, NOW()),
                               updated_at = NOW() 
                           WHERE id = $3 
                           RETURNING id""",
                        record_url, call_uuid, uuid.UUID(db_call_id)
                    )
                else:
                    updated_id = await conn.fetchval(
                        """UPDATE calls 
                           SET recording_url = $1, 
                               vobiz_call_sid = $2, 
                               call_status = CASE WHEN call_status = 'in_progress' THEN 'completed' ELSE call_status END,
                               ended_at = COALESCE(ended_at, NOW()),
                               updated_at = NOW() 
                           WHERE telephony_call_id = $3 
                           RETURNING id""",
                        record_url, call_uuid, call_uuid
                    )
                if updated_id:
                    logger.info(f"✅ Successfully attached recording to call log DB ID: {updated_id}")
                else:
                    logger.warning(f"⚠️ Recording received, but no matching call found in DB for SID {call_uuid} / DB ID {db_call_id}")

        return {"status": "success"}
    except Exception as e:
        logger.error(f"❌ Error processing recording webhook: {e}")
        return {"status": "error"}


# =============================================================================
# 🚀 5. PIPECAT WEBSOCKET
# =============================================================================
@app.websocket("/ws/{call_id}")
async def websocket_endpoint(ws: WebSocket, call_id: str):
    await ws.accept()
    logger.info(f"🔌 WebSocket connected for call {call_id}")

    session = None
    if _redis_client:
        try:
            session_str = await _redis_client.get(f"ws_session:{call_id}")
            if session_str:
                session = json.loads(session_str)
                logger.info(f"✅ Successfully retrieved session from Redis for {call_id}")
        except Exception as re:
            logger.error(f"Redis get session failed: {re}")

    # Robust database query fallback if Redis cache was a miss or empty
    if not session or not session.get("systemPrompt"):
        logger.info(f"🔍 Session or system prompt missing in Redis/memory for call {call_id}. Fetching from DB fallback...")
        if _db_pool:
            try:
                async with _db_pool.acquire() as conn:
                    # Parse call_id as UUID safely
                    db_call_id = call_id
                    try:
                        db_call_id = uuid.UUID(call_id)
                    except Exception:
                        pass
                    
                    # 1. Fetch call info by telephony_call_id
                    call_row = await conn.fetchrow(
                        "SELECT id, campaign_id, clinic_id, contact_id FROM calls WHERE telephony_call_id = $1 OR id = $2",
                        call_id, db_call_id
                    )
                    if call_row:
                        db_call_id_str = str(call_row["id"])
                        campaign_id = str(call_row["campaign_id"])
                        clinic_id = str(call_row["clinic_id"])
                        contact_id = str(call_row["contact_id"])
                        
                        # 2. Fetch clinic info (system prompt and name)
                        clinic_row = await conn.fetchrow(
                            "SELECT system_prompt, name FROM clinics WHERE id = $1",
                            uuid.UUID(clinic_id) if len(clinic_id) == 36 else clinic_id
                        )
                        
                        # 3. Fetch contact info
                        contact_row = await conn.fetchrow(
                            "SELECT name, phone, amount_due, payment_context FROM contacts WHERE id = $1",
                            uuid.UUID(contact_id) if len(contact_id) == 36 else contact_id
                        )
                        
                        if clinic_row and contact_row:
                            system_prompt = clinic_row["system_prompt"]
                            clinic_name = clinic_row["name"]
                            contact_name = contact_row["name"]
                            contact_phone = contact_row["phone"]
                            contact_amount = str(contact_row["amount_due"])
                            payment_context = contact_row["payment_context"]
                            
                            session = {
                                "callId": db_call_id_str,
                                "campaignId": campaign_id,
                                "clinicId": clinic_id,
                                "clinicName": clinic_name,
                                "contactId": contact_id,
                                "contactName": contact_name,
                                "contactPhone": contact_phone,
                                "contactAmount": contact_amount,
                                "paymentReason": payment_context,
                                "systemPrompt": system_prompt
                            }
                            logger.info(f"✅ Successfully restored session details from database fallback for call {call_id}")
            except Exception as db_err:
                logger.error(f"🚨 Database fallback query failed: {db_err}")

    # Hard safety fallback if still empty or not found
    if not session or not session.get("systemPrompt"):
        logger.error(f"🚨 CRITICAL: Missing session for {call_id}! Falling back to default.")
        session = {
            "callId": call_id,
            "systemPrompt": "You are Meher, a professional billing assistant calling from Auvia Wellness Center to follow up on your outstanding payment."
        }
    else:
        # Ensure the dict callId maps to the database call ID if available
        pass

    try:
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
    # 🚀 Set to 3 workers for a 2-Core Server handling max 2 concurrent calls
    uvicorn.run("server:app", host="0.0.0.0", port=AGENT_PORT, workers=3, log_level="info")