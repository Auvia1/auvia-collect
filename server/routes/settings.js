import express from 'express';
import db from '../db.js';
import authMiddleware from '../middleware/auth.js';

const router = express.Router();

// GET /api/settings - Fetch clinic configuration
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT name, razorpay_key_id, razorpay_key_secret,
              whatsapp_sender_id, sms_sender_id, preferred_channel,
              max_retry_attempts, retry_cooldown_hours,
              calling_window_start, calling_window_end, credits
       FROM clinics
       WHERE id = $1 LIMIT 1`,
      [req.clinicId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Clinic settings not found' });
    }

    const c = result.rows[0];
    res.json({
      organizationName: c.name,
      razorpayKeyId: c.razorpay_key_id || '',
      razorpayKeySecret: c.razorpay_key_secret || '',
      whatsappSenderId: c.whatsapp_sender_id || '',
      smsSenderId: c.sms_sender_id || '',
      preferredChannel: c.preferred_channel,
      maxRetryAttempts: c.max_retry_attempts,
      retryCooldownHours: c.retry_cooldown_hours,
      callingWindowStart: c.calling_window_start.substring(0, 5),
      callingWindowEnd: c.calling_window_end.substring(0, 5),
      credits: c.credits || 0,
    });
  } catch (err) {
    console.error('Error fetching settings:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// GET /api/settings/billing-history - Fetch credit recharge history
router.get('/billing-history', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, credits, amount, gst, total, status, payment_id as "paymentId", created_at as "createdAt"
       FROM credit_transactions
       WHERE clinic_id = $1
       ORDER BY created_at DESC`,
      [req.clinicId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching billing history:', err);
    res.status(500).json({ error: 'Failed to fetch billing history' });
  }
});

// POST /api/settings/recharge - Recharge credits
router.post('/recharge', authMiddleware, async (req, res) => {
  const { credits, amount } = req.body;
  if (!credits || !amount) {
    return res.status(400).json({ error: 'Credits and amount are required' });
  }

  const gst = amount * 0.18;
  const total = amount + gst;
  const paymentId = 'pay_Rb' + Math.random().toString(36).substring(2, 12);

  try {
    await db.query('BEGIN');

    // 1. Insert transaction
    const txResult = await db.query(
      `INSERT INTO credit_transactions (clinic_id, credits, amount, gst, total, status, payment_id)
       VALUES ($1, $2, $3, $4, $5, 'Success', $6)
       RETURNING id, status, payment_id as "paymentId", created_at as "createdAt"`,
      [req.clinicId, credits, amount, gst, total, paymentId]
    );

    // 2. Update clinic credit balance
    const clinicResult = await db.query(
      `UPDATE clinics
       SET credits = COALESCE(credits, 0) + $1
       WHERE id = $2
       RETURNING credits`,
      [credits, req.clinicId]
    );

    await db.query('COMMIT');

    res.json({
      success: true,
      transaction: txResult.rows[0],
      newBalance: clinicResult.rows[0].credits
    });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Error processing recharge:', err);
    res.status(500).json({ error: 'Failed to process recharge' });
  }
});

// PUT /api/settings - Update clinic configuration
router.put('/', authMiddleware, async (req, res) => {
  const {
    organizationName,
    razorpayKeyId,
    razorpayKeySecret,
    whatsappSenderId,
    smsSenderId,
    preferredChannel,
    maxRetryAttempts,
    retryCooldownHours,
    callingWindowStart,
    callingWindowEnd,
  } = req.body;

  try {
    await db.query(
      `UPDATE clinics
       SET name = COALESCE($1, name),
           razorpay_key_id = COALESCE($2, razorpay_key_id),
           razorpay_key_secret = COALESCE($3, razorpay_key_secret),
           whatsapp_sender_id = COALESCE($4, whatsapp_sender_id),
           sms_sender_id = COALESCE($5, sms_sender_id),
           preferred_channel = COALESCE($6, preferred_channel),
           max_retry_attempts = COALESCE($7, max_retry_attempts),
           retry_cooldown_hours = COALESCE($8, retry_cooldown_hours),
           calling_window_start = COALESCE($9, calling_window_start),
           calling_window_end = COALESCE($10, calling_window_end)
       WHERE id = $11`,
      [
        organizationName,
        razorpayKeyId,
        razorpayKeySecret,
        whatsappSenderId,
        smsSenderId,
        preferredChannel,
        maxRetryAttempts ? parseInt(maxRetryAttempts) : null,
        retryCooldownHours ? parseInt(retryCooldownHours) : null,
        callingWindowStart,
        callingWindowEnd,
        req.clinicId
      ]
    );

    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (err) {
    console.error('Error updating settings:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

export default router;
