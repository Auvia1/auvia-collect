import express from 'express';
import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from '../db.js';
import authMiddleware from '../middleware/auth.js';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Helper to automatically set campaign status to completed if all calls are done
async function checkAndCompleteCampaign(campaignId) {
  if (!campaignId) return;
  try {
    const activeCalls = await db.query(
      `SELECT COUNT(*)::int as count 
       FROM calls 
       WHERE campaign_id = $1 AND call_status IN ('queued', 'in_progress')`,
      [campaignId]
    );

    if (activeCalls.rows[0].count === 0) {
      await db.query(
        `UPDATE campaigns 
         SET status = 'completed', 
             updated_at = now() 
         WHERE id = $1 AND status = 'active'`,
        [campaignId]
      );
      console.log(`[CampaignCompletion] Campaign ${campaignId} has no more active calls. Marked as completed.`);
    }
  } catch (err) {
    console.error(`[CampaignCompletion] Error checking campaign completion:`, err);
  }
}

// ─── In-memory bot process store (keyed by campaignId) ───────────────────────
const runningBots = new Map(); // campaignId → { process, startedAt, campaignId, clinicId }

// ─── WebSocket Proxy for Vobiz audio streaming ──────────────────────────────
const wss = new WebSocketServer({ noServer: true });

export function handleUpgrade(request, socket, head) {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
}

wss.on('connection', (vobizWs, request) => {
  const parts = request.url.split('/');
  const callId = parts[parts.length - 1];
  console.log(`[VobizProxy] New connection for call ${callId}`);

  const PYTHON_AGENT_WS = process.env.PYTHON_AGENT_WS_URL || 'ws://localhost:8765';
  const botWs = new WebSocket(`${PYTHON_AGENT_WS}/ws/${callId}`);

  botWs.on('open', () => {
    console.log(`[VobizProxy] Connected to Pipecat bot for call ${callId}`);
  });

  vobizWs.on('message', (message, isBinary) => {
    if (botWs.readyState === WebSocket.OPEN) {
      botWs.send(message, { binary: isBinary });
    }
  });

  botWs.on('message', (message, isBinary) => {
    if (vobizWs.readyState === WebSocket.OPEN) {
      vobizWs.send(message, { binary: isBinary });
    }
  });

  vobizWs.on('close', () => {
    console.log(`[VobizProxy] Vobiz closed connection for call ${callId}`);
    botWs.close();
  });

  botWs.on('close', () => {
    console.log(`[VobizProxy] Pipecat bot closed connection for call ${callId}`);
    vobizWs.close();
  });

  vobizWs.on('error', (err) => {
    console.error(`[VobizProxy] Vobiz WebSocket error:`, err);
    botWs.close();
  });

  botWs.on('error', (err) => {
    console.error(`[VobizProxy] Pipecat WebSocket error:`, err);
    vobizWs.close();
  });
});


// Python standalone voice agent URL
const PYTHON_AGENT_URL = process.env.PYTHON_AGENT_URL || 'http://localhost:8765';

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
        try {
          await db.query(
            `UPDATE calls 
             SET outcome = 'other', updated_at = now() 
             WHERE contact_id = $1 AND outcome = 'call_later' AND call_status = 'completed'`,
            [contactId]
          );
          console.log(`[CallbackQueue] Removed previous call_later outcomes for contact ${contactId}`);
        } catch (err) {
          console.error('Error updating previous call_later outcomes:', err);
        }
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

  // Check that the Python voice agent is running
  try {
    const healthResp = await fetch(`${PYTHON_AGENT_URL}/health`, { signal: AbortSignal.timeout(3000) });
    if (!healthResp.ok) throw new Error(`Python agent health check failed: ${healthResp.status}`);
  } catch (err) {
    console.error('[VoiceAgent] Python agent not reachable at', PYTHON_AGENT_URL, '—', err.message);
    return res.status(503).json({
      error: 'Voice agent server is not running. Start it with: cd auvia-voice-agent && uv run python server.py'
    });
  }

  // Immediately insert the call record as 'in_progress' to lock the contact
  // so the simulator doesn't call them in parallel!
  let callId = null;
  try {
    const callResult = await db.query(
      `INSERT INTO calls (contact_id, campaign_id, clinic_id, attempt_number, call_status, started_at, telephony_call_id, amount)
       VALUES ($1, $2, $3, 1, 'queued', null, 'vobiz-pending', $4)
       RETURNING id`,
      [contact.id, campaignId, req.clinicId, parseFloat(contact.amount_due) || 0]
    );
    callId = callResult.rows[0].id;
  } catch (err) {
    console.error('Error creating queued call record:', err);
    return res.status(500).json({ error: 'Failed to initialize call session' });
  }

  // Fetch clinic details from DB, fallback to VOBIZ environment variables
  let clinicPhone = process.env.VOBIZ_FROM_NUMBER || '+14155551234';
  let authId = process.env.VOBIZ_AUTH_ID || 'MA_XXXXXX';
  let authToken = process.env.VOBIZ_AUTH_TOKEN || 'your_vobiz_auth_token';
  let clinicSystemPrompt = null; // will override pipeline.py default if set
  let clinicName = 'Auvia Wellness';

  try {
    const clinicResult = await db.query(
      `SELECT phone, vobiz_auth_id, vobiz_auth_token, system_prompt, name FROM clinics WHERE id = $1 LIMIT 1`,
      [req.clinicId]
    );
    if (clinicResult.rows.length > 0) {
      const row = clinicResult.rows[0];
      if (row.phone) clinicPhone = row.phone;
      if (row.vobiz_auth_id) authId = row.vobiz_auth_id;
      if (row.vobiz_auth_token) authToken = row.vobiz_auth_token;
      if (row.system_prompt) clinicSystemPrompt = row.system_prompt;
      if (row.name) clinicName = row.name;
    }
  } catch (err) {
    console.error('Error fetching clinic phone and vobiz credentials:', err);
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

  // Notify Python standalone agent — it will be ready when Vobiz WebSocket arrives
  const payloadForPython = {
    callId,
    campaignId,
    clinicId: req.clinicId,
    clinicName,
    contactId:   contact?.id || '',
    contactName: contact?.name || '',
    contactPhone: contact?.phone || '',
    contactAmount: contact?.amount_due ? String(contact.amount_due) : '',
    paymentReason,
    systemPrompt: clinicSystemPrompt || '',
  };

  try {
    const prepResp = await fetch(`${PYTHON_AGENT_URL}/call/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadForPython),
      signal: AbortSignal.timeout(5000),
    });
    if (!prepResp.ok) {
      const errBody = await prepResp.text();
      throw new Error(`Python agent prepare failed: ${prepResp.status} ${errBody}`);
    }
    console.log(`[VoiceAgent] Python agent prepared session for call ${callId}`);
  } catch (err) {
    console.error('[VoiceAgent] Failed to prepare Python agent session:', err.message);
    await db.query(`UPDATE calls SET call_status='failed', ended_at=now() WHERE id=$1`, [callId]);
    return res.status(503).json({ error: 'Failed to prepare voice agent session' });
  }

  // Track session (no subprocess anymore)
  runningBots.set(campaignId, {
    process: null,  // no subprocess
    startedAt: new Date(),
    campaignId,
    clinicId: req.clinicId,
  });

  // Place outbound call using Vobiz REST API
  const vobizUrl = `https://api.vobiz.ai/api/v1/Account/${authId}/Call/`;
  const publicUrl = process.env.PUBLIC_URL || 'http://localhost:5001';

  try {
    const vobizResp = await fetch(vobizUrl, {
      method: 'POST',
      headers: {
        'X-Auth-ID': authId,
        'X-Auth-Token': authToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: clinicPhone.replace(/\D/g, ''),
        to: contact.phone.replace(/\D/g, ''),
        answer_url: `${publicUrl}/api/voice/vobiz-answer?callId=${callId}`,
        answer_method: 'POST',
        hangup_url: `${publicUrl}/api/voice/vobiz-hangup?callId=${callId}`,
        hangup_method: 'POST',
        // Recording webhook — Vobiz will POST recording details here when ready
        record: true,
        record_url: `${publicUrl}/api/voice/vobiz-recording?callId=${callId}`,
        record_method: 'POST',
      })
    });

    const vobizData = await vobizResp.json().catch(() => ({}));
    if (!vobizResp.ok) {
      console.error('[Vobiz] API error details:', {
        status: vobizResp.status,
        url: vobizUrl,
        authId,
        from: clinicPhone.replace(/\D/g, ''),
        to: contact.phone.replace(/\D/g, ''),
        publicUrl,
        response: JSON.stringify(vobizData),
      });
      throw new Error(`Vobiz API error ${vobizResp.status}: ${JSON.stringify(vobizData)}`);
    }

    const telephonyId = vobizData.request_uuid || vobizData.api_id || 'vobiz-call';
    await db.query(
      `UPDATE calls SET telephony_call_id = $1, amount = $2 WHERE id = $3`,
      [telephonyId, parseFloat(contact.amount_due) || 0, callId]
    );
    console.log(`[Vobiz] Successfully placed outbound call. Call ID: ${callId}, Telephony ID: ${telephonyId}`);

  } catch (err) {
    console.error('[Vobiz] Outbound call trigger failed:', err);
    try { botProcess.kill('SIGKILL'); } catch (_) {}
    return res.status(500).json({ error: 'Failed to trigger Vobiz telephony call' });
  }

  res.json({
    success: true,
    message: 'Vobiz outbound call initiated successfully.',
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
    callbackDate,
    callbackTime,
    billing,
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
    const creditsBilled = Math.ceil(durSecs / 60);

    // Deduct credits from clinic
    if (creditsBilled > 0) {
      await db.query(
        `UPDATE clinics SET credits = COALESCE(credits, 0) - $1 WHERE id = $2`,
        [creditsBilled, clinicId]
      );
    }

    let finalCallId = callId;

    if (callId) {
      // ── Path A: Call record already pre-inserted in /start — update it ──
      await db.query(
        `UPDATE calls
         SET call_status = 'completed',
             outcome = $1,
             sentiment = $2,
             ai_summary = $3,
             transcript = $4,
             recording_url = COALESCE(recording_url, $5),
             duration_seconds = $6,
             callback_date = $7,
             callback_time = $8,
             ended_at = now(),
             amount = $9,
             billing = $10
         WHERE id = $11`,
        [
          safeOutcome,
          sentiment || 'neutral',
          aiSummary || null,
          transcript ? JSON.stringify(transcript) : null,
          recordingUrl || null,
          durSecs,
          callbackDate || null,
          callbackTime || null,
          creditsBilled,
          billing ? JSON.stringify(billing) : null,
          callId,
        ]
      );
    } else {
      // ── Path B: Legacy fallback — insert a new call record ──
      const insertCallRes = await db.query(
        `INSERT INTO calls
           (contact_id, campaign_id, clinic_id, call_status, outcome, sentiment,
            ai_summary, transcript, recording_url, duration_seconds, callback_date, callback_time, started_at, ended_at, telephony_call_id, amount, billing)
         VALUES ($1, $2, $3, 'completed', $4, $5, $6, $7, $8, $9, $10, $11, now() - ($12 * interval '1 second'), now(), 'pipecat-webrtc', $13, $14)
         RETURNING id`,
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
          callbackDate || null,
          callbackTime || null,
          durSecs,
          creditsBilled,
          billing ? JSON.stringify(billing) : null,
        ]
      );
      finalCallId = insertCallRes.rows[0]?.id;
    }

    // Insert call cost breakdown for cost analytics
    if (billing) {
      try {
        const b = typeof billing === 'string' ? JSON.parse(billing) : billing;
        await db.query(
          `INSERT INTO public.call_cost_breakdown (
             call_id, clinic_id, duration_seconds, duration_minutes, stt_cost, stt_provider, 
             tts_cost, tts_provider, llm_in_cost, llm_out_cost, telephony_cost, telephony_provider, 
             other_cost, credits_billed, total_cost, bill
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            finalCallId || null,
            clinicId,
            b.duration || durSecs,
            (b.duration || durSecs) / 60.0,
            b.stt_cost || 0,
            'sarvam',
            b.tts_cost || 0,
            'smallest',
            (b.llm_cost || 0) * 0.4, // split LLM cost between in and out
            (b.llm_cost || 0) * 0.6,
            b.telephony_cost || 0,
            'vobiz',
            0, // other_cost
            creditsBilled,
            b.total_cost || 0,
            JSON.stringify(b)
          ]
        );
      } catch (cbErr) {
        console.error('Error inserting call cost breakdown:', cbErr);
      }
    }

    await db.query('COMMIT');

    // Trigger asynchronous check for campaign completion
    if (campaignId) {
      checkAndCompleteCampaign(campaignId).catch(err => {
        console.error('[CampaignCompletion] Error in async check:', err);
      });
    }

    const savedName = existingContactId ? (name || 'CSV Contact') : (name || 'Unknown');
    console.log(`[VoiceLead] Saved lead "${savedName}" for campaign ${campaignId.slice(0, 8)}${recordingUrl ? ' [+recording]' : ''}`);
    res.json({ success: true, contactId, message: 'Lead captured successfully' });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Error saving voice lead:', err);
    res.status(500).json({ error: 'Failed to save lead data' });
  }
});

// ─── 5. POST /api/voice/vobiz-answer — XML response for stream ──────────────────
router.post('/vobiz-answer', async (req, res) => {
  const { callId } = req.query;
  console.log(`[VobizAnswer] Call answered. Returning Stream XML for call ${callId}`);

  try {
    if (callId) {
      await db.query(
        `UPDATE calls SET call_status = 'in_progress', started_at = now(), updated_at = now() WHERE id = $1`,
        [callId]
      );
    }
  } catch (err) {
    console.error('Error updating call status to in_progress on answer:', err);
  }

  const publicUrl = process.env.PUBLIC_URL || 'http://localhost:5001';
  const host = publicUrl.replace(/^https?:\/\//, '');
  const wsUrl = `wss://${host}/api/voice/ws/${callId}`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Record 
        recordSession="true" 
        redirect="false" 
        maxLength="7200"
        callbackUrl="${publicUrl}/api/voice/vobiz-recording?callId=${callId}" 
        callbackMethod="POST" 
        playBeep="false" 
        fileFormat="mp3" 
    />
    <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">${wsUrl}</Stream>
    <Hangup/>
</Response>`;

  res.set('Content-Type', 'text/xml');
  res.send(xml);
});

// ─── 6. POST /api/voice/vobiz-hangup — Cleanup on call end ───────────────────────
router.post('/vobiz-hangup', async (req, res) => {
  const { callId } = req.query;
  console.log(`[VobizHangup] Call ended for callId ${callId}`);

  let foundCampaignId = null;
  try {
    const callResult = await db.query(
      `SELECT campaign_id, call_status FROM calls WHERE id = $1 LIMIT 1`,
      [callId]
    );
    if (callResult.rows.length > 0) {
      foundCampaignId = callResult.rows[0].campaign_id;
      const currentStatus = callResult.rows[0].call_status;

      // If status is still queued or in_progress, mark it completed
      if (['in_progress', 'queued'].includes(currentStatus)) {
        await db.query(
          `UPDATE calls 
           SET call_status = 'completed', 
               ended_at = COALESCE(ended_at, now()),
               updated_at = now()
           WHERE id = $1`,
          [callId]
        );
      }
    }
  } catch (err) {
    console.error('Error handling call record on hangup:', err);
  }

  if (foundCampaignId) {
    if (runningBots.has(foundCampaignId)) {
      console.log(`[VobizHangup] Cleaning up session for campaign ${foundCampaignId}`);
      runningBots.delete(foundCampaignId);
      // Note: Python voice agent manages its own lifecycle per call
    }
    checkAndCompleteCampaign(foundCampaignId).catch(err => {
      console.error('[CampaignCompletion] Error in async check:', err);
    });
  }

  res.json({ success: true });
});

// ─── 7. POST /api/voice/vobiz-recording — Recording ready callback from Vobiz ─

router.post('/vobiz-recording', async (req, res) => {
  console.log(`[VobizRecording] Webhook received — Query:`, req.query, `Body:`, req.body);
  // Vobiz sends recording details after a call ends and recording is processed
  const body = req.body || {};
  // Accept both camelCase, PascalCase and snake_case field names from Vobiz
  const vobizCallSid = body.call_uuid || body.CallUUID || body.callUuid || body.CallSid || body.request_uuid || req.query.callId || null;
  const recordingUrl  = body.recording_url || body.RecordingURL || body.recordingUrl || body.RecordingUrl || body.RecordUrl || null;
  const recordingSid  = body.recording_id  || body.recordingId  || body.recordingSid || null;

  console.log(`[VobizRecording] Webhook received — call_uuid=${vobizCallSid}, recording_url=${recordingUrl}`);

  if (!vobizCallSid && !req.query.callId) {
    return res.status(400).json({ error: 'call_uuid or callId required' });
  }

  try {
    // Find the matching call by telephony_call_id (Vobiz call UUID)
    // or by our own internal call ID if passed as query param
    let updateQuery;
    let updateParams;

    if (req.query.callId) {
      // Internal call ID provided directly (from answer_url pattern)
      updateQuery = `
        UPDATE calls
        SET recording_url  = COALESCE($1, recording_url),
            vobiz_call_sid = COALESCE($2, vobiz_call_sid),
            call_status    = CASE WHEN call_status = 'in_progress' THEN 'completed' ELSE call_status END,
            ended_at       = COALESCE(ended_at, now())
        WHERE id = $3
        RETURNING id, campaign_id`;
      updateParams = [recordingUrl, recordingSid || vobizCallSid, req.query.callId];
    } else {
      // Match via Vobiz telephony SID
      updateQuery = `
        UPDATE calls
        SET recording_url  = COALESCE($1, recording_url),
            vobiz_call_sid = COALESCE($2, vobiz_call_sid),
            call_status    = CASE WHEN call_status = 'in_progress' THEN 'completed' ELSE call_status END,
            ended_at       = COALESCE(ended_at, now())
        WHERE telephony_call_id = $3
        RETURNING id, campaign_id`;
      updateParams = [recordingUrl, recordingSid || vobizCallSid, vobizCallSid];
    }

    const result = await db.query(updateQuery, updateParams);
    if (result.rows.length > 0) {
      console.log(`[VobizRecording] Saved recording URL for call ${result.rows[0].id}: ${recordingUrl}`);
    } else {
      console.warn(`[VobizRecording] No matching call found for call_uuid=${vobizCallSid}`);
    }
  } catch (err) {
    console.error('[VobizRecording] Failed to save recording URL:', err);
    return res.status(500).json({ error: 'Failed to save recording' });
  }

  res.json({ success: true });
});

export default router;
