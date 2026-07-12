# 🚀 Running Auvia Collect

Three separate services, three separate terminals.

---

## 📁 Project Structure

```
auvia-collect 2/              ← project root
├── index.html                ← frontend entry
├── vite.config.js            ← Vite config (proxies /api → :5001)
├── package.json              ← frontend deps (React + Vite)
├── src/                      ← React source code
│
├── server/                   ← Node.js Express backend
│   ├── server.js
│   ├── package.json
│   └── .env                  ← backend secrets
│
└── auvia-voice-agent/        ← Python Pipecat voice agent
    ├── pipeline.py
    ├── pyproject.toml
    └── .env                  ← voice agent secrets
```

---

## ⚙️ Environment Files

### `server/.env`
```env
PORT=5001
DATABASE_URL=postgresql://postgres.xxx:password@host:6543/postgres
JWT_SECRET=super_secret_auvia_collect_key_123!
PUBLIC_URL=https://your-ngrok-subdomain.ngrok-free.app
VOBIZ_AUTH_ID=MA_XXXXXX
VOBIZ_AUTH_TOKEN=your_vobiz_auth_token
VOBIZ_FROM_NUMBER=+919876543210
BOT_SECRET=auvia_bot_secret_2025
```

### `auvia-voice-agent/.env`
```env
DATABASE_URL=postgresql://postgres.xxx:password@host:6543/postgres
REDIS_URL=redis://localhost:6379
GEMINI_API_KEY=your_gemini_api_key
SARVAM_API_KEY=your_sarvam_api_key
SMALLEST_API_KEY=your_smallest_api_key
```

> **Note:** The voice agent is spawned automatically by the backend when a call starts.
> You do NOT run it manually — but it must be set up with its .env and .venv.

---

## ▶️ How to Run

### Terminal 1 — Frontend (React + Vite)

```bash
# From the PROJECT ROOT (auvia-collect 2/)
cd "/Users/harivegesna/Desktop/auvia_labs/auvia-collect 2"
npm run dev
# Runs on http://localhost:5173
```

---

### Terminal 2 — Backend (Node.js Express)

```bash
# From the server/ folder
cd "/Users/harivegesna/Desktop/auvia_labs/auvia-collect 2/server"
npm run dev
# Runs on http://localhost:5001
```

---

### Terminal 3 — Voice Agent (Python Pipecat)

> The voice agent is auto-spawned by the backend when you click "Start Call".
> You only need to set it up once. But if you want to run it manually to test:

```bash
cd "/Users/harivegesna/Desktop/auvia_labs/auvia-collect 2/auvia-voice-agent"
source .venv/bin/activate
python pipeline.py -t websocket --port 7860
```

---

## First-Time Setup

### Frontend
```bash
cd "/Users/harivegesna/Desktop/auvia_labs/auvia-collect 2"
npm install
```

### Backend
```bash
cd "/Users/harivegesna/Desktop/auvia_labs/auvia-collect 2/server"
npm install
```

### Voice Agent (one time only)
```bash
cd "/Users/harivegesna/Desktop/auvia_labs/auvia-collect 2/auvia-voice-agent"
# Install uv if not already installed:
curl -LsSf https://astral.sh/uv/install.sh | sh
# Create virtualenv and install all deps from uv.lock:
uv sync
```

---

## Ports Summary

| Service       | Port | Run Command                          |
|---------------|------|--------------------------------------|
| Frontend      | 5173 | npm run dev (from project root)      |
| Backend       | 5001 | npm run dev (from server/)           |
| Voice Agent   | 7860 | Auto-spawned by backend on each call |

---

## Outbound Calls (Vobiz)

For real outbound calls, the backend must be publicly reachable (Vobiz POSTs back to you).

Use ngrok:
```bash
ngrok http 5001
# Copy the https URL e.g. https://abc123.ngrok-free.app
# Set in server/.env:
PUBLIC_URL=https://abc123.ngrok-free.app
```

Then restart the backend server.

---

## Database Commands

```bash
cd server/
npm run db:seed    # Re-seed data (wipes and repopulates)
npm run db:setup   # Full schema + seed setup
```
