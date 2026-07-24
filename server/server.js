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
import voiceRouter from './routes/voice.js';
import dashboardRouter from './routes/dashboard.js';
import activityLogsRouter from './routes/activityLogs.js';


dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 5001;

const allowedOrigins = [
  process.env.FRONTEND_URL, // Your future Vercel URL (e.g., https://collect.auvia.ai)
  'http://localhost:5173'    // Keep local development working
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Body parser
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true }));

// ── Serve call recordings (WAV files written by the Pipecat bot) ──────────────
// Files live at: auvia-voice-agent/recordings/call_<session>.wav
// Accessible at: http://localhost:5001/recordings/call_<session>.wav
const RECORDINGS_DIR = path.resolve(__dirname, '../auvia-voice-agent/recordings');
app.use('/recordings', (req, res, next) => {
  const origin = req.get('Origin');
  if (origin && allowedOrigins.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
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
app.use('/api/dashboard', dashboardRouter);
app.use('/api/activity-logs', activityLogsRouter);


// Root test endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Auvia Collect API is running smoothly' });
});

// Start listening
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Healthcheck: http://localhost:${PORT}/api/health`);
});


