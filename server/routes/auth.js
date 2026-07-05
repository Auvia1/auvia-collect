import express from 'express';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import authMiddleware from '../middleware/auth.js';

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    // Look up user profile
    const userResult = await db.query(
      `SELECT p.id, p.full_name, p.email, p.platform_role, cm.clinic_id, cm.role as member_role, c.name as clinic_name
       FROM profiles p
       LEFT JOIN clinic_members cm ON cm.user_id = p.id AND cm.status = 'active'
       LEFT JOIN clinics c ON c.id = cm.clinic_id
       WHERE LOWER(p.email) = LOWER($1) LIMIT 1`,
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'User profile not found. Please contact admin.' });
    }

    const user = userResult.rows[0];

    // For local mock verification, we accept 'password' or anything as long as the user exists
    // You can enforce password check here if desired.
    
    // Generate JWT token
    const token = jwt.sign(
      { sub: user.id, email: user.email, name: user.full_name, platform_role: user.platform_role },
      process.env.JWT_SECRET || 'super_secret',
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        platformRole: user.platform_role,
        clinicId: user.clinic_id,
        clinicName: user.clinic_name,
        memberRole: user.member_role,
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const userResult = await db.query(
      `SELECT p.id, p.full_name, p.email, p.platform_role, cm.clinic_id, cm.role as member_role, c.name as clinic_name
       FROM profiles p
       LEFT JOIN clinic_members cm ON cm.user_id = p.id AND cm.status = 'active'
       LEFT JOIN clinics c ON c.id = cm.clinic_id
       WHERE p.id = $1 LIMIT 1`,
      [req.user.sub]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const user = userResult.rows[0];
    res.json({
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      platformRole: user.platform_role,
      clinicId: user.clinic_id,
      clinicName: user.clinic_name,
      memberRole: user.member_role,
    });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
