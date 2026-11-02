import { verifyToken } from '../services/tokens.js';
import { pool } from '../db/pool.js';

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Jeton manquant' });

  try {
    const payload = verifyToken(token);
    // Re-read the user on every request so disabling an account or removing
    // admin rights takes effect immediately, not when the token expires.
    const { rows } = await pool.query(
      `SELECT id, full_name, username, company_email, is_admin, active, must_change_password
         FROM users WHERE id = $1`,
      [payload.sub]
    );
    const user = rows[0];
    if (!user || !user.active) return res.status(401).json({ error: 'Session invalide' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Jeton invalide ou expiré' });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Réservé aux administrateurs' });
  next();
}

// Until the temporary password is replaced, only the change-password and
// "who am I" endpoints are usable.
export function requirePasswordChanged(req, res, next) {
  if (req.user?.must_change_password) {
    return res.status(403).json({ error: 'Vous devez changer votre mot de passe', code: 'MUST_CHANGE_PASSWORD' });
  }
  next();
}
