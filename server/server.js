import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Import routers
import authRouter from './routes/auth.js';
import campaignsRouter from './routes/campaigns.js';
import callsRouter from './routes/calls.js';
import settingsRouter from './routes/settings.js';
import usersRouter from './routes/users.js';
import adminRouter from './routes/admin.js';
import voiceRouter, { handleUpgrade } from './routes/voice.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 5001;

// Enable CORS with default settings (allowing request from frontend proxy or direct)
app.use(cors());

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Serve call recordings (WAV files written by the Pipecat bot) ──────────────
// Files live at: auvia-voice-agent/recordings/call_<session>.wav
// Accessible at: http://localhost:5001/recordings/call_<session>.wav
const RECORDINGS_DIR = path.resolve(__dirname, '../auvia-voice-agent/recordings');
app.use('/recordings', (req, res, next) => {
  // Allow the Vite dev-server (any origin) to fetch audio for playback
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Range');
  res.set('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
  next();
}, express.static(RECORDINGS_DIR, {
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-cache');
    res.set('Accept-Ranges', 'bytes');  // allows audio seek in browser
  }
}));

// Mount routes
app.use('/api/auth', authRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/calls', callsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/users', usersRouter);
app.use('/api/admin', adminRouter);
app.use('/api/voice', voiceRouter);

// Root test endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Auvia Collect API is running smoothly' });
});

// Start listening
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Healthcheck: http://localhost:${PORT}/api/health`);
});

server.on('upgrade', (request, socket, head) => {
  if (request.url.startsWith('/api/voice/ws/')) {
    handleUpgrade(request, socket, head);
  } else {
    socket.destroy();
  }
});
