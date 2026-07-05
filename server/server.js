import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Import routers
import authRouter from './routes/auth.js';
import campaignsRouter from './routes/campaigns.js';
import callsRouter from './routes/calls.js';
import settingsRouter from './routes/settings.js';
import usersRouter from './routes/users.js';
import adminRouter from './routes/admin.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

// Enable CORS with default settings (allowing request from frontend proxy or direct)
app.use(cors());

// Body parser
app.use(express.json());

// Mount routes
app.use('/api/auth', authRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/calls', callsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/users', usersRouter);
app.use('/api/admin', adminRouter);

// Root test endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Auvia Collect API is running smoothly' });
});

// Start listening
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Healthcheck: http://localhost:${PORT}/api/health`);
});
