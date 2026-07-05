import express from 'express';
import db from '../db.js';
import authMiddleware from '../middleware/auth.js';

const router = express.Router();

// Helper middleware to ensure caller is a platform admin
function requirePlatformAdmin(req, res, next) {
  if (req.user && req.user.platform_role === 'platform_admin') {
    return next();
  }
  return res.status(403).json({ error: 'Access denied: Platform Admin privileges required' });
}

// Chained middleware for admin routes
const adminAuth = [authMiddleware, requirePlatformAdmin];

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
    calling_window_start, calling_window_end, max_concurrent_calls
  } = req.body;

  try {
    const result = await db.query(
      `UPDATE clinics
       SET name = $1, slug = $2, address = $3, city = $4, state = $5, phone = $6,
           billing_email = $7, status = $8, razorpay_key_id = $9, razorpay_key_secret = $10,
           whatsapp_sender_id = $11, sms_sender_id = $12, preferred_channel = $13,
           max_retry_attempts = $14, retry_cooldown_hours = $15, calling_window_start = $16,
           calling_window_end = $17, max_concurrent_calls = $18, updated_at = now()
       WHERE id = $19
       RETURNING *`,
      [
        name, slug, address, city, state, phone, billing_email, status,
        razorpay_key_id, razorpay_key_secret, whatsapp_sender_id, sms_sender_id,
        preferred_channel, max_retry_attempts, retry_cooldown_hours,
        calling_window_start, calling_window_end, max_concurrent_calls,
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
      `SELECT a.*, p.full_name as user_name, p.email as user_email
       FROM audit_logs a
       LEFT JOIN profiles p ON p.id = a.actor_id
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

export default router;
