import express from 'express';
import db from '../db.js';
import authMiddleware from '../middleware/auth.js';

const router = express.Router();

// Helper to calculate duration string
function formatDuration(seconds) {
  if (!seconds) return '0m 00s';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

// Map database call status enum to frontend display labels
function getCallStatusLabel(status) {
  switch (status) {
    case 'completed': return 'Completed';
    case 'in_progress': return 'In Progress';
    case 'queued': return 'Queued';
    case 'not_answered': return 'Not Answered';
    case 'failed': return 'Failed';
    default: return 'Unknown';
  }
}

// Map payment link and payment state to frontend display labels
function getPaymentStatusLabel(linkStatus) {
  switch (linkStatus) {
    case 'paid': return 'Paid';
    case 'sent':
    case 'viewed': return 'Payment Link Sent';
    case 'created': return 'Link Created';
    case 'expired': return 'Link Expired';
    case 'cancelled': return 'Link Cancelled';
    default: return 'Unpaid';
  }
}

// 1. GET /api/calls - Full call logs list
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.id, cont.name as customer_name, cont.phone as customer_phone, cont.amount_due,
              c.campaign_id, camp.name as campaign_name, c.call_status, c.duration_seconds,
              c.ai_summary, c.recording_url, pl.status as payment_link_status
       FROM calls c
       JOIN contacts cont ON cont.id = c.contact_id
       JOIN campaigns camp ON camp.id = c.campaign_id
       LEFT JOIN payment_links pl ON pl.call_id = c.id
       WHERE c.clinic_id = $1
       ORDER BY c.created_at DESC`,
      [req.clinicId]
    );

    const formatted = result.rows.map((row) => ({
      id: row.id,
      name: row.customer_name,
      phone: row.customer_phone,
      amount: parseFloat(row.amount_due),
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      callStatus: getCallStatusLabel(row.call_status),
      paymentStatus: getPaymentStatusLabel(row.payment_link_status),
      duration: formatDuration(row.duration_seconds),
      summary: row.ai_summary || 'No summary available.',
      hasRecording: !!row.recording_url,
    }));

    res.json(formatted);
  } catch (err) {
    console.error('Error fetching call logs:', err);
    res.status(500).json({ error: 'Failed to fetch call logs' });
  }
});

// 2. GET /api/calls/:id - Individual call detail drill-down
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.id, cont.name as customer_name, cont.phone as customer_phone, cont.amount_due,
              camp.name as campaign_name, c.call_status, c.duration_seconds, c.outcome,
              c.ai_summary, c.recording_url, c.transcript, c.sentiment,
              pl.status as payment_link_status, pl.short_url as payment_short_url,
              cont.notes as customer_notes
       FROM calls c
       JOIN contacts cont ON cont.id = c.contact_id
       JOIN campaigns camp ON camp.id = c.campaign_id
       LEFT JOIN payment_links pl ON pl.call_id = c.id
       WHERE c.id = $1 AND c.clinic_id = $2 LIMIT 1`,
      [req.params.id, req.clinicId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Call record not found' });
    }

    const row = result.rows[0];
    
    // Parse transcript JSON
    let parsedTranscript = [];
    if (row.transcript) {
      parsedTranscript = typeof row.transcript === 'string' ? JSON.parse(row.transcript) : row.transcript;
    }

    res.json({
      id: row.id,
      name: row.customer_name,
      phone: row.customer_phone,
      amount: parseFloat(row.amount_due),
      campaignName: row.campaign_name,
      callStatus: getCallStatusLabel(row.call_status),
      paymentStatus: getPaymentStatusLabel(row.payment_link_status),
      duration: formatDuration(row.duration_seconds),
      summary: row.ai_summary || 'No summary available.',
      hasRecording: !!row.recording_url,
      recordingUrl: row.recording_url,
      transcript: parsedTranscript,
      sentiment: row.sentiment || 'neutral',
      paymentUrl: row.payment_short_url || '',
      notes: row.customer_notes || '',
      outcome: row.outcome,
    });
  } catch (err) {
    console.error('Error fetching call details:', err);
    res.status(500).json({ error: 'Failed to fetch call details' });
  }
});

// 3. GET /api/callback-queue - Callback lists (where outcome = 'call_later')
router.get('/callback/queue', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.id as call_id, cont.campaign_id as campaign_id, cont.id as contact_id, cont.name, cont.phone, cont.amount_due, cont.payment_context,
              c.callback_date, c.callback_time, cont.notes
       FROM calls c
       JOIN contacts cont ON cont.id = c.contact_id
       WHERE c.clinic_id = $1 AND c.outcome = 'call_later' AND c.call_status = 'completed'
       ORDER BY c.callback_date ASC, c.callback_time ASC`,
      [req.clinicId]
    );

    const formatted = result.rows.map((row) => {
      let timeStr = 'Scheduled';
      if (row.callback_date) {
        const date = new Date(row.callback_date);
        const today = new Date();
        const tomorrow = new Date();
        tomorrow.setDate(today.getDate() + 1);

        const isToday = date.toDateString() === today.toDateString();
        const isTomorrow = date.toDateString() === tomorrow.toDateString();

        const baseDate = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const timeVal = row.callback_time ? row.callback_time.substring(0, 5) : '';
        timeStr = `${baseDate}${timeVal ? `, ${timeVal}` : ''}`;
      }

      return {
        id: row.call_id,
        campaignId: row.campaign_id,
        contactId: row.contact_id,
        name: row.name,
        phone: row.phone,
        amount: parseFloat(row.amount_due),
        context: row.payment_context ? row.payment_context.replace('_', ' ') : 'other',
        callbackTime: timeStr,
        notes: row.notes || 'Scheduled callback by request.',
      };
    });

    res.json(formatted);
  } catch (err) {
    console.error('Error fetching callback queue:', err);
    res.status(500).json({ error: 'Failed to fetch callback queue' });
  }
});

// 4. POST /api/calls/:id/feedback - Update call notes, reschedule, outcome
router.post('/:id/feedback', authMiddleware, async (req, res) => {
  const { notes, outcome, callbackDate, callbackTime } = req.body;

  try {
    await db.query('BEGIN');

    // 1. Get contact_id associated with this call
    const callCheck = await db.query(
      `SELECT contact_id FROM calls WHERE id = $1 AND clinic_id = $2 LIMIT 1`,
      [req.params.id, req.clinicId]
    );

    if (callCheck.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: 'Call record not found' });
    }

    const contactId = callCheck.rows[0].contact_id;

    // 2. Update contact notes
    if (notes !== undefined) {
      await db.query(
        `UPDATE contacts SET notes = $1 WHERE id = $2`,
        [notes, contactId]
      );
    }

    // 3. Update call outcome & callbacks
    if (outcome !== undefined) {
      await db.query(
        `UPDATE calls 
         SET outcome = $1,
             callback_date = $2,
             callback_time = $3
         WHERE id = $4`,
        [outcome || null, callbackDate || null, callbackTime || null, req.params.id]
      );
    }

    await db.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Error updating call feedback:', err);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

export default router;
