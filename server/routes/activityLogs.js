import express from 'express';
import db from '../db.js';
import authMiddleware from '../middleware/auth.js';

const router = express.Router();

// Column mapping:  our API names  →  activity_log table columns
//   action      → event_type
//   description → title
//   category    → entity_type
//   metadata    → meta  (also stores user_name inside it)

// ── GET /api/activity-logs — fetch paginated logs for the clinic ─────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { category, limit = 50, offset = 0 } = req.query;

    let whereClause = 'WHERE al.clinic_id = $1';
    const params = [req.clinicId];

    if (category && category !== 'all') {
      params.push(category);
      whereClause += ` AND al.entity_type = $${params.length}`;
    }

    const result = await db.query(
      `SELECT al.id,
              al.event_type  AS action,
              al.title       AS description,
              al.entity_type AS category,
              al.entity_id,
              al.user_id,
              al.meta        AS metadata,
              al.created_at,
              COALESCE(al.meta->>'user_name', '') AS user_name
       FROM activity_log al
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const countResult = await db.query(
      `SELECT COUNT(*) FROM activity_log WHERE clinic_id = $1${
        category && category !== 'all' ? ' AND entity_type = $2' : ''
      }`,
      category && category !== 'all' ? [req.clinicId, category] : [req.clinicId]
    );

    res.json({
      logs: result.rows,
      total: parseInt(countResult.rows[0].count),
    });
  } catch (err) {
    console.error('Error fetching activity logs:', err);
    res.status(500).json({ error: 'Failed to fetch activity logs' });
  }
});

// ── POST /api/activity-logs — record a new log entry ────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { action, category = 'general', description = '', metadata = {} } = req.body;

    if (!action) {
      return res.status(400).json({ error: 'action is required' });
    }

    const userName = req.user?.fullName || req.user?.email || 'System';
    const userId   = req.user?.userId   || req.user?.id   || null;
    const meta     = { ...metadata, user_name: userName };

    await db.query(
      `INSERT INTO activity_log (clinic_id, event_type, title, entity_type, user_id, meta)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.clinicId, action, description, category, userId, JSON.stringify(meta)]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Error inserting activity log:', err);
    res.status(500).json({ error: 'Failed to record activity log' });
  }
});

export default router;
