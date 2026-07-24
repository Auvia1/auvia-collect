import os
import uuid
import json
import httpx
import asyncio
from datetime import datetime
from zoneinfo import ZoneInfo
from loguru import logger
from tools.pool import get_pool

IST = ZoneInfo('Asia/Kolkata')
VOBIZ_API_URL = os.getenv("VOBIZ_API_URL", "https://api.vobiz.ai/api/v1/Account")

async def process_scheduled_callbacks():
    """Background worker that polls for scheduled callbacks and triggers them."""
    logger.info("🕒 Callback Worker Started. Polling every 60 seconds...")
    
    while True:
        try:
            pool = get_pool()
            if not pool:
                await asyncio.sleep(60)
                continue

            current_time_ist = datetime.now(IST)
            
            # Dynamically import server to avoid circular dependency
            import server
            redis_client = server._redis_client
            
            async with pool.acquire() as conn:
                # 1. Fetch eligible callbacks
                # This query respects the calling window, checks IST time, ensures retries aren't exhausted,
                # and uses a NOT EXISTS clause to guarantee a manual call hasn't superseded this one.
                eligible_calls = await conn.fetch("""
                    SELECT 
                        c.id as old_call_id, c.contact_id, c.campaign_id, c.clinic_id, c.attempt_number,
                        co.name as contact_name, co.phone as contact_phone, co.amount_due, co.payment_context,
                        cl.max_retry_attempts, cl.calling_window_start, cl.calling_window_end, 
                        cl.vobiz_auth_id, cl.vobiz_auth_token, cl.phone as clinic_phone, 
                        cl.name as clinic_name, cl.system_prompt, cl.max_concurrent_calls
                    FROM calls c
                    JOIN contacts co ON c.contact_id = co.id
                    JOIN clinics cl ON c.clinic_id = cl.id
                    WHERE 
                        c.outcome = 'call_later' 
                        AND c.call_status IN ('completed', 'not_answered', 'failed')
                        AND c.callback_date IS NOT NULL
                        AND c.callback_time IS NOT NULL
                        AND (c.callback_date + c.callback_time) <= NOW() AT TIME ZONE 'Asia/Kolkata'
                        AND c.attempt_number < cl.max_retry_attempts
                        AND CURRENT_TIME AT TIME ZONE 'Asia/Kolkata' BETWEEN cl.calling_window_start AND cl.calling_window_end
                        AND cl.is_active = true
                        AND NOT EXISTS (
                            SELECT 1 FROM calls manual_check 
                            WHERE manual_check.contact_id = c.contact_id 
                              AND manual_check.campaign_id = c.campaign_id
                              AND manual_check.created_at > c.updated_at
                        )
                """)

                for row in eligible_calls:
                    clinic_id = str(row["clinic_id"])
                    max_concurrent = row["max_concurrent_calls"]

                    # 2. Concurrency Check via Redis
                    if redis_client:
                        active_calls = await redis_client.get(f"active_calls:{clinic_id}")
                        active_calls = int(active_calls) if active_calls else 0
                        
                        if active_calls >= max_concurrent:
                            logger.info(f"⏳ Skipping callback for clinic {clinic_id}: Max concurrency ({max_concurrent}) reached.")
                            continue

                    # 3. Mark old call as processed to prevent duplicate polling
                    await conn.execute(
                        "UPDATE calls SET outcome = 'callback_initiated', updated_at = NOW() WHERE id = $1", 
                        row["old_call_id"]
                    )

                    # 4. Create new Call Record for the retry
                    new_call_row = await conn.fetchrow(
                        """INSERT INTO calls (contact_id, campaign_id, clinic_id, attempt_number, call_status, started_at, telephony_call_id, amount)
                           VALUES ($1, $2, $3, $4, 'queued', NOW(), 'vobiz-pending', $5)
                           RETURNING id""",
                        row["contact_id"], row["campaign_id"], row["clinic_id"], 
                        row["attempt_number"] + 1, row["amount_due"]
                    )
                    
                    new_db_call_id = str(new_call_row["id"])
                    await trigger_vobiz_outbound(row, new_db_call_id)

        except Exception as e:
            logger.error(f"❌ Callback Worker Error: {e}")
        
        # Poll every 60 seconds
        await asyncio.sleep(60)

async def trigger_vobiz_outbound(data, db_call_id):
    """Executes the Vobiz API request and caches the session."""
    public_url = os.getenv("PUBLIC_API_URL", "https://api.nexovai.in").rstrip("/")
    auth_id = data["vobiz_auth_id"]
    auth_token = data["vobiz_auth_token"]
    
    clean_to = str(data["contact_phone"]).strip().replace("+", "")
    if clean_to.startswith("0") and len(clean_to) == 11: clean_to = "91" + clean_to[1:]
    elif len(clean_to) == 10: clean_to = "91" + clean_to

    clean_from = str(data["clinic_phone"]).strip().replace("+", "")

    headers = {
        "X-Auth-ID": auth_id,
        "X-Auth-Token": auth_token,
        "Content-Type": "application/json"
    }
    
    payload = {
        "from": clean_from,
        "to": clean_to,
        "answer_url": f"{public_url}/vobiz-answer?callId={db_call_id}",
        "answer_method": "POST",
        "hangup_url": f"{public_url}/vobiz-hangup?callId={db_call_id}",
        "answer_method": "POST", # Vobiz expects answer_method for callback URLs
        "hangup_method": "POST",
        "record": True,
        "record_url": f"{public_url}/vobiz-recording?callId={db_call_id}",
        "record_method": "POST"
    }

    try:
        # Dynamically import server to avoid circular dependency
        import server
        redis_client = server._redis_client

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(f"{VOBIZ_API_URL}/{auth_id}/Call/", headers=headers, json=payload)
            
            if resp.status_code in [200, 201]:
                vobiz_data = resp.json()
                vobiz_call_id = vobiz_data.get("request_uuid") or vobiz_data.get("CallUUID") or str(uuid.uuid4())

                pool = get_pool()
                async with pool.acquire() as conn:
                    await conn.execute("UPDATE calls SET telephony_call_id = $1 WHERE id = $2", vobiz_call_id, uuid.UUID(db_call_id))

                if redis_client:
                    session_data = {
                        "callId": db_call_id,
                        "campaignId": str(data["campaign_id"]),
                        "clinicId": str(data["clinic_id"]),
                        "clinicName": data["clinic_name"],
                        "contactId": str(data["contact_id"]),
                        "contactName": data["contact_name"],
                        "contactPhone": data["contact_phone"],
                        "contactAmount": str(data["amount_due"]),
                        "paymentReason": data["payment_context"] or "outstanding balance",
                        "systemPrompt": data["system_prompt"],
                        "telephonyCallId": vobiz_call_id
                    }
                    await redis_client.setex(f"ws_session:{vobiz_call_id}", 600, json.dumps(session_data))
                    await redis_client.incr(f"active_calls:{data['clinic_id']}")
                    
                logger.info(f"✅ Automated Callback Initiated: {vobiz_call_id} for {data['contact_name']}")
            else:
                logger.error(f"❌ Vobiz Callback Rejection: {resp.text}")
    except Exception as e:
        logger.error(f"❌ Vobiz Network Error: {e}")
