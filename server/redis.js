import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
let useFallback = false;
let redisClient = null;

const memoryStore = new Map();
const ttlMap = new Map();

// Helper to clean expired keys in memory store
setInterval(() => {
  const now = Date.now();
  for (const [key, expiry] of ttlMap.entries()) {
    if (now > expiry) {
      memoryStore.delete(key);
      ttlMap.delete(key);
    }
  }
}, 1000);

const fallbackClient = {
  async incr(key) {
    const val = (memoryStore.get(key) || 0) + 1;
    memoryStore.set(key, val);
    return val;
  },
  async decr(key) {
    const val = (memoryStore.get(key) || 0) - 1;
    memoryStore.set(key, val);
    return val;
  },
  async set(key, value) {
    memoryStore.set(key, parseInt(value) || 0);
  },
  async get(key) {
    return memoryStore.get(key) || 0;
  },
  async expire(key, seconds) {
    ttlMap.set(key, Date.now() + seconds * 1000);
  }
};

try {
  const client = createClient({ url: redisUrl });
  client.on('error', (err) => {
    console.warn('⚠️ Redis connection error, using in-memory fallback:', err.message);
    useFallback = true;
  });

  (async () => {
    try {
      await client.connect();
      console.log('✅ Connected to Redis successfully');
    } catch (err) {
      console.warn('⚠️ Redis connect failed, using in-memory fallback:', err.message);
      useFallback = true;
    }
  })();

  redisClient = new Proxy(client, {
    get(target, prop) {
      if (useFallback) {
        return fallbackClient[prop];
      }
      return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
    }
  });
} catch (err) {
  console.warn('⚠️ Failed to initialize Redis, using in-memory fallback:', err.message);
  useFallback = true;
  redisClient = fallbackClient;
}

export default redisClient;
