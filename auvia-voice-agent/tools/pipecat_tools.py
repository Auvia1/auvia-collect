# tools/pipecat_tools.py

import uuid
from loguru import logger
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.services.llm_service import FunctionCallParams
from pipecat.frames.frames import EndTaskFrame, TTSUpdateSettingsFrame
from pipecat.processors.frame_processor import FrameDirection
from pipecat.services.sarvam.tts import SarvamTTSService

from tools.payment import generate_payment_link
from tools.notify import send_whatsapp_text

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


def make_send_payment_link_tool(clinic_id: str, db_pool, session):
    """Creates a closure-based send_payment_link tool with access to session and db_pool."""
    async def send_payment_link(params: FunctionCallParams):
        """Generates a Razorpay payment link and sends it to the patient via WhatsApp."""
        logger.info("💳 LLM requested to send payment link.")
        
        if not session or not db_pool:
            logger.error("❌ Session or db_pool missing in register_all_tools")
            await params.result_callback({"status": "error", "message": "Internal error. Session context missing."})
            return

        call_id = session.get("callId")
        campaign_id = session.get("campaignId")
        contact_id = session.get("contactId")
        patient_name = session.get("contactName") or "Patient"
        phone = session.get("contactPhone")
        amount_str = session.get("contactAmount")
        clinic_name = session.get("clinicName") or "Auvia Wellness Center"

        try:
            amount = float(amount_str) if amount_str else 0.0
        except ValueError:
            amount = 0.0

        if amount <= 0:
            logger.error(f"❌ Invalid amount for payment link: {amount_str}")
            await params.result_callback({"status": "error", "message": "Invalid outstanding balance amount."})
            return

        try:
            # Query clinic credentials
            async with db_pool.acquire() as conn:
                clinic_row = await conn.fetchrow(
                    "SELECT razorpay_key_id, razorpay_key_secret, meta_access_token, meta_phone_number_id FROM clinics WHERE id = $1",
                    uuid.UUID(clinic_id) if isinstance(clinic_id, str) and len(clinic_id) == 36 else clinic_id
                )
                
            if not clinic_row or not clinic_row["razorpay_key_id"] or not clinic_row["razorpay_key_secret"]:
                logger.error("❌ Clinic Razorpay credentials missing")
                await params.result_callback({"status": "error", "message": "Razorpay configuration missing on clinic profile."})
                return

            razorpay_key_id = clinic_row["razorpay_key_id"]
            razorpay_key_secret = clinic_row["razorpay_key_secret"]
            meta_access_token = clinic_row["meta_access_token"]
            meta_phone_number_id = clinic_row["meta_phone_number_id"]

            # Generate Payment Link
            short_url = await generate_payment_link(
                amount=amount,
                phone=phone,
                call_id=call_id,
                patient_name=patient_name,
                razorpay_key_id=razorpay_key_id,
                razorpay_key_secret=razorpay_key_secret
            )

            if not short_url:
                await params.result_callback({"status": "error", "message": "Failed to generate payment link via Razorpay."})
                return

            # Insert record into database `payment_links` table
            async with db_pool.acquire() as conn:
                pl_id = await conn.fetchval(
                    """INSERT INTO payment_links (call_id, contact_id, campaign_id, clinic_id, short_url, amount, status, sent_via, sent_at)
                       VALUES ($1, $2, $3, $4, $5, $6, 'created', 'whatsapp', NOW())
                       RETURNING id""",
                    uuid.UUID(call_id) if isinstance(call_id, str) and len(call_id) == 36 else None,
                    uuid.UUID(contact_id) if isinstance(contact_id, str) and len(contact_id) == 36 else None,
                    uuid.UUID(campaign_id) if isinstance(campaign_id, str) and len(campaign_id) == 36 else None,
                    uuid.UUID(clinic_id) if isinstance(clinic_id, str) and len(clinic_id) == 36 else None,
                    short_url,
                    amount
                )
                
                # Also update outcome/status in calls table
                if call_id:
                    await conn.execute(
                        """UPDATE calls 
                           SET outcome = 'link_sent', 
                               call_status = 'completed',
                               ended_at = COALESCE(ended_at, NOW()),
                               updated_at = NOW() 
                           WHERE id = $1""",
                        uuid.UUID(call_id) if isinstance(call_id, str) and len(call_id) == 36 else call_id
                    )

            # Message body to send on WhatsApp
            message = f"Hello {patient_name},\n\nThis is a friendly reminder from {clinic_name} regarding your outstanding balance of ₹{amount:,.2f}.\n\nPlease make your payment securely using this link: {short_url}\n\nThank you!"

            # Send WhatsApp message
            whatsapp_sent = await send_whatsapp_text(
                phone_number=phone,
                message=message,
                meta_access_token=meta_access_token,
                meta_phone_number_id=meta_phone_number_id
            )

            if whatsapp_sent:
                logger.info("✅ Payment link sent successfully on WhatsApp")
                await params.result_callback({"status": "success", "message": f"Payment link generated and sent successfully to {patient_name} on WhatsApp."})
            else:
                logger.error("❌ Failed to send WhatsApp message")
                await params.result_callback({"status": "success_link_generated_whatsapp_failed", "message": f"Payment link generated: {short_url}, but failed to send via WhatsApp."})

        except Exception as e:
            logger.error(f"❌ Error in send_payment_link tool: {e}", exc_info=True)
            await params.result_callback({"status": "error", "message": str(e)})

    send_payment_link.__name__ = "send_payment_link"
    return send_payment_link


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
    description="Generates a secure Razorpay payment link for the outstanding balance and sends it to the patient's phone number via WhatsApp.",
    properties={},
    required=[]
)


# ==========================================================
# 🔌 REGISTER TOOLS
# ==========================================================

def register_all_tools(llm, clinic_id: str, db_pool=None, session=None):
    """Register only the tools needed for outbound billing calls."""
    llm.register_direct_function(switch_language)
    llm.register_direct_function(end_call)
    
    if db_pool and session:
        send_payment_link_fn = make_send_payment_link_tool(clinic_id, db_pool, session)
        llm.register_direct_function(send_payment_link_fn)


def get_tools_schema():
    return ToolsSchema(standard_tools=[
        switch_language_schema,
        end_call_schema,
        send_payment_link_schema,
    ])
