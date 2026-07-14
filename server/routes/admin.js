import express from 'express';
import db from '../db.js';
import authMiddleware from '../middleware/auth.js';

const router = express.Router();

// All authenticated users can access admin routes
const adminAuth = [authMiddleware];

// 1. GET /api/admin/clinics - List all clinics on the platform
router.get('/clinics', adminAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*, 
              (SELECT count(*) FROM campaigns WHERE clinic_id = c.id) as campaign_count,
              (SELECT count(*) FROM contacts WHERE clinic_id = c.id) as contact_count,
              (SELECT count(*) FROM calls WHERE clinic_id = c.id) as call_count
       FROM clinics c
       ORDER BY c.name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Admin API error listing clinics:', err);
    res.status(500).json({ error: 'Failed to retrieve clinics' });
  }
});

// 2. GET /api/admin/clinics/:id - Get detailed settings for a clinic
router.get('/clinics/:id', adminAuth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM clinics WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Clinic not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Admin API error fetching clinic:', err);
    res.status(500).json({ error: 'Failed to retrieve clinic settings' });
  }
});

// 3. PUT /api/admin/clinics/:id - Update clinic parameters and credentials
router.put('/clinics/:id', adminAuth, async (req, res) => {
  const {
    name, slug, address, city, state, phone, billing_email, status,
    razorpay_key_id, razorpay_key_secret, whatsapp_sender_id, sms_sender_id,
    preferred_channel, max_retry_attempts, retry_cooldown_hours,
    calling_window_start, calling_window_end, max_concurrent_calls, credits
  } = req.body;

  try {
    const result = await db.query(
      `UPDATE clinics
       SET name = $1, slug = $2, address = $3, city = $4, state = $5, phone = $6,
           billing_email = $7, status = $8, razorpay_key_id = $9, razorpay_key_secret = $10,
           whatsapp_sender_id = $11, sms_sender_id = $12, preferred_channel = $13,
           max_retry_attempts = $14, retry_cooldown_hours = $15, calling_window_start = $16,
           calling_window_end = $17, max_concurrent_calls = $18, credits = $19, updated_at = now()
       WHERE id = $20
       RETURNING *`,
      [
        name, slug, address, city, state, phone, billing_email, status,
        razorpay_key_id, razorpay_key_secret, whatsapp_sender_id, sms_sender_id,
        preferred_channel, max_retry_attempts, retry_cooldown_hours,
        calling_window_start, calling_window_end, max_concurrent_calls,
        credits !== undefined ? parseInt(credits) : 0,
        req.params.id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Clinic not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Admin API error updating clinic:', err);
    res.status(500).json({ error: 'Failed to update clinic settings' });
  }
});

// 4. GET /api/admin/clinics/:id/calls - Fetch call logs for a specific clinic
router.get('/clinics/:id/calls', adminAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*, cont.name as customer_name, cont.phone as customer_phone, camp.name as campaign_name
       FROM calls c
       JOIN contacts cont ON cont.id = c.contact_id
       JOIN campaigns camp ON camp.id = c.campaign_id
       WHERE c.clinic_id = $1
       ORDER BY c.created_at DESC LIMIT 100`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Admin API error fetching clinic calls:', err);
    res.status(500).json({ error: 'Failed to retrieve clinic call logs' });
  }
});

// 5. GET /api/admin/clinics/:id/audit-logs - Fetch audit logs for a specific clinic
router.get('/clinics/:id/audit-logs', adminAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT a.*,
              u.full_name as user_name,
              u.email    as user_email
       FROM audit_logs a
       LEFT JOIN app_users u ON LOWER(u.email::text) = LOWER(
         (SELECT email::text FROM app_users WHERE id = a.actor_id LIMIT 1)
       )
       WHERE a.clinic_id = $1
       ORDER BY a.created_at DESC LIMIT 100`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Admin API error fetching clinic audit logs:', err);
    res.status(500).json({ error: 'Failed to retrieve clinic audit logs' });
  }
});

// 5a. GET /api/admin/clinics/:id/activity-logs - Fetch live activity logs for a specific clinic
router.get('/clinics/:id/activity-logs', adminAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM public.activity_log
       WHERE clinic_id = $1
       ORDER BY created_at DESC LIMIT 100`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    // Table may not exist yet — return empty list instead of 500
    if (err.code === '42P01') return res.json([]);
    console.error('Admin API error fetching clinic activity logs:', err);
    res.status(500).json({ error: 'Failed to retrieve clinic activity logs' });
  }
});

// 5b. GET /api/admin/clinics/:id/credit-transactions - Fetch credits transactions history for a specific clinic
router.get('/clinics/:id/credit-transactions', adminAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM public.credit_transactions
       WHERE clinic_id = $1
       ORDER BY created_at DESC LIMIT 100`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    // Table may not exist yet — return empty list instead of 500
    if (err.code === '42P01') return res.json([]);
    console.error('Admin API error fetching clinic credit history:', err);
    res.status(500).json({ error: 'Failed to retrieve clinic credit history' });
  }
});

// 6. GET /api/admin/analytics - Fetch platform-wide cost analytics and breakdowns
router.get('/analytics', adminAuth, async (req, res) => {
  const { startDate, endDate } = req.query;
  
  let dateFilter = '';
  const queryParams = [];
  
  if (startDate && endDate) {
    dateFilter = 'WHERE ccb.created_at >= $1 AND ccb.created_at <= $2';
    queryParams.push(new Date(startDate), new Date(endDate));
  }

  try {
    // 1. Fetch aggregates
    const aggregatesQuery = await db.query(
      `SELECT 
         COALESCE(SUM(total_cost), 0) as total_spend,
         COUNT(*) as total_calls,
         COALESCE(AVG(total_cost), 0) as avg_cost,
         COALESCE(AVG(duration_seconds), 0) as avg_duration,
         COALESCE(SUM(stt_cost), 0) as total_stt,
         COALESCE(SUM(tts_cost), 0) as total_tts,
         COALESCE(SUM(llm_in_cost), 0) as total_llm_in,
         COALESCE(SUM(llm_out_cost), 0) as total_llm_out,
         COALESCE(SUM(telephony_cost), 0) as total_telephony,
         COALESCE(SUM(other_cost), 0) as total_other,
         COALESCE(SUM(llm_in_tokens), 0) as total_llm_in_tokens,
         COALESCE(SUM(llm_out_tokens), 0) as total_llm_out_tokens,
         COALESCE(SUM(tts_chars), 0) as total_tts_chars,
         COALESCE(SUM(credits_billed), 0) as total_credits_billed
       FROM public.call_cost_breakdown ccb
       ${dateFilter}`,
      queryParams
    );

    const aggregates = aggregatesQuery.rows[0];

    // 2. Fetch call breakdowns list
    const breakdownsQuery = await db.query(
      `SELECT ccb.*, cl.name as clinic_name
       FROM public.call_cost_breakdown ccb
       LEFT JOIN public.clinics cl ON cl.id = ccb.clinic_id
       ${dateFilter}
       ORDER BY ccb.created_at DESC LIMIT 100`,
      queryParams
    );

    // 3. Fetch margins / profits comparison
    const marginsQuery = await db.query(
      `SELECT 
         cl.name as clinic_name,
         COUNT(ccb.id) as call_count,
         COALESCE(SUM(ccb.credits_billed), 0) as credits_billed,
         COALESCE(SUM(ccb.total_cost), 0) as total_cost,
         (COALESCE(SUM(ccb.credits_billed), 0) - COALESCE(SUM(ccb.total_cost), 0)) as profit_margin
       FROM public.call_cost_breakdown ccb
       LEFT JOIN public.clinics cl ON cl.id = ccb.clinic_id
       GROUP BY cl.name
       ORDER BY profit_margin DESC`,
      []
    );

    res.json({
      aggregates,
      breakdowns: breakdownsQuery.rows,
      margins: marginsQuery.rows
    });
  } catch (err) {
    console.error('Admin API error fetching analytics:', err);
    res.status(500).json({ error: 'Failed to retrieve platform cost analytics' });
  }
});

// 7. GET /api/admin/users - List all users on the platform
router.get('/users', adminAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.full_name, u.email, u.user_type, u.platform_role, u.status, u.is_active, u.created_at, u.last_login_at,
              cm.clinic_id, c.name as clinic_name
       FROM app_users u
       LEFT JOIN clinic_members cm ON LOWER(cm.invited_email::text) = LOWER(u.email::text) AND cm.status = 'active'
       LEFT JOIN clinics c ON c.id = cm.clinic_id
       ORDER BY u.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Admin API error listing users:', err);
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
});

// 8. PUT /api/admin/users/:id/status - Update user status
router.put('/users/:id/status', adminAuth, async (req, res) => {
  const { status } = req.body;
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const result = await db.query(
      `UPDATE app_users SET status = $1 WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Admin API error updating user status:', err);
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

// 9. PUT /api/admin/users/:id - Update user type, role, and active state
router.put('/users/:id', adminAuth, async (req, res) => {
  const { user_type, platform_role, is_active } = req.body;
  
  try {
    const result = await db.query(
      `UPDATE app_users 
       SET user_type = $1, platform_role = $2, is_active = $3
       WHERE id = $4 
       RETURNING *`,
      [user_type, platform_role, is_active, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Admin API error updating user:', err);
    res.status(500).json({ error: 'Failed to update user details' });
  }
});

// 10. GET /api/admin/credits — Platform-wide credit management data
router.get('/credits', adminAuth, async (req, res) => {
  try {
    // 1. Clinics with credit balance + call count + total credits consumed + last recharge date
    const clinicsResult = await db.query(
      `SELECT
         c.id, c.name, c.city, c.state, c.status,
         c.credits,
         COUNT(DISTINCT cl.id)               AS call_count,
         COALESCE(SUM(ccb.credits_billed), 0) AS credits_consumed,
         MAX(ct.created_at)                  AS last_recharged
       FROM clinics c
       LEFT JOIN calls cl ON cl.clinic_id = c.id
       LEFT JOIN public.call_cost_breakdown ccb ON ccb.clinic_id = c.id
       LEFT JOIN public.credit_transactions ct
         ON ct.clinic_id = c.id AND COALESCE(ct.credits, 0) > 0
       GROUP BY c.id, c.name, c.city, c.state, c.status, c.credits
       ORDER BY c.name ASC`
    );

    // 2. All calls (platform-wide) with clinic + campaign + patient names
    const callsResult = await db.query(
      `SELECT
         ca.id, ca.clinic_id, ca.call_status, ca.outcome,
         ca.duration_seconds, ca.created_at,
         COALESCE(ccb.credits_billed, ca.amount, 0) AS credits_billed,
         cont.name  AS customer_name,
         cont.phone AS customer_phone,
         camp.name  AS campaign_name,
         cl.name    AS clinic_name
       FROM calls ca
       JOIN contacts cont ON cont.id = ca.contact_id
       JOIN campaigns camp ON camp.id = ca.campaign_id
       JOIN clinics cl ON cl.id = ca.clinic_id
       LEFT JOIN public.call_cost_breakdown ccb ON ccb.call_id = ca.id
       ORDER BY ca.created_at DESC
       LIMIT 500`
    );

    // 3. All credit transactions (platform-wide) with clinic names
    const paymentsResult = await db.query(
      `SELECT
         ct.*,
         cl.name AS clinic_name
       FROM public.credit_transactions ct
       LEFT JOIN clinics cl ON cl.id = ct.clinic_id
       ORDER BY ct.created_at DESC
       LIMIT 500`
    ).catch(() => ({ rows: [] })); // graceful fallback if table doesn't exist yet

    res.json({
      clinics: clinicsResult.rows,
      calls: callsResult.rows,
      payments: paymentsResult.rows,
    });
  } catch (err) {
    console.error('Admin API error fetching credit data:', err);
    res.status(500).json({ error: 'Failed to retrieve credit management data' });
  }
});

export default router;

