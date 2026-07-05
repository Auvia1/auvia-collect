import jwt from 'jsonwebtoken';
import db from '../db.js';

export default async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'super_secret');
    req.user = decoded;

    // Fetch the user's clinic membership and role
    const memberResult = await db.query(
      `SELECT clinic_id, role, status FROM clinic_members WHERE user_id = $1 AND status = 'active' LIMIT 1`,
      [decoded.sub]
    );

    if (memberResult.rows.length === 0) {
      return res.status(403).json({ error: 'User is not an active member of any clinic' });
    }

    req.clinicId = memberResult.rows[0].clinic_id;
    req.role = memberResult.rows[0].role;

    // Set local request setting in PostgreSQL connection context
    // This makes auth.uid() function work inside PostgreSQL if we execute queries within this transaction block.
    // However, in our routes we can also pass req.clinicId explicitly to bypass RLS issues or connect with a standard query.
    // For queries that use schema triggers, we can run:
    // await db.query("SET LOCAL request.jwt.claim.sub = $1", [decoded.sub]);
    // BUT note that SET LOCAL only applies to the current transaction.
    // Since we'll execute queries directly, we will construct them using req.clinicId to ensure multi-tenant security.

    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(401).json({ error: 'Invalid token' });
  }
}
