#tools/whatsapp.py
import os
from fastapi import Request, Response
from loguru import logger

async def verify_whatsapp_webhook(request: Request):
    """Handles the GET challenge verification request from Meta API."""
    params = request.query_params
    mode = params.get("hub.mode")
    token = params.get("hub.verify_token")
    challenge = params.get("hub.challenge")

    # Read token from environment variable with fallback
    verify_token = os.getenv("WHATSAPP_VERIFY_TOKEN", "auvia_collect_secure_token_2026")

    if mode and token:
        if mode == "subscribe" and token == verify_token:
            logger.info("✅ Meta WhatsApp webhook verified successfully!")
            return Response(content=challenge, media_type="text/plain")
        else:
            logger.error("❌ Meta WhatsApp webhook verification failed: Token mismatch")
            return Response(status_code=403, content="Verification failed")
            
    return Response(status_code=400, content="Invalid request parameters")


async def handle_whatsapp_webhook(request: Request):
    """Handles the POST event update callbacks from Meta API."""
    try:
        body = await request.json()
        if body.get("object") == "whatsapp_business_account":
            logger.info(f"📬 Received WhatsApp webhook payload: {body}")
            # Processing message status updates or customer replies can be done here
            return {"status": "success"}
            
        return Response(status_code=404, content="Not found")
    except Exception as e:
        logger.error(f"❌ Failed to process WhatsApp webhook: {e}")
        return Response(status_code=500, content="Internal Server Error")
