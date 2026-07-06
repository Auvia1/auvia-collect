import express from 'express';
import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from '../db.js';
import authMiddleware from '../middleware/auth.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── In-memory bot process store (keyed by campaignId) ───────────────────────
const runningBots = new Map(); // campaignId → { process, startedAt, campaignId, clinicId }


// Path to the voice agent directory
const VOICE_AGENT_DIR = path.resolve(__dirname, '../../auvia-voice-agent');
// Try myenv first (Windows), then .venv, then fall back to system python
const PYTHON_BIN =
  fs.existsSync(path.join(VOICE_AGENT_DIR, 'myenv', 'Scripts', 'python.exe'))
    ? path.join(VOICE_AGENT_DIR, 'myenv', 'Scripts', 'python.exe')
    : fs.existsSync(path.join(VOICE_AGENT_DIR, '.venv', 'Scripts', 'python.exe'))
      ? path.join(VOICE_AGENT_DIR, '.venv', 'Scripts', 'python.exe')
      : 'python';
const PIPELINE_SCRIPT = path.join(VOICE_AGENT_DIR, 'pipeline.py');

// ─── 1. POST /api/voice/start — Spawn bot for a campaign ─────────────────────
router.post('/start', authMiddleware, async (req, res) => {
  const { campaignId, contactId } = req.body;

  if (!campaignId) {
    return res.status(400).json({ error: 'campaignId is required' });
  }

  // Verify campaign and fetch the target contact to call
  let contact = null;
  try {
    const campResult = await db.query(
      `SELECT id, name, status FROM campaigns WHERE id = $1 AND clinic_id = $2 LIMIT 1`,
      [campaignId, req.clinicId]
    );
    if (campResult.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (contactId) {
      // Pick specific contact requested by the user/callback queue
      const contactResult = await db.query(
        `SELECT id, name, phone, amount_due, payment_context
         FROM contacts
         WHERE id = $1 AND campaign_id = $2 LIMIT 1`,
        [contactId, campaignId]
      );
      if (contactResult.rows.length > 0) {
        contact = contactResult.rows[0];
      }
    } else {
      // Pick the first selected contact that doesn't already have a completed/failed pipecat call
      const contactResult = await db.query(
        `SELECT c.id, c.name, c.phone, c.amount_due, c.payment_context
         FROM contacts c
         WHERE c.campaign_id = $1
           AND c.is_selected = true
           AND NOT EXISTS (
             SELECT 1 FROM calls cl
             WHERE cl.contact_id = c.id
               AND cl.telephony_call_id = 'pipecat-webrtc'
               AND cl.call_status IN ('completed', 'failed')
           )
         ORDER BY c.created_at ASC
         LIMIT 1`,
        [campaignId]
      );
      if (contactResult.rows.length > 0) {
        contact = contactResult.rows[0];
      }
    }
  } catch (err) {
    console.error('Error fetching contact for bot:', err);
    return res.status(500).json({ error: 'Failed to fetch contact' });
  }

  if (!contact) {
    return res.status(404).json({ error: 'No uncalled contacts found for this campaign' });
  }

  // Kill ALL running bots on the server to prevent port conflicts or memory overhead
  for (const [campId, bot] of runningBots.entries()) {
    try {
      console.log(`Killing running bot for campaign ${campId}`);
      bot.process.kill('SIGKILL');
    } catch (_) {}
  }
  runningBots.clear();

  // Force kill any process bound to port 7860 on Windows using Powershell
  try {
    await new Promise((resolve) => {
      const cmd = `powershell -Command "Stop-Process -Id (Get-NetTCPConnection -LocalPort 7860 -ErrorAction SilentlyContinue).OwningProcess -Force -ErrorAction SilentlyContinue"`;
      exec(cmd, (err) => {
        // Ignore error (happens if port was already free)
        resolve();
      });
    });
  } catch (err) {
    console.error('Failed to free port 7860:', err);
  }

  // Immediately insert the call record as 'in_progress' to lock the contact
  // so the simulator doesn't call them in parallel!
  let callId = null;
  try {
    const callResult = await db.query(
      `INSERT INTO calls (contact_id, campaign_id, clinic_id, attempt_number, call_status, started_at, telephony_call_id, amount)
       VALUES ($1, $2, $3, 1, 'in_progress', now(), 'pipecat-webrtc', $4)
       RETURNING id`,
      [contact.id, campaignId, req.clinicId, parseFloat(contact.amount_due) || 0]
    );
    callId = callResult.rows[0].id;
  } catch (err) {
    console.error('Error creating in_progress call record:', err);
    return res.status(500).json({ error: 'Failed to initialize call session' });
  }

  // Build context string for the payment reason
  const contextLabels = {
    consultation_fee: 'consultation fee',
    lab_charges: 'lab charges',
    pharmacy_bill: 'pharmacy bill',
    admission_charges: 'admission charges',
    other: 'outstanding balance',
  };
  const paymentReason = contextLabels[contact?.payment_context] || 'outstanding balance';

  // Spawn the pipecat bot — inject contact details so it can do a targeted outbound call
  const botEnv = {
    ...process.env,
    AUVIA_CAMPAIGN_ID: campaignId,
    AUVIA_CLINIC_ID: req.clinicId,
    AUVIA_LEAD_CALLBACK_URL: `http://localhost:${process.env.PORT || 5001}/api/voice/lead`,
    AUVIA_BOT_SECRET: process.env.BOT_SECRET || 'auvia_bot_secret_2025',
    CALL_ID: callId || '',
    // Contact-specific data for outbound call script
    CONTACT_ID: contact?.id || '',
    CONTACT_NAME: contact?.name || '',
    CONTACT_PHONE: contact?.phone || '',
    CONTACT_AMOUNT: contact?.amount_due ? String(contact.amount_due) : '',
    CONTACT_PAYMENT_REASON: paymentReason,
    // Force UTF-8 on Windows so Pipecat's emoji prints (🚀 etc.) don't crash with cp1252
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  };

  const botProcess = spawn(PYTHON_BIN, [PIPELINE_SCRIPT, '-t', 'webrtc'], {
    cwd: VOICE_AGENT_DIR,
    env: botEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  botProcess.stdout.on('data', (data) => {
    console.log(`[PipecatBot:${campaignId.slice(0, 8)}] ${data.toString().trim()}`);
  });
  botProcess.stderr.on('data', (data) => {
    console.error(`[PipecatBot:${campaignId.slice(0, 8)}] ERR: ${data.toString().trim()}`);
  });
  botProcess.on('exit', async (code) => {
    console.log(`[PipecatBot:${campaignId.slice(0, 8)}] exited with code ${code}`);
    runningBots.delete(campaignId);

    // If the process exited and the call status is still 'in_progress',
    // it means it crashed, met a rate limit, or closed before capture.
    // Mark it as failed so the UI accurately shows the connection failure.
    if (callId) {
      try {
        await db.query(
          `UPDATE calls
           SET call_status = 'failed',
               ai_summary = 'Failed to connect or call dropped during initialization',
               ended_at = now()
           WHERE id = $1 AND call_status = 'in_progress'`,
          [callId]
        );
        console.log(`[VoiceLead] Auto-marked call ${callId} as failed on bot exit`);
      } catch (err) {
        console.error('Error auto-marking failed call on exit:', err);
      }
    }
  });

  runningBots.set(campaignId, {
    process: botProcess,
    startedAt: new Date(),
    campaignId,
    clinicId: req.clinicId,
  });

  // Give the bot 1.5s to start its WebRTC HTTP server
  await new Promise((resolve) => setTimeout(resolve, 1500));

  res.json({
    success: true,
    url: 'http://localhost:7860',
    message: 'Pipecat bot started. Open the URL to begin the voice session.',
  });
});

// ─── 2. POST /api/voice/stop — Kill bot for a campaign ───────────────────────
router.post('/stop', authMiddleware, (req, res) => {
  const { campaignId } = req.body;

  if (runningBots.has(campaignId)) {
    const bot = runningBots.get(campaignId);
    try { bot.process.kill('SIGTERM'); } catch (_) {}
    runningBots.delete(campaignId);
    return res.json({ success: true, message: 'Bot stopped' });
  }

  res.json({ success: false, message: 'No bot running for this campaign' });
});

// ─── 3. GET /api/voice/status — Check if a bot is running ────────────────────
router.get('/status', authMiddleware, (req, res) => {
  const { campaignId } = req.query;
  const bot = campaignId ? runningBots.get(campaignId) : null;

  res.json({
    running: !!bot,
    campaignId: bot?.campaignId || null,
    startedAt: bot?.startedAt || null,
    url: bot ? 'http://localhost:7860' : null,
  });
});

// ─── 4. POST /api/voice/lead — Called by the Pipecat bot to save a captured lead ──
// This endpoint uses a shared bot secret instead of a user JWT (bot can't have a session token)
router.post('/lead', async (req, res) => {
  // Verify the bot secret
  const botSecret = req.headers['x-bot-secret'];
  const expectedSecret = process.env.BOT_SECRET || 'auvia_bot_secret_2025';

  if (botSecret !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const {
    campaignId,
    clinicId,
    existingContactId, // UUID of the CSV contact — skip creation if provided
    callId,            // UUID of the pre-inserted in_progress call record
    // Lead / contact data extracted from conversation (only used for new contacts)
    name,
    phone,
    amountDue,
    paymentContext,
    // Call result data
    outcome,
    sentiment,
    aiSummary,
    transcript,
    durationSeconds,
    notes,
    recordingUrl,     // path to local WAV file served by /recordings/
  } = req.body;

  if (!campaignId || !clinicId) {
    return res.status(400).json({ error: 'campaignId and clinicId are required' });
  }

  try {
    await db.query('BEGIN');

    let contactId = null;

    if (existingContactId) {
      // ── Path A: Bot was spawned for a known CSV contact — use them directly ──
      const check = await db.query(
        `SELECT id FROM contacts WHERE id = $1 AND campaign_id = $2 LIMIT 1`,
        [existingContactId, campaignId]
      );
      if (check.rows.length > 0) {
        contactId = existingContactId;
        // Update contact notes if the LLM captured any
        if (notes) {
          await db.query(`UPDATE contacts SET notes = $1 WHERE id = $2`, [notes, contactId]);
        }
      }
    }

    if (!contactId) {
      // ── Path B: Unknown caller — create a new contact record ──
      const contactName    = name || 'Voice Lead (Unknown)';
      const contactPhone   = phone || `voice-${Date.now()}`;
      const contactAmount  = parseFloat(amountDue) || 0;
      const contactContext = paymentContext || 'other';

      const contactResult = await db.query(
        `INSERT INTO contacts
           (campaign_id, clinic_id, name, phone, amount_due, payment_context, is_selected, notes)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [campaignId, clinicId, contactName, contactPhone, contactAmount, contactContext, notes || null]
      );

      contactId = contactResult.rows[0]?.id;

      if (!contactId) {
        // Rare: phone conflict — look it up
        const existing = await db.query(
          `SELECT id FROM contacts WHERE campaign_id = $1 AND phone = $2 LIMIT 1`,
          [campaignId, contactPhone]
        );
        contactId = existing.rows[0]?.id;
      }

      if (!contactId) {
        await db.query('ROLLBACK');
        return res.status(500).json({ error: 'Failed to create or find contact' });
      }

      // Only bump campaign counts for truly new contacts
      await db.query(
        `UPDATE campaigns
         SET selected_contacts = selected_contacts + 1,
             total_contacts     = total_contacts + 1,
             total_amount_due   = total_amount_due + $1
         WHERE id = $2`,
        [contactAmount, campaignId]
      );
    }

    // 3. Save the call record
    const callOutcome = outcome || 'other';
    const validOutcomes = ['paid_now', 'link_sent', 'call_later', 'already_paid', 'not_interested', 'other'];
    const safeOutcome = validOutcomes.includes(callOutcome) ? callOutcome : 'other';
    const durSecs = parseInt(durationSeconds) || 0;

    if (callId) {
      // ── Path A: Call record already pre-inserted in /start — update it ──
      await db.query(
        `UPDATE calls
         SET call_status = 'completed',
             outcome = $1,
             sentiment = $2,
             ai_summary = $3,
             transcript = $4,
             recording_url = $5,
             duration_seconds = $6,
             ended_at = now()
         WHERE id = $7`,
        [
          safeOutcome,
          sentiment || 'neutral',
          aiSummary || null,
          transcript ? JSON.stringify(transcript) : null,
          recordingUrl || null,
          durSecs,
          callId,
        ]
      );
    } else {
      // ── Path B: Legacy fallback — insert a new call record ──
      await db.query(
        `INSERT INTO calls
           (contact_id, campaign_id, clinic_id, call_status, outcome, sentiment,
            ai_summary, transcript, recording_url, duration_seconds, started_at, ended_at, telephony_call_id)
         VALUES ($1, $2, $3, 'completed', $4, $5, $6, $7, $8, $9, now() - ($10 * interval '1 second'), now(), 'pipecat-webrtc')`,
        [
          contactId,
          campaignId,
          clinicId,
          safeOutcome,
          sentiment || 'neutral',
          aiSummary || null,
          transcript ? JSON.stringify(transcript) : null,
          recordingUrl || null,
          durSecs,
          durSecs,
        ]
      );
    }

    await db.query('COMMIT');

    const savedName = existingContactId ? (name || 'CSV Contact') : (name || 'Unknown');
    console.log(`[VoiceLead] Saved lead "${savedName}" for campaign ${campaignId.slice(0, 8)}${recordingUrl ? ' [+recording]' : ''}`);
    res.json({ success: true, contactId, message: 'Lead captured successfully' });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Error saving voice lead:', err);
    res.status(500).json({ error: 'Failed to save lead data' });
  }
});

export default router;
