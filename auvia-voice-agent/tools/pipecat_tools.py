# tools/pipecat_tools.py

import os
import uuid
from loguru import logger
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.services.llm_service import FunctionCallParams
from pipecat.frames.frames import EndTaskFrame, TTSUpdateSettingsFrame
from pipecat.processors.frame_processor import FrameDirection
from pipecat.services.sarvam.tts import SarvamTTSService

from tools.pool import get_pool
from tools.payment import generate_payment_link
from tools.notify import send_whatsapp_text, send_payment_link_template

# ==========================================================
# 🛠️ TOOL FUNCTIONS
# ==========================================================

async def switch_language(params: FunctionCallParams, language: str):
    """Switch the spoken language of the bot (English / Hindi / Telugu)."""
    lang_lower = language.lower()
    if "telugu" in lang_lower:
        lang_code = "te-IN"
    elif "hindi" in lang_lower:
        lang_code = "hi-IN"
    else:
        lang_code = "en-IN"

    logger.info(f"🗣️ Switching language to {language} | Code: {lang_code} | Voice: ritu")

    await params.llm.push_frame(
        TTSUpdateSettingsFrame(delta=SarvamTTSService.Settings(
            voice="ritu",
            language=lang_code,
            pace=1.0
        ))
    )
    await params.result_callback({"status": f"Language switched to {language.capitalize()}."})

switch_language.__name__ = "switch_language"


async def end_call(params: FunctionCallParams):
    """Ends the phone call gracefully."""
    logger.info("👋 LLM requested to end the call.")
    await params.llm.push_frame(EndTaskFrame(), FrameDirection.UPSTREAM)
    await params.result_callback({"status": "Call ending initiated."})

end_call.__name__ = "end_call"


async def send_payment_link_tool(params: FunctionCallParams, amount: float, phone: str, patient_name: str, call_id: str):
    """Generates a Razorpay link and sends it as a Meta WhatsApp Template."""
    logger.info(f"💳 Tool invoked: send_payment_link for {patient_name} ({phone}) - ₹{amount}")
    
    pool = get_pool()
    razorpay_key_id, razorpay_key_secret = None, None
    meta_token, meta_phone_id, hospital_name = None, None, "Auvia Wellness Center"
    
    try:
        async with pool.acquire() as conn:
            clinic_row = await conn.fetchrow("""
                SELECT c.name, c.razorpay_key_id, c.razorpay_key_secret, c.meta_access_token, c.meta_phone_number_id 
                FROM calls cl
                JOIN clinics c ON cl.clinic_id = c.id
                WHERE cl.telephony_call_id = $1 OR cl.id::text = $1
            """, call_id)
            
            if clinic_row:
                hospital_name = clinic_row["name"] or hospital_name
                razorpay_key_id = clinic_row["razorpay_key_id"]
                razorpay_key_secret = clinic_row["razorpay_key_secret"]
                meta_token = clinic_row["meta_access_token"]
                meta_phone_id = clinic_row["meta_phone_number_id"]
    except Exception as e:
        logger.error(f"❌ Failed to fetch clinic credentials: {e}")

    # Fallback to environment variables if database configuration is missing
    if not razorpay_key_id:
        razorpay_key_id = os.getenv("RAZORPAY_KEY_ID")
        razorpay_key_secret = os.getenv("RAZORPAY_KEY_SECRET")

    if not razorpay_key_id or not razorpay_key_secret:
        logger.error("❌ Razorpay keys missing for payment link generation.")
        await params.result_callback({"status": "error", "message": "Payment gateway not configured."})
        return

    # Step 1: Generate Razorpay Link
    payment_url = await generate_payment_link(
        amount=amount,
        phone=phone,
        call_id=call_id,
        patient_name=patient_name,
        razorpay_key_id=razorpay_key_id,
        razorpay_key_secret=razorpay_key_secret
    )

    if not payment_url:
        await params.result_callback({"status": "error", "message": "Failed to generate link."})
        return

    # Step 2: Extract the slug from Razorpay URL (e.g. "sample123" or "plink_xyz")
    payment_slug = payment_url.rstrip("/").split("/")[-1]

    # Insert record into database `payment_links` table
    try:
        async with pool.acquire() as conn:
            call_row = await conn.fetchrow(
                """SELECT cl.id, cl.contact_id, cl.campaign_id, cl.clinic_id, co.payment_context 
                   FROM calls cl
                   LEFT JOIN contacts co ON cl.contact_id = co.id
                   WHERE cl.id::text = $1 OR cl.telephony_call_id = $1""",
                call_id
            )
            if call_row:
                db_call_id = call_row["id"]
                contact_id = call_row["contact_id"]
                campaign_id = call_row["campaign_id"]
                clinic_id = call_row["clinic_id"]
                payment_reason = call_row["payment_context"] or "consultation fee"

                pl_id = await conn.fetchval(
                    """INSERT INTO payment_links (call_id, contact_id, campaign_id, clinic_id, razorpay_link_id, short_url, amount, status, sent_via, sent_at)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, 'created', 'whatsapp', NOW())
                       RETURNING id""",
                    db_call_id, contact_id, campaign_id, clinic_id, payment_slug, payment_url, amount
                )
                
                # Also update outcome/status in calls table
                await conn.execute(
                    """UPDATE calls 
                       SET outcome = 'link_sent', 
                           call_status = 'completed',
                           ended_at = COALESCE(ended_at, NOW()),
                           updated_at = NOW() 
                       WHERE id = $1""",
                    db_call_id
                )
            else:
                payment_reason = "consultation fee"
    except Exception as dberr:
        logger.error(f"❌ Database update error in payment tool: {dberr}")
        payment_reason = "consultation fee"

    # Step 3: Send Meta WhatsApp Template
    success = await send_payment_link_template(
        phone_number=phone,
        hospital_name=hospital_name,
        patient_name=patient_name,
        payment_reason=payment_reason,
        amount=f"{float(amount):.2f}",
        payment_slug=payment_slug,
        meta_access_token=meta_token,
        meta_phone_number_id=meta_phone_id
    )

    if success:
        await params.result_callback({"status": "success", "url": payment_url})
    else:
        await params.result_callback({"status": "error", "message": "Failed to send WhatsApp template."})

send_payment_link_tool.__name__ = "send_payment_link"


# ==========================================================
# 📋 SCHEMAS
# ==========================================================

switch_language_schema = FunctionSchema(
    name="switch_language",
    description="Changes the spoken language of the call to English, Hindi, or Telugu.",
    properties={
        "language": {"type": "string", "description": "One of: 'english', 'hindi', or 'telugu'."}
    },
    required=["language"]
)

end_call_schema = FunctionSchema(
    name="end_call",
    description="Ends the phone call gracefully. Use when the conversation is complete, the patient asks to hang up, or no further action is needed.",
    properties={},
    required=[]
)

send_payment_link_schema = FunctionSchema(
    name="send_payment_link",
    description="Generates a Razorpay payment link and sends it directly to the patient's WhatsApp.",
    properties={
        "amount": {"type": "number", "description": "The exact numeric amount due."},
        "phone": {"type": "string", "description": "The patient's phone number."},
        "patient_name": {"type": "string", "description": "The patient's full name."},
        "call_id": {"type": "string", "description": "The current call session ID."}
    },
    required=["amount", "phone", "patient_name", "call_id"]
)


# ==========================================================
# 🔌 REGISTER TOOLS
# ==========================================================

def register_all_tools(llm, clinic_id: str):
    """Register only the tools needed for outbound billing calls."""
    llm.register_direct_function(switch_language)
    llm.register_direct_function(end_call)
    llm.register_direct_function(send_payment_link_tool)


def get_tools_schema():
    return ToolsSchema(standard_tools=[
        switch_language_schema,
        end_call_schema,
        send_payment_link_schema,
    ])
