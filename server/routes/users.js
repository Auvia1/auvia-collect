import express from 'express';
import db from '../db.js';
import authMiddleware from '../middleware/auth.js';

const router = express.Router();

// GET /api/users - Fetch members of the clinic
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT cm.id as member_id, p.id as user_id, p.full_name, cm.invited_email as email, cm.role, cm.status, cm.invited_at, cm.joined_at
       FROM clinic_members cm
       LEFT JOIN profiles p ON p.id = cm.user_id
       WHERE cm.clinic_id = $1
       ORDER BY cm.invited_at DESC`,
      [req.clinicId]
    );

    const formatted = result.rows.map((row) => ({
      id: row.member_id,
      name: row.full_name || 'Invited User',
      email: row.email,
      role: row.role === 'admin' ? 'Administrator' : 'Staff',
      status: row.status,
      joinedDate: row.joined_at ? new Date(row.joined_at).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) : 'Pending Invite',
    }));

    res.json(formatted);
  } catch (err) {
    console.error('Error fetching members:', err);
    res.status(500).json({ error: 'Failed to fetch members list' });
  }
});

// POST /api/users - Invite member to clinic
router.post('/', authMiddleware, async (req, res) => {
  const { email, name, role } = req.body;

  if (!email || !name) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  const roleValue = role === 'Administrator' ? 'admin' : 'staff';

  try {
    await db.query('BEGIN');

    // Check if member already exists
    const checkRes = await db.query(
      `SELECT id FROM clinic_members WHERE clinic_id = $1 AND LOWER(invited_email) = LOWER($2) LIMIT 1`,
      [req.clinicId, email]
    );

    if (checkRes.rows.length > 0) {
      await db.query('ROLLBACK');
      return res.status(400).json({ error: 'User is already invited or a member of this clinic.' });
    }

    // 1. Create entry in auth.users and let handle_new_user create the profile
    const userUuid = crypto.randomUUID ? crypto.randomUUID() : (await db.query('SELECT gen_random_uuid() as uuid')).rows[0].uuid;

    await db.query(
      `INSERT INTO auth.users (id, email, raw_user_meta_data)
       VALUES ($1, $2, $3)`,
      [userUuid, email, JSON.stringify({ full_name: name })]
    );

    // 2. Add to clinic_members as invited
    await db.query(
      `INSERT INTO clinic_members (clinic_id, user_id, invited_email, role, status, invited_by, joined_at)
       VALUES ($1, $2, $3, $4, 'active', $5, now())`,
      [req.clinicId, userUuid, email, roleValue, req.user.sub]
    );

    await db.query('COMMIT');

    res.status(201).json({
      success: true,
      member: {
        id: userUuid,
        name,
        email,
        role: roleValue === 'admin' ? 'Administrator' : 'Staff',
        status: 'active',
        joinedDate: new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
      }
    });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Error inviting clinic member:', err);
    res.status(500).json({ error: 'Failed to invite team member' });
  }
});

// DELETE /api/users/:id - Remove clinic member
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    // Only admins can delete members
    if (req.role !== 'admin') {
      return res.status(403).json({ error: 'Only administrators can manage team members' });
    }

    const checkRes = await db.query(
      `SELECT user_id FROM clinic_members WHERE id = $1 AND clinic_id = $2 LIMIT 1`,
      [req.params.id, req.clinicId]
    );

    if (checkRes.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found in this clinic' });
    }

    const userId = checkRes.rows[0].user_id;

    await db.query('BEGIN');

    // Remove from clinic members
    await db.query(
      `DELETE FROM clinic_members WHERE id = $1`,
      [req.params.id]
    );

    // Remove auth user & profiles (handled by cascade delete)
    if (userId) {
      await db.query(
        `DELETE FROM auth.users WHERE id = $1`,
        [userId]
      );
    }

    await db.query('COMMIT');
    res.json({ success: true, message: 'Member removed successfully' });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Error removing member:', err);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

export default router;
