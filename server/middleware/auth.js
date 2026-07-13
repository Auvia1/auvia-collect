import jwt from 'jsonwebtoken';
import db from '../db.js';

/**
 * Authentication middleware.
 * Verifies the Bearer JWT, then best-effort resolves req.clinicId from
 * the clinic_members table (matched by email).
 * Never blocks — any valid token passes through.
 */
export default async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'super_secret');
    req.user = decoded;

    // Default — overridden below if a clinic membership is found
    req.clinicId = decoded.clinicId ?? null;
    req.role     = decoded.user_type ?? decoded.platform_role ?? null;

    // Best-effort: resolve the clinic for this user by email
    // (matches clinic_members.invited_email regardless of user_type)
    if (decoded.email) {
      try {
        const memberResult = await db.query(
          `SELECT cm.clinic_id, cm.role
           FROM clinic_members cm
           WHERE LOWER(cm.invited_email::text) = LOWER($1)
             AND cm.status = 'active'
           LIMIT 1`,
          [decoded.email]
        );
        if (memberResult.rows.length > 0) {
          req.clinicId = memberResult.rows[0].clinic_id;
          req.role     = memberResult.rows[0].role;
        }
      } catch (_) {
        // Non-fatal — clinicId stays null
      }
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}
