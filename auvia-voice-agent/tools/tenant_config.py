#tools/tenant_config.py
import os
import json
import redis.asyncio as redis
from loguru import logger
from tools.pool import get_pool 

async def get_clinic_config(clinic_id: str) -> dict:
    """
    Fetches tenant config (Meta, Payment, etc.) with Redis caching.
    Prevents database bottlenecks during high call volumes.
    """
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    r_client = redis.from_url(redis_url, decode_responses=True)
    
    # 🔑 Global SaaS cache namespace
    cache_key = f"saas_config:{clinic_id}"
    
    # 1. Try to read from Redis Cache
    try:
        cached_config = await r_client.get(cache_key)
        if cached_config:
            await r_client.aclose()
            return json.loads(cached_config)
    except Exception as e:
        logger.warning(f"⚠️ Redis cache read error: {e}")

    # 2. Cache Miss -> Fallback to PostgreSQL
    logger.info(f"🔎 Cache miss. Fetching config from DB for clinic: {clinic_id}")
    config = {}
    
    pool = get_pool()
    if not pool:
        logger.error("❌ Database pool not initialized.")
        await r_client.aclose()
        return config

    try:
        async with pool.acquire() as conn:
            # 🔧 FIX: Cast id to text to prevent the UUID JSON serialization crash
            row = await conn.fetchrow("""
                SELECT 
                    id::text as clinic_id, name, razorpay_key_id, razorpay_key_secret, 
                    vobiz_auth_id, vobiz_auth_token, system_prompt,
                    whatsapp_sender_id, sms_sender_id, preferred_channel
                FROM clinics 
                WHERE id = $1::uuid
            """, clinic_id)
            
            if row:
                config = dict(row)
                # 3. Store back in Redis with a 1-hour expiration window
                await r_client.set(cache_key, json.dumps(config), ex=3600)
                
    except Exception as e:
        logger.error(f"❌ Database config fetch error: {e}")
    finally:
        await r_client.aclose()
        
    return config