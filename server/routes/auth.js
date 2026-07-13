import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import authMiddleware from '../middleware/auth.js';

const router = express.Router();

// ─── POST /api/auth/register ────────────────────────────────────────────────
// Creates a new app_users row with status = 'pending'.
// Does NOT issue a JWT — the user must be approved by a platform admin first.
router.post('/register', async (req, res) => {
  const { fullName, email, password } = req.body;

  if (!fullName || !email || !password) {
    return res.status(400).json({ error: 'Full name, email and password are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  try {
    // Check for an existing account with this email
    const existing = await db.query(
      `SELECT id, status FROM app_users WHERE LOWER(email::text) = LOWER($1) LIMIT 1`,
      [email]
    );

    if (existing.rows.length > 0) {
      const existingStatus = existing.rows[0].status;
      if (existingStatus === 'rejected') {
        return res.status(403).json({
          error: 'Your account application was previously rejected. Please contact support.'
        });
      }
      if (existingStatus === 'pending') {
        return res.status(409).json({
          error: 'An account with this email is already pending approval.'
        });
      }
      // approved or any other state
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    // Insert with status = 'pending' — no JWT issued yet
    const result = await db.query(
      `INSERT INTO app_users (full_name, email, password_hash, user_type, is_active, status)
       VALUES ($1, $2, $3, 'client', true, 'pending')
       RETURNING id, full_name, email, user_type, status`,
      [fullName, email, passwordHash]
    );

    const user = result.rows[0];

    // No token — account is pending admin approval
    res.status(201).json({
      pending: true,
      message: 'Account created successfully. Your account is pending admin approval. You will be able to log in once approved.',
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        userType: user.user_type,
        status: user.status,
      },
    });
  } catch (err) {
    console.error('Register error:', err.message, err.detail);
    res.status(500).json({ error: 'Internal server error during registration.' });
  }
});

// ─── POST /api/auth/login ────────────────────────────────────────────────────
// Authenticates with email + bcrypt password.
// Blocks pending and rejected users before issuing a JWT.
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const userResult = await db.query(
      `SELECT id, full_name, email, user_type, platform_role, password_hash, is_active, status
       FROM app_users
       WHERE LOWER(email::text) = LOWER($1)
       LIMIT 1`,
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = userResult.rows[0];

    // ── Status gate ──────────────────────────────────────────────────────────
    if (user.status === 'pending') {
      return res.status(403).json({
        error: 'Your account is awaiting admin approval. Please check back later.'
      });
    }
    if (user.status === 'rejected') {
      return res.status(403).json({
        error: 'Your account application has been rejected. Please contact support.'
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    if (!user.is_active) {
      return res.status(403).json({ error: 'Your account has been deactivated. Contact support.' });
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Update last login timestamp
    await db.query(
      `UPDATE app_users SET last_login_at = NOW() WHERE id = $1`,
      [user.id]
    );

    // Resolve platform_role: use stored column if present, otherwise derive from user_type
    const platformRole = user.platform_role || (user.user_type === 'admin' ? 'platform_admin' : 'standard');

    // For client users, look up clinic membership by email
    let clinicId = null, clinicName = null, memberRole = null;
    if (user.user_type === 'client') {
      const clinicResult = await db.query(
        `SELECT cm.clinic_id, cm.role AS member_role, c.name AS clinic_name
         FROM clinic_members cm
         JOIN clinics c ON c.id = cm.clinic_id
         WHERE LOWER(cm.invited_email::text) = LOWER($1) AND cm.status = 'active'
         LIMIT 1`,
        [email]
      );
      if (clinicResult.rows.length > 0) {
        clinicId   = clinicResult.rows[0].clinic_id;
        clinicName = clinicResult.rows[0].clinic_name;
        memberRole = clinicResult.rows[0].member_role;
      }
    }

    // Issue JWT
    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        name: user.full_name,
        user_type: user.user_type,
        platform_role: platformRole,
      },
      process.env.JWT_SECRET || 'super_secret',
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        userType: user.user_type,          // 'admin' → /admin, 'client' → /campaigns
        platformRole,                       // backward compat
        status: user.status,
        clinicId,
        clinicName,
        memberRole,
      },
    });
  } catch (err) {
    console.error('Login error:', err.message, err.detail);
    res.status(500).json({ error: 'Internal server error during authentication.' });
  }
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const userResult = await db.query(
      `SELECT id, full_name, email, user_type, platform_role, is_active, status
       FROM app_users
       WHERE id = $1 LIMIT 1`,
      [req.user.sub]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found.' });
    }

    const user = userResult.rows[0];

    const platformRole = user.platform_role || (user.user_type === 'admin' ? 'platform_admin' : 'standard');

    let clinicId = null, clinicName = null, memberRole = null;
    if (user.user_type === 'client') {
      const clinicResult = await db.query(
        `SELECT cm.clinic_id, cm.role AS member_role, c.name AS clinic_name
         FROM clinic_members cm
         JOIN clinics c ON c.id = cm.clinic_id
         WHERE LOWER(cm.invited_email::text) = LOWER($1) AND cm.status = 'active'
         LIMIT 1`,
        [user.email]
      );
      if (clinicResult.rows.length > 0) {
        clinicId   = clinicResult.rows[0].clinic_id;
        clinicName = clinicResult.rows[0].clinic_name;
        memberRole = clinicResult.rows[0].member_role;
      }
    }

    res.json({
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      userType: user.user_type,
      platformRole,
      status: user.status,
      clinicId,
      clinicName,
      memberRole,
    });
  } catch (err) {
    console.error('Get /me error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
