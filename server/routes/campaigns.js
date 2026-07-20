import express from 'express';
import db from '../db.js';
import authMiddleware from '../middleware/auth.js';
import { startCampaignSimulation } from '../services/simulator.js';

const router = express.Router();


// Helper to format date
function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

// 1. GET /api/campaigns - List campaigns
router.get('/', authMiddleware, async (req, res) => {
  try {
    // If a clinicId is resolved, scope to that clinic; otherwise return all campaigns.
    const result = req.clinicId
      ? await db.query(
          `SELECT c.id, c.name, c.status, c.created_at, c.total_contacts, c.selected_contacts,
                  COALESCE(cs.total_pending_amount, 0) as total_pending_amount,
                  COALESCE(cs.total_collected, 0) as total_collected,
                  COALESCE(cs.calls_completed, 0) as calls_completed,
                  COALESCE(cs.calls_failed, 0) as calls_failed,
                  COALESCE(cs.calls_not_answered, 0) as calls_not_answered
           FROM campaigns c
           LEFT JOIN campaign_stats cs ON cs.campaign_id = c.id
           WHERE c.clinic_id = $1
           ORDER BY c.created_at DESC`,
          [req.clinicId]
        )
      : await db.query(
          `SELECT c.id, c.name, c.status, c.created_at, c.total_contacts, c.selected_contacts,
                  COALESCE(cs.total_pending_amount, 0) as total_pending_amount,
                  COALESCE(cs.total_collected, 0) as total_collected,
                  COALESCE(cs.calls_completed, 0) as calls_completed,
                  COALESCE(cs.calls_failed, 0) as calls_failed,
                  COALESCE(cs.calls_not_answered, 0) as calls_not_answered
           FROM campaigns c
           LEFT JOIN campaign_stats cs ON cs.campaign_id = c.id
           ORDER BY c.created_at DESC`
        );

    const formatted = result.rows.map((row) => {
      let collectionPercent = 0;
      const selected = parseInt(row.selected_contacts) || 0;
      const done = (parseInt(row.calls_completed) || 0) + (parseInt(row.calls_failed) || 0) + (parseInt(row.calls_not_answered) || 0);

      if (row.status === 'draft') {
        collectionPercent = 25;
      } else if (row.status === 'completed') {
        collectionPercent = 100;
      } else if (selected > 0) {
        collectionPercent = Math.min(100, Math.round((done / selected) * 100));
      }

      return {
        id: row.id,
        name: row.name,
        createdDate: formatDate(row.created_at),
        contacts: row.status === 'draft' && row.total_contacts === 0 ? null : row.selected_contacts,
        status: row.status,
        collectionPercent,
      };
    });

    res.json(formatted);
  } catch (err) {
    console.error('Error fetching campaigns:', err);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});


// 2. GET /api/campaigns/:id - Single campaign metadata
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const campaignResult = await db.query(
      `SELECT * FROM campaigns WHERE id = $1 AND clinic_id = $2 LIMIT 1`,
      [req.params.id, req.clinicId]
    );

    if (campaignResult.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const campaign = campaignResult.rows[0];
    res.json({
      id: campaign.id,
      clinicId: campaign.clinic_id,
      name: campaign.name,
      status: campaign.status,
      sourceCsvFilename: campaign.source_csv_filename,
      totalContacts: campaign.total_contacts,
      selectedContacts: campaign.selected_contacts,
      duplicateCount: campaign.duplicate_count,
      invalidCount: campaign.invalid_count,
      totalAmountDue: parseFloat(campaign.total_amount_due),
      createdAt: campaign.created_at,
    });
  } catch (err) {
    console.error('Error fetching campaign details:', err);
    res.status(500).json({ error: 'Failed to fetch campaign details' });
  }
});

// 3. POST /api/campaigns - Create a draft campaign
router.post('/', authMiddleware, async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Campaign name is required' });
  }

  try {
    const result = await db.query(
      `INSERT INTO campaigns (clinic_id, name, status, created_by)
       VALUES ($1, $2, 'draft', $3)
       RETURNING id, name, status, created_at`,
      [req.clinicId, name, req.user.sub]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating campaign:', err);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

// 4. GET /api/campaigns/:id/contacts - Get contacts in a campaign
router.get('/:id/contacts', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, phone, amount_due, payment_context, is_selected
       FROM contacts
       WHERE campaign_id = $1 AND clinic_id = $2
       ORDER BY name ASC`,
      [req.params.id, req.clinicId]
    );

    const formatted = result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      amount: parseFloat(r.amount_due),
      context: r.payment_context,
      selected: r.is_selected,
    }));

    res.json(formatted);
  } catch (err) {
    console.error('Error fetching campaign contacts:', err);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// Helper for contextual variants mapping in database
function mapContext(text) {
  if (!text || !text.trim()) return 'other';
  return text.trim().toLowerCase().replace(/\s+/g, '_');
}

// 5. POST /api/campaigns/:id/contacts - Bulk insert contacts (for CSV import)
router.post('/:id/contacts', authMiddleware, async (req, res) => {
  const { contacts, filename } = req.body; // array of { name, phone, amount, context }

  if (!contacts || !Array.isArray(contacts)) {
    return res.status(400).json({ error: 'Contacts list array is required' });
  }

  try {
    await db.query('BEGIN');

    // 1. Verify campaign exists and belongs to clinic
    const campCheck = await db.query(
      `SELECT id FROM campaigns WHERE id = $1 AND clinic_id = $2 LIMIT 1`,
      [req.params.id, req.clinicId]
    );

    if (campCheck.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // 2. Perform validations & count
    let duplicateCount = 0;
    let invalidCount = 0;
    let validContacts = [];
    const seenPhones = new Set();

    for (const c of contacts) {
      const name = c.name?.trim();
      const phone = c.phone?.trim();
      const amount = parseFloat(c.amount);

      if (!name || !phone || isNaN(amount) || amount < 0) {
        invalidCount++;
        continue;
      }

      // Check duplicates within the payload or DB
      if (seenPhones.has(phone)) {
        duplicateCount++;
        continue;
      }
      seenPhones.add(phone);
      validContacts.push(c);
    }

    // 3. Insert valid contacts
    let totalAmountDue = 0;
    for (const vc of validContacts) {
      const dbContext = mapContext(vc.context || '');
      const amount = parseFloat(vc.amount);
      totalAmountDue += amount;

      await db.query(
        `INSERT INTO contacts (campaign_id, clinic_id, name, phone, amount_due, payment_context, is_selected)
         VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [req.params.id, req.clinicId, vc.name, vc.phone, amount, dbContext]
      );
    }

    // 4. Update campaign info
    await db.query(
      `UPDATE campaigns
       SET source_csv_filename = $1,
           total_contacts = $2,
           selected_contacts = $2,
           duplicate_count = $3,
           invalid_count = $4,
           total_amount_due = $5
       WHERE id = $6`,
      [filename || 'import.csv', validContacts.length, duplicateCount, invalidCount, totalAmountDue, req.params.id]
    );

    await db.query('COMMIT');

    res.json({
      success: true,
      totalContacts: validContacts.length,
      duplicateCount,
      invalidCount,
      totalAmountDue,
    });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Error bulk uploading contacts:', err);
    res.status(500).json({ error: 'Failed to process and upload contacts' });
  }
});

// Toggle select contact inside a campaign (Review screen checkbox)
router.put('/:id/contacts/toggle', authMiddleware, async (req, res) => {
  const { contactId, isSelected } = req.body;
  
  try {
    await db.query('BEGIN');
    
    // Update contact selection
    await db.query(
      `UPDATE contacts SET is_selected = $1 WHERE id = $2 AND campaign_id = $3 AND clinic_id = $4`,
      [isSelected, contactId, req.params.id, req.clinicId]
    );

    // Recalculate campaign totals
    const aggResult = await db.query(
      `SELECT count(*) as selected_count, coalesce(sum(amount_due), 0) as total_amount
       FROM contacts
       WHERE campaign_id = $1 AND is_selected = true`,
      [req.params.id]
    );

    await db.query(
      `UPDATE campaigns
       SET selected_contacts = $1,
           total_amount_due = $2
       WHERE id = $3`,
      [parseInt(aggResult.rows[0].selected_count), parseFloat(aggResult.rows[0].total_amount), req.params.id]
    );

    await db.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Error toggling contact selection:', err);
    res.status(500).json({ error: 'Failed to update selection' });
  }
});

// 6. GET /api/campaigns/:id/summary - Campaign Summary metrics
router.get('/:id/summary', authMiddleware, async (req, res) => {
  try {
    const statsResult = await db.query(
      `SELECT * FROM campaign_stats WHERE campaign_id = $1 AND clinic_id = $2 LIMIT 1`,
      [req.params.id, req.clinicId]
    );

    const campResult = await db.query(
      `SELECT name, total_contacts FROM campaigns WHERE id = $1 AND clinic_id = $2 LIMIT 1`,
      [req.params.id, req.clinicId]
    );

    if (campResult.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const campaign = campResult.rows[0];
    const stats = statsResult.rows[0] || {
      selected_contacts: 0,
      total_pending_amount: 0,
    };

    const selectedCount = parseInt(stats.selected_contacts);
    const amountDue = parseFloat(stats.total_pending_amount);
    const avgBill = selectedCount > 0 ? amountDue / selectedCount : 0;
    
    // Mock calling rules estimation based on clinic settings
    const clinicResult = await db.query(
      `SELECT max_concurrent_calls FROM clinics WHERE id = $1 LIMIT 1`,
      [req.clinicId]
    );
    const concurrent = clinicResult.rows[0]?.max_concurrent_calls || 5;

    // Estimate duration: 3 mins average per call, distributed across concurrent channels
    const estimatedMinutes = Math.ceil((selectedCount * 3) / concurrent);

    res.json({
      campaignName: campaign.name,
      totalContacts: parseInt(campaign.total_contacts),
      selectedContacts: selectedCount,
      totalAmountDue: amountDue,
      averageBill: avgBill,
      estimatedDurationMinutes: estimatedMinutes,
    });
  } catch (err) {
    console.error('Error fetching campaign summary:', err);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// 7. GET /api/campaigns/:id/live - Live status dashboard
router.get('/:id/live', authMiddleware, async (req, res) => {
  try {
    // 1. Get campaign metadata
    const campaignRes = await db.query(
      `SELECT * FROM campaigns WHERE id = $1 AND clinic_id = $2 LIMIT 1`,
      [req.params.id, req.clinicId]
    );

    if (campaignRes.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const campaign = campaignRes.rows[0];

    // 2. Get call outcome stats
    const statsRes = await db.query(
      `SELECT 
         count(id) as total,
         count(id) filter (where call_status = 'completed') as completed,
         count(id) filter (where call_status = 'in_progress') as in_progress,
         count(id) filter (where call_status = 'queued') as queued,
         count(id) filter (where call_status = 'failed' or call_status = 'not_answered') as failed,
         count(id) filter (where outcome = 'paid_now' or outcome = 'already_paid') as collected_now,
         count(id) filter (where outcome = 'link_sent') as links_sent,
         count(id) filter (where outcome = 'call_later') as callbacks
       FROM calls
       WHERE campaign_id = $1`,
      [req.params.id]
    );

    const stats = statsRes.rows[0] || {
      total: 0, completed: 0, in_progress: 0, queued: 0, failed: 0, collected_now: 0, links_sent: 0, callbacks: 0
    };

    // 3. Get total payment statistics
    const payRes = await db.query(
      `SELECT 
         coalesce(sum(amount_paid), 0) as amount_collected,
         count(distinct payment_link_id) as paid_links_count
       FROM payments p
       JOIN contacts c ON c.id = p.contact_id
       WHERE c.campaign_id = $1`,
      [req.params.id]
    );
    const amountCollected = parseFloat(payRes.rows[0]?.amount_collected || 0);

    const activeCallsRes = await db.query(
      `SELECT c.id, cont.name as customer_name, cont.phone as customer_phone, c.call_status,
              CASE WHEN c.call_status = 'in_progress' AND c.started_at IS NOT NULL
                   THEN EXTRACT(EPOCH FROM (now() - c.started_at))::int
                   ELSE COALESCE(c.duration_seconds, 0) END as duration_seconds
       FROM calls c
       JOIN contacts cont ON cont.id = c.contact_id
       WHERE c.campaign_id = $1 AND c.call_status IN ('in_progress', 'queued')
       ORDER BY c.updated_at DESC LIMIT 5`,
      [req.params.id]
    );

    // 5. Get recent call logs
    const recentLogsRes = await db.query(
      `SELECT c.id, cont.name as customer_name, c.call_status, c.outcome, c.sentiment, c.duration_seconds, c.updated_at
       FROM calls c
       JOIN contacts cont ON cont.id = c.contact_id
       WHERE c.campaign_id = $1 AND c.call_status NOT IN ('queued')
       ORDER BY c.updated_at DESC LIMIT 10`,
      [req.params.id]
    );

    res.json({
      campaignName: campaign.name,
      status: campaign.status,
      stats: {
        totalCalls: parseInt(campaign.selected_contacts),
        completedCalls: parseInt(stats.completed) || 0,
        activeCalls: parseInt(stats.in_progress) || 0,
        queuedCalls: parseInt(stats.queued) || 0,
        failedCalls: parseInt(stats.failed) || 0,
        linksSent: parseInt(stats.links_sent) || 0,
        callbacks: parseInt(stats.callbacks) || 0,
        amountCollected,
        amountDue: parseFloat(campaign.total_amount_due),
        percentCollected: campaign.total_amount_due > 0 ? Math.round((amountCollected / parseFloat(campaign.total_amount_due)) * 100) : 0,
      },
      liveLines: activeCallsRes.rows.map(line => ({
        id: line.id,
        name: line.customer_name,
        phone: line.customer_phone,
        status: line.call_status === 'in_progress' ? 'connected' : 'dialing',
        duration: line.duration_seconds ? `${Math.floor(line.duration_seconds / 60)}m ${line.duration_seconds % 60}s` : '0m 00s'
      })),
      recentCalls: recentLogsRes.rows.map(log => ({
        id: log.id,
        name: log.customer_name,
        status: log.call_status,
        outcome: log.outcome,
        sentiment: log.sentiment || 'neutral',
        time: new Date(log.updated_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      }))
    });
  } catch (err) {
    console.error('Error fetching live campaign status:', err);
    res.status(500).json({ error: 'Failed to fetch live dashboard' });
  }
});

// 8. GET /api/campaigns/:id/report - Final summary report
router.get('/:id/report', authMiddleware, async (req, res) => {
  try {
    const campaignRes = await db.query(
      `SELECT * FROM campaigns WHERE id = $1 AND clinic_id = $2 LIMIT 1`,
      [req.params.id, req.clinicId]
    );

    if (campaignRes.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const campaign = campaignRes.rows[0];

    // 1. Total billed = sum of amount_due for selected contacts in this campaign
    const billedRes = await db.query(
      `SELECT COALESCE(SUM(amount_due), 0) AS total_billed
       FROM contacts
       WHERE campaign_id = $1 AND is_selected = true`,
      [req.params.id]
    );
    const totalBilled = parseFloat(billedRes.rows[0].total_billed);

    // 2. Total collected = sum of payments made for payment_links in this campaign
    const collectedRes = await db.query(
      `SELECT COALESCE(SUM(p.amount_paid), 0) AS total_collected
       FROM payments p
       JOIN payment_links pl ON pl.id = p.payment_link_id
       WHERE pl.campaign_id = $1`,
      [req.params.id]
    );
    const totalCollected = parseFloat(collectedRes.rows[0].total_collected);

    const successRate = totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 100) : 0;

    // 3. Call counts
    const callCountsRes = await db.query(
      `SELECT
        COUNT(*) FILTER (WHERE call_status = 'completed') AS calls_completed,
        COUNT(*) FILTER (WHERE call_status IN ('not_answered', 'failed')) AS calls_failed,
        ROUND(AVG(duration_seconds) FILTER (WHERE duration_seconds > 0)) AS avg_duration
       FROM calls
       WHERE campaign_id = $1`,
      [req.params.id]
    );
    const callCounts = callCountsRes.rows[0];
    const answeredCalls = parseInt(callCounts.calls_completed) || 0;
    const avgSecs = parseInt(callCounts.avg_duration) || 0;
    const avgCallDuration = avgSecs > 0
      ? `${Math.floor(avgSecs / 60)}m ${avgSecs % 60}s`
      : '—';

    // 4. Outcome breakdown
    const outcomesRes = await db.query(
      `SELECT outcome, count(*) as count
       FROM calls
       WHERE campaign_id = $1 AND call_status = 'completed' AND outcome IS NOT NULL
       GROUP BY outcome`,
      [req.params.id]
    );
    const outcomes = outcomesRes.rows.reduce((acc, row) => {
      acc[row.outcome] = parseInt(row.count);
      return acc;
    }, {});

    // 5. Sentiment distribution
    const sentimentRes = await db.query(
      `SELECT sentiment, count(*) as count
       FROM calls
       WHERE campaign_id = $1 AND sentiment IS NOT NULL
       GROUP BY sentiment`,
      [req.params.id]
    );
    const sentiments = sentimentRes.rows.reduce((acc, row) => {
      acc[row.sentiment] = parseInt(row.count);
      return acc;
    }, {});

    // Total selected contacts (the fixed denominator)
    const totalSelected = parseInt(campaign.selected_contacts) || 0;

    // 6. Calls list for this campaign
    const callsResult = await db.query(
      `SELECT c.id, cont.name as customer_name, cont.phone as customer_phone, cont.amount_due,
              c.campaign_id, camp.name as campaign_name, c.call_status, c.duration_seconds,
              c.ai_summary, c.recording_url, c.amount, c.vobiz_call_sid, pl.status as payment_link_status
       FROM calls c
       JOIN contacts cont ON cont.id = c.contact_id
       JOIN campaigns camp ON camp.id = c.campaign_id
       LEFT JOIN payment_links pl ON pl.call_id = c.id
       WHERE c.campaign_id = $1 AND c.clinic_id = $2
       ORDER BY c.created_at DESC`,
      [req.params.id, req.clinicId]
    );

    const formatDuration = (seconds) => {
      if (!seconds) return '0m 00s';
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return `${m}m ${s.toString().padStart(2, '0')}s`;
    };

    const getCallStatusLabel = (status) => {
      switch (status) {
        case 'completed': return 'Completed';
        case 'in_progress': return 'In Progress';
        case 'queued': return 'Queued';
        case 'not_answered': return 'Not Answered';
        case 'failed': return 'Failed';
        default: return 'Unknown';
      }
    };

    const getPaymentStatusLabel = (linkStatus) => {
      switch (linkStatus) {
        case 'paid': return 'Paid';
        case 'sent':
        case 'viewed': return 'Payment Link Sent';
        case 'created': return 'Link Created';
        case 'expired': return 'Link Expired';
        case 'cancelled': return 'Link Cancelled';
        default: return 'Unpaid';
      }
    };

    const formattedCalls = callsResult.rows.map((row) => ({
      id: row.id,
      name: row.customer_name,
      phone: row.customer_phone,
      amount: parseFloat(row.amount_due),
      callAmount: row.amount ? parseFloat(row.amount) : null,
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      callStatus: getCallStatusLabel(row.call_status),
      paymentStatus: getPaymentStatusLabel(row.payment_link_status),
      duration: formatDuration(row.duration_seconds),
      summary: row.ai_summary || 'No summary available.',
      hasRecording: !!row.recording_url,
      recordingUrl: row.recording_url || null,
      vobizCallSid: row.vobiz_call_sid || null,
    }));

    res.json({
      campaignName: campaign.name,
      status: campaign.status,
      completedDate: formatDate(campaign.completed_at || campaign.updated_at),
      stats: {
        totalCollected,
        totalBilled,
        successRate,
        totalCalls: totalSelected,
        answeredCalls,
        avgCallDuration,
      },
      outcomes: {
        paidNow: outcomes['paid_now'] || 0,
        alreadyPaid: outcomes['already_paid'] || 0,
        linkSent: outcomes['link_sent'] || 0,
        callLater: outcomes['call_later'] || 0,
        notInterested: outcomes['not_interested'] || 0,
        other: outcomes['other'] || 0,
      },
      sentiment: {
        positive: (sentiments['friendly'] || 0) + (sentiments['happy'] || 0),
        neutral: (sentiments['neutral'] || 0) + (sentiments['cooperative'] || 0),
        negative: (sentiments['frustrated'] || 0) + (sentiments['uncooperative'] || 0),
      },
      calls: formattedCalls
    });
  } catch (err) {
    console.error('Error fetching campaign report:', err);
    res.status(500).json({ error: 'Failed to fetch campaign report' });
  }
});

// 9. POST /api/campaigns/:id/start - Start campaign calling simulation
router.post('/:id/start', authMiddleware, async (req, res) => {
  const campaignId = req.params.id;
  try {
    // Check campaign details
    const result = await db.query(
      `SELECT status FROM campaigns WHERE id = $1 AND clinic_id = $2 LIMIT 1`,
      [campaignId, req.clinicId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const campaign = result.rows[0];
    if (campaign.status === 'completed') {
      return res.status(400).json({ error: 'Campaign is already completed' });
    }

    // Update status to active
    await db.query(
      `UPDATE campaigns 
       SET status = 'active', started_at = COALESCE(started_at, now()) 
       WHERE id = $1`,
      [campaignId]
    );

    // Disable the automatic backend simulation since we are now using the real Pipecat bot!
    // startCampaignSimulation(campaignId, req.clinicId);

    res.json({ success: true, message: 'Campaign started successfully' });
  } catch (err) {
    console.error('Error starting campaign:', err);
    res.status(500).json({ error: 'Failed to start campaign' });
  }
});

// 12. DELETE /api/campaigns/:id - Delete draft campaign
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const checkRes = await db.query(
      `SELECT id, status FROM campaigns WHERE id = $1 AND clinic_id = $2 LIMIT 1`,
      [req.params.id, req.clinicId]
    );

    if (checkRes.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (checkRes.rows[0].status !== 'draft') {
      return res.status(400).json({ error: 'Only draft campaigns can be deleted.' });
    }

    // Manually cascade deletes in dependency order to avoid FK constraint errors
    // (handles cases where live DB tables may not have cascade rules applied)
    await db.query(`
      DELETE FROM payments WHERE payment_link_id IN (
        SELECT id FROM payment_links WHERE campaign_id = $1
      )`, [req.params.id]);

    await db.query(`DELETE FROM payment_links WHERE campaign_id = $1`, [req.params.id]);

    await db.query(`DELETE FROM calls WHERE campaign_id = $1`, [req.params.id]);

    await db.query(`DELETE FROM contacts WHERE campaign_id = $1`, [req.params.id]);

    await db.query(`DELETE FROM campaigns WHERE id = $1`, [req.params.id]);

    res.json({ success: true, message: 'Draft campaign deleted successfully' });
  } catch (err) {
    console.error('Error deleting draft campaign:', err);
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

// 13. POST /api/campaigns/:id/stop - Stop/Complete an active campaign
router.post('/:id/stop', authMiddleware, async (req, res) => {
  const campaignId = req.params.id;
  try {
    const result = await db.query(
      `SELECT status FROM campaigns WHERE id = $1 AND clinic_id = $2 LIMIT 1`,
      [campaignId, req.clinicId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const campaign = result.rows[0];
    if (campaign.status !== 'active') {
      return res.status(400).json({ error: 'Only active campaigns can be stopped' });
    }

    await db.query(
      `UPDATE campaigns 
       SET status = 'completed', completed_at = now() 
       WHERE id = $1`,
      [campaignId]
    );

    res.json({ success: true, message: 'Campaign stopped successfully' });
  } catch (err) {
    console.error('Error stopping campaign:', err);
    res.status(500).json({ error: 'Failed to stop campaign' });
  }
});

export default router;
