import express from 'express';
import db from '../db.js';
import authMiddleware from '../middleware/auth.js';

const router = express.Router();

// GET /api/dashboard - Retrieve filtered clinic-scoped dashboard analytics
router.get('/', authMiddleware, async (req, res) => {
  const clinicId = req.clinicId;
  if (!clinicId) {
    return res.status(400).json({ error: 'User does not belong to a clinic.' });
  }

  const { 
    trend = 'monthly', 
    spendTrend = 'weekly',
    campaignId, 
    status, 
    search, 
    payment, 
    startDate, 
    endDate, 
    period = 'all' // default to all time
  } = req.query;

  try {
    // 0. Query persistent clinic-wide campaigns list for the frontend selector dropdown
    const allCampaignsBriefRes = await db.query(
      `SELECT id, name FROM campaigns WHERE clinic_id = $1 ORDER BY created_at DESC`,
      [clinicId]
    );
    const allCampaignsBrief = allCampaignsBriefRes.rows;

    // 1. Resolve date range boundaries
    let startLimit = null;
    let endLimit = new Date();

    if (startDate && endDate) {
      startLimit = new Date(startDate);
      endLimit = new Date(endDate);
    } else if (period && period !== 'all') {
      const days = parseInt(period);
      if (!isNaN(days)) {
        startLimit = new Date();
        startLimit.setDate(startLimit.getDate() - days);
      }
    }

    // 2. Resolve matching campaigns based on filters (including Date Limits)
    let campQuery = `
      SELECT c.id, 
             COALESCE(cs.total_collected, 0) as collected, 
             COALESCE(cs.total_pending_amount, 0) as due
      FROM campaigns c
      LEFT JOIN campaign_stats cs ON cs.campaign_id = c.id
      WHERE c.clinic_id = $1`;
    const campParams = [clinicId];
    let paramIndex = 2;

    if (status && status !== 'All') {
      campQuery += ` AND c.status = $${paramIndex++}`;
      campParams.push(status.toLowerCase());
    }
    if (campaignId && campaignId !== 'All') {
      campQuery += ` AND c.id = $${paramIndex++}`;
      campParams.push(campaignId);
    }
    if (search) {
      campQuery += ` AND c.name ILIKE $${paramIndex++}`;
      campParams.push(`%${search}%`);
    }
    if (startLimit && endLimit) {
      campQuery += ` AND c.created_at >= $${paramIndex++} AND c.created_at <= $${paramIndex++}`;
      campParams.push(startLimit.toISOString(), endLimit.toISOString());
    }

    const campRes = await db.query(campQuery, campParams);
    let matchedIds = campRes.rows.map(r => r.id);

    // Apply payment rating filter
    if (payment && payment !== 'All') {
      matchedIds = campRes.rows.filter(r => {
        const coll = parseFloat(r.collected);
        const due = parseFloat(r.due);
        const total = coll + due;
        const percent = total > 0 ? (coll / total) * 100 : 0;
        if (payment === 'Highly Paid') return percent >= 80;
        if (payment === 'Moderately Paid') return percent >= 40 && percent < 80;
        if (payment === 'Low Collection') return percent < 40;
        return true;
      }).map(r => r.id);
    }

    // Return empty dashboard structure if no campaigns match
    if (matchedIds.length === 0) {
      return res.json({
        allCampaignsBrief,
        kpis: {
          totalCollected: 0,
          revenueGrowth: 0,
          totalDue: 0,
          activeCampaignsCount: 0,
          collectionRate: 0,
          avgCredits: 0,
          creditsGrowth: 0,
          roi: 0
        },
        trendData: [],
        breakdown: {
          Paid: { count: 0, amount: 0, percent: 0 },
          Pending: { count: 0, amount: 0, percent: 0 },
          Unpaid: { count: 0, amount: 0, percent: 0 }
        },
        campaignsList: [],
        callOutcomes: {
          paid: 0, callback: 0, noAnswer: 0, refused: 0,
          paidPercent: 0, callbackPercent: 0, noAnswerPercent: 0, refusedPercent: 0
        },
        spendVsRevenue: []
      });
    }

    // Parameters placeholder for matched campaign IDs e.g. IN ($2, $3, ...)
    const idsPlaceholder = matchedIds.map((_, i) => `$${i + 2}`).join(',');

    // KPI 1: Revenue Collected (total and monthly comparison)
    const revenueQuery = await db.query(
      `SELECT
         COALESCE(SUM(p.amount_paid), 0) as total_collected,
         COALESCE(SUM(CASE WHEN p.paid_at >= DATE_TRUNC('month', CURRENT_DATE) THEN p.amount_paid ELSE 0 END), 0) as current_month_collected,
         COALESCE(SUM(CASE WHEN p.paid_at >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') AND p.paid_at < DATE_TRUNC('month', CURRENT_DATE) THEN p.amount_paid ELSE 0 END), 0) as last_month_collected
       FROM payments p
       JOIN contacts ct ON ct.id = p.contact_id
       WHERE p.clinic_id = $1 AND ct.campaign_id IN (${idsPlaceholder})`,
      [clinicId, ...matchedIds]
    );
    const revRow = revenueQuery.rows[0];
    const totalCollected = parseFloat(revRow.total_collected);
    const currentMonthCollected = parseFloat(revRow.current_month_collected);
    const lastMonthCollected = parseFloat(revRow.last_month_collected);

    let revenueGrowth = 0;
    if (lastMonthCollected > 0) {
      revenueGrowth = Math.round(((currentMonthCollected - lastMonthCollected) / lastMonthCollected) * 100);
    } else if (currentMonthCollected > 0) {
      revenueGrowth = 100;
    }

    // KPI 2: Total Amount Due & Active Campaigns
    const dueQuery = await db.query(
      `SELECT COALESCE(SUM(amount_due), 0) as total_due
       FROM contacts
       WHERE clinic_id = $1 AND is_selected = true AND campaign_id IN (${idsPlaceholder})`,
      [clinicId, ...matchedIds]
    );
    const totalDue = parseFloat(dueQuery.rows[0].total_due);

    const activeCampaignsQuery = await db.query(
      `SELECT COUNT(*) as active_count
       FROM campaigns
       WHERE clinic_id = $1 AND status = 'active' AND id IN (${idsPlaceholder})`,
      [clinicId, ...matchedIds]
    );
    const activeCampaignsCount = parseInt(activeCampaignsQuery.rows[0].active_count);

    // KPI 3: Collection Rate
    const totalBilled = totalCollected + totalDue;
    const collectionRate = totalBilled > 0 ? parseFloat(((totalCollected / totalBilled) * 100).toFixed(1)) : 0;

    // KPI 4: Avg Credits Used per Call (and monthly comparison)
    const creditsQuery = await db.query(
      `SELECT
         COALESCE(AVG(credits_billed), 0) as avg_credits,
         COALESCE(AVG(CASE WHEN created_at >= DATE_TRUNC('month', CURRENT_DATE) THEN credits_billed END), 0) as current_month_avg,
         COALESCE(AVG(CASE WHEN created_at >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') AND created_at < DATE_TRUNC('month', CURRENT_DATE) THEN credits_billed END), 0) as last_month_avg
       FROM calls
       WHERE clinic_id = $1 AND call_status = 'completed' AND campaign_id IN (${idsPlaceholder})`,
      [clinicId, ...matchedIds]
    );
    const credRow = creditsQuery.rows[0];
    const avgCredits = parseFloat(parseFloat(credRow.avg_credits).toFixed(2));
    const currentMonthAvg = parseFloat(credRow.current_month_avg);
    const lastMonthAvg = parseFloat(credRow.last_month_avg);

    let creditsGrowth = 0;
    if (lastMonthAvg > 0) {
      creditsGrowth = Math.round(((currentMonthAvg - lastMonthAvg) / lastMonthAvg) * 100);
    } else if (currentMonthAvg > 0) {
      creditsGrowth = 100;
    }

    // Total Credits Billed (for ROI calculation)
    const totalCreditsQuery = await db.query(
      `SELECT COALESCE(SUM(credits_billed), 0) as total_credits
       FROM calls
       WHERE clinic_id = $1 AND campaign_id IN (${idsPlaceholder})`,
      [clinicId, ...matchedIds]
    );
    const totalCreditsBilled = parseFloat(totalCreditsQuery.rows[0].total_credits);
    const totalSpend = totalCreditsBilled * 5.0; // ₹5 per credit cost
    const roi = totalSpend > 0 ? parseFloat((totalCollected / totalSpend).toFixed(1)) : 0;

    // 3. Revenue Trend chart data (supports yearly, monthly, weekly, daily)
    let trendQuery = '';
    if (trend === 'daily') {
      trendQuery = `
        SELECT
          TO_CHAR(d, 'Dy') as label,
          COALESCE((SELECT SUM(p.amount_paid) FROM payments p JOIN contacts ct ON ct.id = p.contact_id WHERE p.clinic_id = $1 AND ct.campaign_id IN (${idsPlaceholder}) AND DATE_TRUNC('day', p.paid_at) = DATE_TRUNC('day', d)), 0) as collected,
          COALESCE((SELECT SUM(c.amount_due) FROM contacts c WHERE c.clinic_id = $1 AND c.is_selected = true AND c.campaign_id IN (${idsPlaceholder}) AND DATE_TRUNC('day', c.created_at) = DATE_TRUNC('day', d)), 0) as due
        FROM generate_series(
          DATE_TRUNC('day', CURRENT_DATE - INTERVAL '6 days'),
          DATE_TRUNC('day', CURRENT_DATE),
          '1 day'::interval
        ) d
        ORDER BY d ASC`;
    } else if (trend === 'weekly') {
      trendQuery = `
        SELECT
          'Wk ' || row_number() OVER (ORDER BY w) as label,
          COALESCE((SELECT SUM(p.amount_paid) FROM payments p JOIN contacts ct ON ct.id = p.contact_id WHERE p.clinic_id = $1 AND ct.campaign_id IN (${idsPlaceholder}) AND p.paid_at >= w AND p.paid_at < w + INTERVAL '7 days'), 0) as collected,
          COALESCE((SELECT SUM(c.amount_due) FROM contacts c WHERE c.clinic_id = $1 AND c.is_selected = true AND c.campaign_id IN (${idsPlaceholder}) AND c.created_at >= w AND c.created_at < w + INTERVAL '7 days'), 0) as due
        FROM generate_series(
          DATE_TRUNC('day', CURRENT_DATE - INTERVAL '27 days'),
          DATE_TRUNC('day', CURRENT_DATE),
          '7 days'::interval
        ) w
        ORDER BY w ASC`;
    } else if (trend === 'yearly') {
      trendQuery = `
        SELECT
          TO_CHAR(d, 'YYYY') as label,
          COALESCE((SELECT SUM(p.amount_paid) FROM payments p JOIN contacts ct ON ct.id = p.contact_id WHERE p.clinic_id = $1 AND ct.campaign_id IN (${idsPlaceholder}) AND DATE_TRUNC('year', p.paid_at) = DATE_TRUNC('year', d)), 0) as collected,
          COALESCE((SELECT SUM(c.amount_due) FROM contacts c WHERE c.clinic_id = $1 AND c.is_selected = true AND c.campaign_id IN (${idsPlaceholder}) AND DATE_TRUNC('year', c.created_at) = DATE_TRUNC('year', d)), 0) as due
        FROM generate_series(
          DATE_TRUNC('year', CURRENT_DATE - INTERVAL '2 years'),
          DATE_TRUNC('year', CURRENT_DATE),
          '1 year'::interval
        ) d
        ORDER BY d ASC`;
    } else {
      // monthly (default)
      trendQuery = `
        SELECT
          TO_CHAR(d, 'Mon') as label,
          COALESCE((SELECT SUM(p.amount_paid) FROM payments p JOIN contacts ct ON ct.id = p.contact_id WHERE p.clinic_id = $1 AND ct.campaign_id IN (${idsPlaceholder}) AND DATE_TRUNC('month', p.paid_at) = DATE_TRUNC('month', d)), 0) as collected,
          COALESCE((SELECT SUM(c.amount_due) FROM contacts c WHERE c.clinic_id = $1 AND c.is_selected = true AND c.campaign_id IN (${idsPlaceholder}) AND DATE_TRUNC('month', c.created_at) = DATE_TRUNC('month', d)), 0) as due
        FROM generate_series(
          DATE_TRUNC('month', CURRENT_DATE - INTERVAL '5 months'),
          DATE_TRUNC('month', CURRENT_DATE),
          '1 month'::interval
        ) d
        ORDER BY d ASC`;
    }

    const trendResult = await db.query(trendQuery, [clinicId, ...matchedIds]);
    const trendData = trendResult.rows.map(row => ({
      label: row.label,
      collected: parseFloat(row.collected),
      due: parseFloat(row.due)
    }));

    // 4. Payment Status Breakdown Donut
    const breakdownQuery = await db.query(
      `WITH contact_states AS (
         SELECT
           c.id,
           CASE
             WHEN EXISTS (
               SELECT 1 FROM payment_links pl
               WHERE pl.contact_id = c.id AND pl.status = 'paid'
             ) THEN 'Paid'
             WHEN EXISTS (
               SELECT 1 FROM payment_links pl
               WHERE pl.contact_id = c.id AND pl.status IN ('sent', 'viewed', 'created')
             ) THEN 'Pending'
             ELSE 'Unpaid'
           END as payment_state,
           c.amount_due
         FROM contacts c
         WHERE c.clinic_id = $1 AND c.is_selected = true AND c.campaign_id IN (${idsPlaceholder})
       )
       SELECT
         payment_state,
         COUNT(*) as count,
         COALESCE(SUM(amount_due), 0) as amount
       FROM contact_states
       GROUP BY payment_state`,
      [clinicId, ...matchedIds]
    );

    const breakdown = {
      Paid: { count: 0, amount: 0, percent: 0 },
      Pending: { count: 0, amount: 0, percent: 0 },
      Unpaid: { count: 0, amount: 0, percent: 0 }
    };

    let totalBreakdownCount = 0;
    breakdownQuery.rows.forEach(row => {
      const state = row.payment_state;
      if (breakdown[state]) {
        breakdown[state].count = parseInt(row.count);
        breakdown[state].amount = parseFloat(row.amount);
        totalBreakdownCount += parseInt(row.count);
      }
    });

    if (totalBreakdownCount > 0) {
      Object.keys(breakdown).forEach(key => {
        breakdown[key].percent = Math.round((breakdown[key].count / totalBreakdownCount) * 100);
      });
    }

    // 5. Campaign Performance Table
    const campaignsResult = await db.query(
      `SELECT
         c.id,
         c.name,
         c.status,
         c.total_contacts,
         COALESCE(cs.selected_contacts, 0) as selected_contacts,
         COALESCE(cs.calls_completed, 0) as calls_completed,
         COALESCE(cs.total_pending_amount, 0) as amount_due,
         COALESCE(cs.total_collected, 0) as amount_collected,
         COALESCE((
           SELECT SUM(credits_billed)
           FROM calls
           WHERE campaign_id = c.id
         ), 0) as credits_used
       FROM campaigns c
       LEFT JOIN campaign_stats cs ON cs.campaign_id = c.id
       WHERE c.clinic_id = $1 AND c.id IN (${idsPlaceholder})
       ORDER BY c.created_at DESC`,
      [clinicId, ...matchedIds]
    );

    const campaignsList = campaignsResult.rows.map(row => {
      const coll = parseFloat(row.amount_collected);
      const due = parseFloat(row.amount_due);
      const total = coll + due;
      const collectionPercent = total > 0 ? Math.round((coll / total) * 100) : 0;

      return {
        id: row.id,
        name: row.name,
        contacts: parseInt(row.selected_contacts),
        callsCompleted: parseInt(row.calls_completed),
        amountDue: due,
        amountCollected: coll,
        collectionPercent,
        creditsUsed: parseFloat(row.credits_used),
        status: row.status.charAt(0).toUpperCase() + row.status.slice(1)
      };
    });

    // 6. Call Outcomes
    const outcomesQuery = await db.query(
      `SELECT
         COUNT(*) filter (where outcome in ('paid_now', 'already_paid')) as paid,
         COUNT(*) filter (where outcome = 'call_later') as callback,
         COUNT(*) filter (where call_status = 'not_answered') as no_answer,
         COUNT(*) filter (where outcome = 'not_interested' or decline_reason is not null) as refused,
         COUNT(*) as total
       FROM calls
       WHERE clinic_id = $1 AND campaign_id IN (${idsPlaceholder})`,
      [clinicId, ...matchedIds]
    );
    const outcomesRow = outcomesQuery.rows[0];
    const totalCalls = parseInt(outcomesRow.total);
    const callOutcomes = {
      paid: parseInt(outcomesRow.paid) || 0,
      callback: parseInt(outcomesRow.callback) || 0,
      noAnswer: parseInt(outcomesRow.no_answer) || 0,
      refused: parseInt(outcomesRow.refused) || 0,
      paidPercent: totalCalls > 0 ? Math.round(((parseInt(outcomesRow.paid) || 0) / totalCalls) * 100) : 0,
      callbackPercent: totalCalls > 0 ? Math.round(((parseInt(outcomesRow.callback) || 0) / totalCalls) * 100) : 0,
      noAnswerPercent: totalCalls > 0 ? Math.round(((parseInt(outcomesRow.no_answer) || 0) / totalCalls) * 100) : 0,
      refusedPercent: totalCalls > 0 ? Math.round(((parseInt(outcomesRow.refused) || 0) / totalCalls) * 100) : 0
    };

    // 7. Spend vs Revenue ROI (supports yearly, monthly, weekly, daily)
    let spendVsRevQuery = '';
    if (spendTrend === 'daily') {
      spendVsRevQuery = `
        SELECT
          TO_CHAR(d, 'Dy') as label,
          COALESCE((SELECT SUM(credits_billed) * 5.0 FROM calls WHERE clinic_id = $1 AND campaign_id IN (${idsPlaceholder}) AND DATE_TRUNC('day', created_at) = DATE_TRUNC('day', d)), 0) as spend,
          COALESCE((SELECT SUM(p.amount_paid) FROM payments p JOIN contacts ct ON ct.id = p.contact_id WHERE p.clinic_id = $1 AND ct.campaign_id IN (${idsPlaceholder}) AND DATE_TRUNC('day', p.paid_at) = DATE_TRUNC('day', d)), 0) as revenue
        FROM generate_series(
          DATE_TRUNC('day', CURRENT_DATE - INTERVAL '6 days'),
          DATE_TRUNC('day', CURRENT_DATE),
          '1 day'::interval
        ) d
        ORDER BY d ASC`;
    } else if (spendTrend === 'weekly') {
      spendVsRevQuery = `
        SELECT
          'Wk ' || row_number() OVER (ORDER BY w) as label,
          COALESCE((SELECT SUM(credits_billed) * 5.0 FROM calls WHERE clinic_id = $1 AND campaign_id IN (${idsPlaceholder}) AND created_at >= w AND created_at < w + INTERVAL '7 days'), 0) as spend,
          COALESCE((SELECT SUM(p.amount_paid) FROM payments p JOIN contacts ct ON ct.id = p.contact_id WHERE p.clinic_id = $1 AND ct.campaign_id IN (${idsPlaceholder}) AND p.paid_at >= w AND p.paid_at < w + INTERVAL '7 days'), 0) as revenue
        FROM generate_series(
          DATE_TRUNC('day', CURRENT_DATE - INTERVAL '27 days'),
          DATE_TRUNC('day', CURRENT_DATE),
          '7 days'::interval
        ) w
        ORDER BY w ASC`;
    } else if (spendTrend === 'yearly') {
      spendVsRevQuery = `
        SELECT
          TO_CHAR(d, 'YYYY') as label,
          COALESCE((SELECT SUM(credits_billed) * 5.0 FROM calls WHERE clinic_id = $1 AND campaign_id IN (${idsPlaceholder}) AND DATE_TRUNC('year', created_at) = DATE_TRUNC('year', d)), 0) as spend,
          COALESCE((SELECT SUM(p.amount_paid) FROM payments p JOIN contacts ct ON ct.id = p.contact_id WHERE p.clinic_id = $1 AND ct.campaign_id IN (${idsPlaceholder}) AND DATE_TRUNC('year', p.paid_at) = DATE_TRUNC('year', d)), 0) as revenue
        FROM generate_series(
          DATE_TRUNC('year', CURRENT_DATE - INTERVAL '2 years'),
          DATE_TRUNC('year', CURRENT_DATE),
          '1 year'::interval
        ) d
        ORDER BY d ASC`;
    } else {
      // monthly
      spendVsRevQuery = `
        SELECT
          TO_CHAR(d, 'Mon') as label,
          COALESCE((SELECT SUM(credits_billed) * 5.0 FROM calls WHERE clinic_id = $1 AND campaign_id IN (${idsPlaceholder}) AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', d)), 0) as spend,
          COALESCE((SELECT SUM(p.amount_paid) FROM payments p JOIN contacts ct ON ct.id = p.contact_id WHERE p.clinic_id = $1 AND ct.campaign_id IN (${idsPlaceholder}) AND DATE_TRUNC('month', p.paid_at) = DATE_TRUNC('month', d)), 0) as revenue
        FROM generate_series(
          DATE_TRUNC('month', CURRENT_DATE - INTERVAL '5 months'),
          DATE_TRUNC('month', CURRENT_DATE),
          '1 month'::interval
        ) d
        ORDER BY d ASC`;
    }

    const spendVsRevResult = await db.query(spendVsRevQuery, [clinicId, ...matchedIds]);
    const spendVsRevenue = spendVsRevResult.rows.map(row => ({
      label: row.label,
      spend: parseFloat(row.spend),
      revenue: parseFloat(row.revenue)
    }));

    // Send response
    res.json({
      allCampaignsBrief,
      kpis: {
        totalCollected,
        revenueGrowth,
        totalDue,
        activeCampaignsCount,
        collectionRate,
        avgCredits,
        creditsGrowth,
        roi
      },
      trendData,
      breakdown,
      campaignsList,
      callOutcomes,
      spendVsRevenue
    });

  } catch (err) {
    console.error('Error compiling clinic dashboard:', err);
    res.status(500).json({ error: 'Failed to retrieve dashboard analytics' });
  }
});

export default router;
