#tools/notify.py
import httpx
import datetime
from zoneinfo import ZoneInfo
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


async def send_payment_link_template(
    phone_number: str,
    hospital_name: str,
    patient_name: str,
    payment_reason: str,
    amount: str,
    payment_slug: str,  # The unique Razorpay ID after https://rzp.io/i/
    meta_access_token: str,
    meta_phone_number_id: str
) -> bool:
    """Sends the approved 'auvia_collect_payment_link' Meta WhatsApp Template."""
    if not meta_access_token or not meta_phone_number_id:
        logger.error("⚠️ Meta WhatsApp credentials missing")
        return False

    # Format phone number
    digits_only = "".join(filter(str.isdigit, str(phone_number)))
    formatted_number = f"91{digits_only}" if len(digits_only) == 10 else digits_only

    url = f"https://graph.facebook.com/v22.0/{meta_phone_number_id}/messages"
    headers = {
        "Authorization": f"Bearer {meta_access_token}",
        "Content-Type": "application/json",
    }

    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": formatted_number,
        "type": "template",
        "template": {
            "name": "auvia_collect_payment_link",
            "language": {"code": "en"},
            "components": [
                {
                    "type": "header",
                    "parameters": [{"type": "text", "text": hospital_name}]
                },
                {
                    "type": "body",
                    "parameters": [
                        {"type": "text", "text": patient_name},
                        {"type": "text", "text": payment_reason},
                        {"type": "text", "text": str(amount)},
                        {"type": "text", "text": hospital_name}
                    ]
                },
                {
                    "type": "button",
                    "sub_type": "url",
                    "index": "0",
                    "parameters": [{"type": "text", "text": payment_slug}]
                }
            ]
        }
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(url, headers=headers, json=payload)
            if response.status_code in [200, 201]:
                logger.info(f"✅ Meta WhatsApp Template sent successfully to {formatted_number}!")
                return True

            logger.error(f"❌ Meta Template Error ({response.status_code}): {response.text}")
            return False

    except Exception as e:
        logger.error(f"❌ Meta WhatsApp request failed: {e}")
        return False


async def send_payment_receipt_template(
    phone_number: str,
    hospital_name: str,
    patient_name: str,
    amount: str,
    payment_reason: str,
    transaction_id: str,
    meta_access_token: str,
    meta_phone_number_id: str
) -> bool:
    """Sends the approved 'auvia_collect_payment_receipt' Meta WhatsApp Template."""
    if not meta_access_token or not meta_phone_number_id:
        logger.error("⚠️ Meta WhatsApp credentials missing for receipt.")
        return False

    # Format phone number
    digits_only = "".join(filter(str.isdigit, str(phone_number)))
    formatted_number = f"91{digits_only}" if len(digits_only) == 10 else digits_only

    # Format current date and time in IST (Asia/Kolkata)
    ist_now = datetime.datetime.now(ZoneInfo('Asia/Kolkata'))
    current_time = ist_now.strftime("%B %d, %Y at %I:%M %p")

    url = f"https://graph.facebook.com/v22.0/{meta_phone_number_id}/messages"
    headers = {
        "Authorization": f"Bearer {meta_access_token}",
        "Content-Type": "application/json",
    }

    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": formatted_number,
        "type": "template",
        "template": {
            "name": "auvia_collect_payment_receipt",
            "language": {"code": "en"},
            "components": [
                {
                    "type": "header",
                    "parameters": [{"type": "text", "text": hospital_name}]
                },
                {
                    "type": "body",
                    "parameters": [
                        {"type": "text", "text": patient_name},
                        {"type": "text", "text": str(amount)},
                        {"type": "text", "text": payment_reason},
                        {"type": "text", "text": transaction_id},
                        {"type": "text", "text": current_time},
                        {"type": "text", "text": hospital_name}
                    ]
                }
            ]
        }
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(url, headers=headers, json=payload)
            if response.status_code in [200, 201]:
                logger.info(f"✅ Payment Receipt Template sent successfully to {formatted_number}!")
                return True

            logger.error(f"❌ Meta Receipt Template Error ({response.status_code}): {response.text}")
            return False

    except Exception as e:
        logger.error(f"❌ Meta WhatsApp receipt request failed: {e}")
        return False


