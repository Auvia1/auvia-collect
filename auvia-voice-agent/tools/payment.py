import time
import httpx
from loguru import logger

async def generate_payment_link(amount: float, phone: str, call_id: str, patient_name: str, razorpay_key_id: str, razorpay_key_secret: str) -> str:
    """Generates a Razorpay Payment Link."""
    logger.info(f"💳 Generating Razorpay link for call {call_id} | Amount: ₹{amount}")
    
    amount_in_paise = int(float(amount) * 100)
    expiry_time = int(time.time()) + 1200 # 20-minute expiry buffer
    
    clean_phone = phone.strip()
    if not clean_phone.startswith("+"):
        if clean_phone.startswith("91") and len(clean_phone) > 10:
            clean_phone = f"+{clean_phone}"
        else:
            clean_phone = f"+91{clean_phone}"

    payload = {
        "amount": amount_in_paise,
        "currency": "INR",
        "expire_by": expiry_time,
        "description": "Auvia Wellness - Outstanding Payment",
        "customer": {
            "name": patient_name,
            "contact": clean_phone
        },
        "notes": {
            "call_id": str(call_id)
        },
        "notify": {
            "sms": False,
            "email": False
        }
    }

    url = "https://api.razorpay.com/v1/payment_links/"
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                url, 
                json=payload, 
                auth=(razorpay_key_id, razorpay_key_secret)
            )
            
            if response.status_code in [200, 201]:
                result = response.json()
                short_url = result.get("short_url")
                logger.info(f"✅ Razorpay link created successfully: {short_url}")
                return short_url
            else:
                logger.error(f"❌ Razorpay API Error: {response.text}")
                return None
    except Exception as e:
        logger.error(f"❌ Failed to communicate with Razorpay: {e}")
        return None
