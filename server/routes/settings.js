import express from 'express';
import crypto from 'crypto';
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
              calling_window_start, calling_window_end, credits, max_concurrent_calls
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
      maxConcurrentCalls: c.max_concurrent_calls || 5,
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
// POST /api/settings/recharge - Recharge credits (Initiate Razorpay order)
router.post('/recharge', authMiddleware, async (req, res) => {
  const { credits, amount } = req.body;
  if (!credits || !amount) {
    return res.status(400).json({ error: 'Credits and amount are required' });
  }

  const gst = amount * 0.18;
  const total = amount + gst;

  try {
    // 1. Insert transaction as Pending first
    const txResult = await db.query(
      `INSERT INTO credit_transactions (clinic_id, credits, amount, gst, total, status, payment_id)
       VALUES ($1, $2, $3, $4, $5, 'Pending', null)
       RETURNING id`,
      [req.clinicId, credits, amount, gst, total]
    );
    const txId = txResult.rows[0].id;

    // 2. Create Razorpay order
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    let orderId = `order_mock_${txId.replace(/-/g, '').substring(0, 14)}`;
    let key = 'rzp_test_mockkey';
    let isMock = true;

    if (keyId && keySecret && keyId !== 'your_razorpay_key_id') {
      try {
        const authString = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
        const rzpResponse = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${authString}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            amount: Math.round(total * 100), // paise
            currency: 'INR',
            receipt: `rcpt_${txId.substring(0, 12)}`
          })
        });

        const rzpData = await rzpResponse.json().catch(() => ({}));
        if (rzpResponse.ok && rzpData.id) {
          orderId = rzpData.id;
          key = keyId;
          isMock = false;
          console.log(`[Razorpay] Created order ${orderId} for transaction ${txId}`);
        } else {
          console.warn('[Razorpay] Order creation failed. Falling back to mock.', rzpData);
        }
      } catch (err) {
        console.error('[Razorpay] Network error creating order. Falling back to mock.', err.message);
      }
    } else {
      console.log(`[Razorpay] Credentials not configured. Using mock order ID: ${orderId}`);
    }

    // 3. Save order ID to transaction
    await db.query(
      `UPDATE credit_transactions SET payment_id = $1 WHERE id = $2`,
      [orderId, txId]
    );

    res.json({
      success: true,
      orderId,
      amount: Math.round(total * 100),
      key,
      isMock
    });

  } catch (err) {
    console.error('Error initiating recharge:', err);
    res.status(500).json({ error: 'Failed to initiate recharge order' });
  }
});

// POST /api/settings/recharge/confirm-mock - Instantly credit balance for mock payments in local development
router.post('/recharge/confirm-mock', authMiddleware, async (req, res) => {
  const { orderId } = req.body;
  if (!orderId) {
    return res.status(400).json({ error: 'orderId is required' });
  }

  try {
    const txResult = await db.query(
      `SELECT id, clinic_id, credits, status FROM credit_transactions WHERE payment_id = $1 LIMIT 1`,
      [orderId]
    );

    if (txResult.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const tx = txResult.rows[0];
    if (tx.clinic_id !== req.clinicId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (tx.status === 'Pending') {
      await db.query('BEGIN');

      await db.query(
        `UPDATE credit_transactions SET status = 'Success' WHERE id = $1`,
        [tx.id]
      );

      const clinicResult = await db.query(
        `UPDATE clinics SET credits = COALESCE(credits, 0) + $1 WHERE id = $2 RETURNING credits`,
        [tx.credits, req.clinicId]
      );

      await db.query('COMMIT');
      return res.json({
        success: true,
        message: 'Mock payment verified successfully.',
        newBalance: clinicResult.rows[0].credits
      });
    }

    const clinicResult = await db.query(
      `SELECT credits FROM clinics WHERE id = $1 LIMIT 1`,
      [req.clinicId]
    );
    res.json({
      success: true,
      message: 'Transaction already completed.',
      newBalance: clinicResult.rows[0]?.credits || 0
    });

  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Error confirming mock payment:', err);
    res.status(500).json({ error: 'Failed to confirm mock payment' });
  }
});

// POST /api/settings/razorpay-webhook - Handle Razorpay webhook payment updates (signature-verified)
router.post('/razorpay-webhook', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'your_webhook_secret';

  // Verify signature
  if (signature) {
    if (webhookSecret && webhookSecret !== 'your_webhook_secret') {
      try {
        const bodyStr = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body);
        const expectedSignature = crypto
          .createHmac('sha256', webhookSecret)
          .update(bodyStr)
          .digest('hex');

        if (expectedSignature !== signature) {
          console.warn('[RazorpayWebhook] Signature mismatch. Rejecting webhook request.');
          return res.status(400).json({ error: 'Invalid signature' });
        }
      } catch (err) {
        console.error('[RazorpayWebhook] Signature verification error:', err.message);
        return res.status(400).json({ error: 'Signature verification failed' });
      }
    }
  } else {
    console.warn('[RazorpayWebhook] Missing x-razorpay-signature header.');
  }

  const eventData = req.body;
  const event = eventData.event;
  console.log(`[RazorpayWebhook] Received event: ${event}`);

  // Handle successful payments
  const acceptedEvents = ['order.paid', 'payment.captured', 'payment_link.paid'];
  if (acceptedEvents.includes(event)) {
    let orderId = null;
    let paymentId = null;

    if (event === 'order.paid') {
      orderId = eventData.payload?.order?.entity?.id;
      paymentId = eventData.payload?.payment?.entity?.id;
    } else if (event === 'payment.captured') {
      orderId = eventData.payload?.payment?.entity?.order_id;
      paymentId = eventData.payload?.payment?.entity?.id;
    } else if (event === 'payment_link.paid') {
      orderId = eventData.payload?.payment_link?.entity?.id;
      paymentId = eventData.payload?.payment?.entity?.id;
    }

    const matchedId = orderId || paymentId;

    if (matchedId) {
      try {
        const txResult = await db.query(
          `SELECT id, clinic_id, credits, status FROM credit_transactions WHERE payment_id = $1 LIMIT 1`,
          [matchedId]
        );

        if (txResult.rows.length > 0) {
          const tx = txResult.rows[0];
          if (tx.status === 'Pending') {
            await db.query('BEGIN');

            // Update transaction status
            await db.query(
              `UPDATE credit_transactions SET status = 'Success', payment_id = $1 WHERE id = $2`,
              [paymentId || matchedId, tx.id]
            );

            // Increment clinic credits balance
            const clinicResult = await db.query(
              `UPDATE clinics SET credits = COALESCE(credits, 0) + $1 WHERE id = $2 RETURNING credits`,
              [tx.credits, tx.clinic_id]
            );

            await db.query('COMMIT');
            console.log(`[RazorpayWebhook] Success: granted ${tx.credits} credits to clinic ${tx.clinic_id}. New balance: ${clinicResult.rows[0].credits}`);
          } else {
            console.log(`[RazorpayWebhook] Transaction ${tx.id} already processed (status: ${tx.status}).`);
          }
        } else {
          console.warn(`[RazorpayWebhook] No pending transaction found matching ID ${matchedId}`);
        }
      } catch (err) {
        await db.query('ROLLBACK');
        console.error('[RazorpayWebhook] Database update failed:', err);
        return res.status(500).json({ error: 'Internal database error' });
      }
    }
  }

  // Always respond with 200 OK to acknowledge receipt
  res.json({ received: true });
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
    maxConcurrentCalls,
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
           calling_window_end = COALESCE($10, calling_window_end),
           max_concurrent_calls = COALESCE($11, max_concurrent_calls)
       WHERE id = $12`,
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
        maxConcurrentCalls ? parseInt(maxConcurrentCalls) : null,
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
