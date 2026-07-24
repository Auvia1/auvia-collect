import db from '../db.js';

/**
 * Write an entry to the existing `activity_log` table.
 * Column mapping:
 *   action      → event_type
 *   description → title
 *   category    → entity_type
 *   metadata    → meta  (user_name stored inside meta JSONB)
 *
 * Safe to fire-and-forget — errors are caught and logged but never re-thrown.
 */
export async function logActivity(clinicId, user, action, category = 'general', description = '', metadata = {}) {
  try {
    if (!clinicId || !action) return;
    const userName = user?.fullName || user?.email || 'System';
    const userId   = user?.userId   || user?.id   || null;
    const meta     = { ...metadata, user_name: userName };

    await db.query(
      `INSERT INTO activity_log (clinic_id, event_type, title, entity_type, user_id, meta)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [clinicId, action, description, category, userId, JSON.stringify(meta)]
    );
  } catch (err) {
    // Never let logging failures break the caller
    console.error('[activityLog] failed to write log:', err.message);
  }
}
