import express from 'express';
import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from '../db.js';
import authMiddleware from '../middleware/auth.js';
import redisClient from '../redis.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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




// Python standalone voice agent URL
const VOICE_AGENT_BASE_URL = process.env.VOICE_AGENT_URL || process.env.PYTHON_AGENT_URL || 'http://localhost:8765';
const PYTHON_AGENT_URL = VOICE_AGENT_BASE_URL;

// Helper to derive WS URL from HTTP URL
const getWsUrl = (baseUrl) => {
  try {
    const url = new URL(baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.origin;
  } catch (e) {
    return 'ws://localhost:8765';
  }
};

// ─── 1. POST /api/voice/start — Spawn bot for a campaign ─────────────────────
// Helper function to trigger a single Vobiz call session
async function triggerSingleCall(contact, campaignId, clinicId) {
  // Clean phone number (strip +)
  if (contact && contact.phone) {
    contact.phone = contact.phone.replace('+', '');
  }

  // Immediately insert the call record as 'queued'
  const callResult = await db.query(
    `INSERT INTO calls (contact_id, campaign_id, clinic_id, attempt_number, call_status, started_at, telephony_call_id, amount)
     VALUES ($1, $2, $3, 1, 'queued', null, 'vobiz-pending', 0)
     RETURNING id`,
    [contact.id, campaignId, clinicId]
  );
  const callId = callResult.rows[0].id;

  let authId = process.env.VOBIZ_AUTH_ID || 'MA_XXXXXX';

  try {
    // Increment active calls in Redis and set TTL to 300 seconds
    await redisClient.incr(`active_calls:${clinicId}`);
    await redisClient.expire(`active_calls:${clinicId}`, 300);

    // Fetch clinic details from DB, fallback to VOBIZ environment variables
    let clinicPhone = process.env.VOBIZ_FROM_NUMBER || '+14155551234';
    let authToken = process.env.VOBIZ_AUTH_TOKEN || 'your_vobiz_auth_token';
    let clinicSystemPrompt = null;
    let clinicName = 'Auvia Wellness';

    const clinicResult = await db.query(
      `SELECT phone, vobiz_auth_id, vobiz_auth_token, system_prompt, name FROM clinics WHERE id = $1 LIMIT 1`,
      [clinicId]
    );
    if (clinicResult.rows.length > 0) {
      const row = clinicResult.rows[0];
      if (row.phone) clinicPhone = row.phone;
      if (row.vobiz_auth_id) authId = row.vobiz_auth_id;
      if (row.vobiz_auth_token) authToken = row.vobiz_auth_token;
      if (row.system_prompt) clinicSystemPrompt = row.system_prompt;
      if (row.name) clinicName = row.name;
    }

    // Build context string for the payment reason
    const contextLabels = {
      consultation_fee: 'consultation fee',
      lab_charges: 'lab charges',
      pharmacy_bill: 'pharmacy bill',
      admission_charges: 'admission charges',
      other: 'outstanding balance',
    };
    let paymentReason = contextLabels[contact.payment_context];
    if (!paymentReason) {
      if (contact.payment_context && contact.payment_context !== 'other') {
        paymentReason = contact.payment_context.replace(/_/g, ' ');
      } else {
        paymentReason = 'outstanding balance';
      }
    }

    // Notify Python standalone agent
    const payloadForPython = {
      callId,
      campaignId,
      clinicId,
      clinicName,
      contactId: contact.id || '',
      contactName: contact.name || '',
      contactPhone: contact.phone || '',
      contactAmount: contact.amount_due ? String(contact.amount_due) : '',
      paymentReason,
      systemPrompt: clinicSystemPrompt || '',
    };

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

    // Track session (no subprocess anymore)
    runningBots.set(campaignId, {
      process: null,
      startedAt: new Date(),
      campaignId,
      clinicId,
    });

    // Place outbound call using Vobiz REST API
    const vobizUrl = `https://api.vobiz.ai/api/v1/Account/${authId}/Call/`;
    const PUBLIC_API_URL = process.env.PUBLIC_API_URL || process.env.PUBLIC_URL || 'https://api2.nexovai.in';

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
        answer_url: `${PUBLIC_API_URL}/api/voice/handle-call?callId=${callId}`,
        answer_method: 'POST',
        hangup_url: `${PUBLIC_API_URL}/api/voice/vobiz-hangup?callId=${callId}`,
        hangup_method: 'POST',
        record: true,
        record_url: `${PUBLIC_API_URL}/api/voice/vobiz-recording?callId=${callId}`,
        record_method: 'POST',
      })
    });

    const vobizData = await vobizResp.json().catch(() => ({}));
    if (!vobizResp.ok) {
      throw new Error(`Vobiz API error ${vobizResp.status}: ${JSON.stringify(vobizData)}`);
    }

    const telephonyId = vobizData.request_uuid || vobizData.api_id || 'vobiz-call';
    await db.query(
      `UPDATE calls SET telephony_call_id = $1, amount = $2 WHERE id = $3`,
      [telephonyId, parseFloat(contact.amount_due) || 0, callId]
    );
    console.log(`[Vobiz] Successfully placed outbound call. Call ID: ${callId}, Telephony ID: ${telephonyId}`);
    return callId;

  } catch (err) {
    console.error(`[CRITICAL] Fetch failed for ${contact.phone}.`);
    console.error(`URL Attempted:`, `https://api.vobiz.ai/api/v1/Account/${authId}/Call/`);
    console.error(`Error details:`, err.cause || err);
    await db.query(`UPDATE calls SET call_status = 'failed', ended_at = now() WHERE id = $1`, [callId]);
    
    // Decrement the counter immediately if the call failed to place
    const currentCount = await redisClient.decr(`active_calls:${clinicId}`);
    if (currentCount < 0) {
      await redisClient.set(`active_calls:${clinicId}`, 0);
    }
    throw err;
  }
}

// ─── 1. POST /api/voice/start — Spawn bot for a campaign ─────────────────────
router.post('/start', authMiddleware, async (req, res) => {
  const { campaignId, contactId } = req.body;

  if (!campaignId) {
    return res.status(400).json({ error: 'campaignId is required' });
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

  try {
    // Verify campaign exists
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
      if (contactResult.rows.length === 0) {
        return res.status(404).json({ error: 'Contact not found' });
      }

      const contact = contactResult.rows[0];
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

      const callId = await triggerSingleCall(contact, campaignId, req.clinicId);
      return res.json({
        success: true,
        message: 'Vobiz outbound call initiated successfully.',
        callId
      });

    } else {
      // Pick all selected contacts that don't already have a completed/failed call
      const contactsResult = await db.query(
        `SELECT c.id, c.name, c.phone, c.amount_due, c.payment_context
         FROM contacts c
         WHERE c.campaign_id = $1
           AND c.is_selected = true
           AND NOT EXISTS (
             SELECT 1 FROM calls cl
             WHERE cl.contact_id = c.id
               AND cl.telephony_call_id != 'vobiz-pending'
               AND cl.call_status IN ('completed', 'failed')
           )
         ORDER BY c.created_at ASC`,
        [campaignId]
      );

      const contacts = contactsResult.rows;
      if (contacts.length === 0) {
        return res.status(404).json({ error: 'No uncalled contacts found for this campaign' });
      }

      // Respond to the frontend immediately so the UI doesn't freeze
      res.json({
        success: true,
        message: 'Campaign started! Dialing contacts...',
      });

      // Loop through the contacts in the background
      (async () => {
        for (const contact of contacts) {
          // Check if the campaign is still active before trying to make a call
          try {
            const campaignCheck = await db.query(
              `SELECT status FROM campaigns WHERE id = $1 LIMIT 1`,
              [campaignId]
            );
            if (campaignCheck.rows.length === 0 || campaignCheck.rows[0].status !== 'active') {
              console.log(`[VoiceAgent] Campaign ${campaignId} status is no longer active (${campaignCheck.rows[0]?.status}). Stopping dialer loop.`);
              break;
            }
          } catch (dbErr) {
            console.error('[VoiceAgent] Failed to check campaign status:', dbErr);
          }

          // Enforce concurrency limit (max_concurrent_calls)
          while (true) {
            try {
              // Re-check campaign status while waiting
              const campaignCheck = await db.query(
                `SELECT status FROM campaigns WHERE id = $1 LIMIT 1`,
                [campaignId]
              );
              if (campaignCheck.rows.length === 0 || campaignCheck.rows[0].status !== 'active') {
                console.log(`[VoiceAgent] Campaign ${campaignId} stopped during concurrency wait.`);
                return;
              }

              // Count currently active calls for this clinic via Redis
              const activeCountVal = await redisClient.get(`active_calls:${req.clinicId}`);
              const activeCount = parseInt(activeCountVal) || 0;

              // Fetch concurrency setting for clinic
              const clinicSettingsResult = await db.query(
                `SELECT max_concurrent_calls FROM clinics WHERE id = $1 LIMIT 1`,
                [req.clinicId]
              );
              const maxConcurrency = clinicSettingsResult.rows[0]?.max_concurrent_calls || 5;

              if (activeCount < maxConcurrency) {
                break; // Concurrency limit not reached, proceed to call
              }

              console.log(`[Concurrency] Clinic ${req.clinicId} reached max active calls limit (${activeCount}/${maxConcurrency}). Polling in 1s...`);
            } catch (pollErr) {
              console.error('[Concurrency] Failed to run concurrency poll checks:', pollErr);
            }
            await delay(1000);
          }

          // FIRE the call, but DO NOT use 'await' here.
          // By removing 'await', the call runs in the background concurrently!
          triggerSingleCall(contact, campaignId, req.clinicId).catch(err => {
            console.error(`[CRITICAL] Fetch failed for ${contact.phone}.`);
            console.error(`Error details:`, err.cause || err);
          });

          // Wait exactly 1 second before starting the next loop iteration (1 CPS limit)
          await delay(1000);
        }
      })();
    }
  } catch (err) {
    console.error('Error initiating call session:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Failed to start call session' });
    }
  }
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
  const expectedSecret = process.env.BOT_SECRET || process.env.AUVIA_BOT_SECRET;

  if (!expectedSecret) {
    console.error('[VoiceLead] BOT_SECRET is not configured on the backend');
    return res.status(500).json({ error: 'Server misconfigured: BOT_SECRET is required' });
  }

  if (botSecret !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized agent pipeline' });
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
             tts_cost, tts_provider, tts_chars, llm_in_cost, llm_in_tokens, llm_out_cost, llm_out_tokens, 
             telephony_cost, telephony_provider, whatsapp_cost, whatsapp_msg_type, other_cost, 
             credits_billed, total_cost, cost_per_minute, bill
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
          [
            finalCallId || null,
            clinicId,
            b.duration_seconds || b.duration || durSecs,
            b.duration_minutes || (b.duration || durSecs) / 60.0,
            b.stt_cost || 0,
            b.stt_provider || 'Sarvam',
            b.tts_cost || 0,
            b.tts_provider || 'Sarvam AI',
            b.tts_chars || 0,
            b.llm_in_cost || 0,
            b.llm_in_tokens || 0,
            b.llm_out_cost || 0,
            b.llm_out_tokens || 0,
            b.telephony_cost || 0,
            b.telephony_provider || 'Vobiz',
            b.whatsapp_cost || 0,
            b.whatsapp_msg_type || 'None',
            b.other_cost || 0,
            creditsBilled,
            b.total_cost || 0,
            b.cost_per_minute || 0,
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

// ─── 5. POST /api/voice/vobiz-answer & handle-call — XML response for stream ────
const handleAnswerCall = async (req, res) => {
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

  // 🚀 CRITICAL FIX: Hardcode your exact Coolify domain so Vobiz can reach the webhook!
  const PUBLIC_DOMAIN = 'https://collectagent.nexovai.in'; 
  const WSS_DOMAIN = 'collectagent.nexovai.in';

  const vobizXml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Record 
        recordSession="true" 
        redirect="false" 
        maxLength="7200"
        fileFormat="mp3" 
        callbackUrl="${PUBLIC_DOMAIN}/vobiz-recording?callId=${callId}"
        callbackMethod="POST"
    />
    <!-- 🚀 CRITICAL FIX: Explicitly enforce the wss:// protocol and path parameter -->
    <Stream 
        bidirectional="true" 
        keepCallAlive="true" 
        contentType="audio/x-mulaw;rate=8000"
    >wss://${WSS_DOMAIN}/ws/${callId}</Stream>
</Response>`;

  return res.type('text/xml').send(vobizXml);
};

router.post('/vobiz-answer', handleAnswerCall);
router.post('/handle-call', handleAnswerCall);

// ─── 6. POST /api/voice/vobiz-hangup — Cleanup on call end ───────────────────────
router.post('/vobiz-hangup', async (req, res) => {
  const { callId } = req.query;
  console.log(`[VobizHangup] Call ended for callId ${callId}`);

  let foundCampaignId = null;
  try {
    const callResult = await db.query(
      `SELECT campaign_id, clinic_id, call_status, outcome FROM calls WHERE id = $1 LIMIT 1`,
      [callId]
    );
    if (callResult.rows.length > 0) {
      const { campaign_id, clinic_id, call_status, outcome } = callResult.rows[0];
      foundCampaignId = campaign_id;
      const currentStatus = call_status;
      const currentOutcome = outcome;

      // Decrement the counter in Redis
      if (clinic_id) {
        const currentCount = await redisClient.decr(`active_calls:${clinic_id}`);
        if (currentCount < 0) {
          await redisClient.set(`active_calls:${clinic_id}`, 0);
        }
      }

      // If the outcome is not set (null) or is 'other', the call didn't reach a definitive outcome
      // (e.g. busy, unanswered, hung up early, no response). We convert it to callback queue.
      if (!currentOutcome || currentOutcome === 'other') {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const callbackDate = tomorrow.toISOString().split('T')[0];
        const callbackTime = '10:00:00';

        // Extract why it failed from the Vobiz payload, if provided
        const body = req.body || {};
        const query = req.query || {};
        const statusFromVobiz = (body.CallStatus || body.status || query.status || '').toLowerCase();
        const causeFromVobiz = (body.HangupCause || body.hangup_cause || '').toLowerCase();

        let label = 'Unanswered';
        if (currentStatus === 'in_progress') {
          label = 'Hung up';
        } else if (statusFromVobiz === 'busy' || causeFromVobiz === 'busy') {
          label = 'Busy';
        } else if (statusFromVobiz === 'no-answer' || causeFromVobiz === 'no-answer') {
          label = 'Unanswered';
        } else if (statusFromVobiz === 'failed' || causeFromVobiz === 'failed') {
          label = 'Failed';
        } else {
          label = currentStatus === 'queued' ? 'Unanswered' : 'Hung up';
        }

        await db.query(
          `UPDATE calls 
           SET call_status = 'completed', 
               outcome = 'call_later',
               callback_date = $1,
               callback_time = $2,
               amount = 0,               -- Ensure credits billed is 0 for failed/busy/early hangup calls
               ai_summary = $3,          -- Set summary to Busy / Hung up / Unanswered
               ended_at = COALESCE(ended_at, now()),
               updated_at = now()
           WHERE id = $4`,
          [callbackDate, callbackTime, label, callId]
        );
        console.log(`[VobizHangup] Call ${callId} failed or hung up early (outcome: ${currentOutcome || 'none'}). Marked as 'call_later' (${label}) and added to Callback Queue for ${callbackDate}`);
      } else {
        // If it already has a definitive outcome (e.g. paid_now, link_sent, not_interested),
        // we just mark the call as completed if it's still in queued or in_progress status.
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
    }
  } catch (err) {
    console.error('Error handling call record on hangup:', err);
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
