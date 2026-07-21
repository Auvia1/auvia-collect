import httpx
from loguru import logger

def _format_whatsapp_number(phone_number: str) -> str:
    """Cleans the phone number and safely ensures it has a country code."""
    digits_only = "".join(filter(str.isdigit, str(phone_number)))
    if len(digits_only) == 10:
        return f"91{digits_only}"
    return digits_only

async def send_whatsapp_text(phone_number: str, message: str, meta_access_token: str, meta_phone_number_id: str) -> bool:
    """Sends a standard WhatsApp text message with URL preview enabled."""
    if not meta_access_token or not meta_phone_number_id:
        logger.error("⚠️ Meta WhatsApp credentials missing")
        return False

    formatted_number = _format_whatsapp_number(phone_number)
    url = f"https://graph.facebook.com/v22.0/{meta_phone_number_id}/messages"

    headers = {
        "Authorization": f"Bearer {meta_access_token}",
        "Content-Type": "application/json",
    }

    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": formatted_number,
        "type": "text",
        "text": {
            "preview_url": True,
            "body": message,
        },
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(url, headers=headers, json=payload)
            if response.status_code in [200, 201]:
                logger.info(f"✅ Meta WhatsApp text message accepted for {formatted_number}!")
                return True

            logger.error(f"❌ Meta WhatsApp Text Error {response.status_code}: {response.text}")
            return False

    except Exception as e:
        logger.error(f"❌ Meta WhatsApp request failed: {e}")
        return False
