import { Router } from 'express';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { pool } from '../db/pool.js';
import { signSessionToken } from '../services/tokens.js';
import { requireAuth } from '../middleware/auth.js';
import { wrap } from '../utils/wrap.js';
import { appsForUser } from '../utils/access.js';

const router = Router();

function publicUser(u) {
  return {
    id: u.id,
    full_name: u.full_name,
    username: u.username,
    company_email: u.company_email,
    is_admin: u.is_admin,
    must_change_password: u.must_change_password,
  };
}

// No "forgot password" by email: the admin sets a temporary password from the
// admin page, and the user replaces it at their next login.
router.post('/login', wrap(async (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) {
    return res.status(400).json({ error: "L'identifiant et le mot de passe sont obligatoires" });
  }
  const login = String(identifier).toLowerCase().trim();
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE username = $1 OR company_email = $1 LIMIT 1',
    [login]
  );
  const user = rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
  }
  if (!user.active) return res.status(403).json({ error: 'Ce compte est désactivé' });

  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  res.json({
    token: signSessionToken(user),
    user: publicUser(user),
    apps: await appsForUser(user.id),
  });
}));

router.get('/me', requireAuth, wrap(async (req, res) => {
  res.json({ user: publicUser(req.user), apps: await appsForUser(req.user.id) });
}));

router.post('/change-password', requireAuth, wrap(async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: "L'ancien et le nouveau mot de passe sont obligatoires" });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
  }
  if (new_password === current_password) {
    return res.status(400).json({ error: "Le nouveau mot de passe doit être différent de l'ancien" });
  }
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await verifyPassword(current_password, rows[0].password_hash))) {
    return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
  }
  const password_hash = await hashPassword(new_password);
  await pool.query(
    'UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2',
    [password_hash, req.user.id]
  );
  res.json({ message: 'Mot de passe mis à jour.' });
}));

export default router;
