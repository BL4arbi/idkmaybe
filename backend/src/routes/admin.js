import { Router } from 'express';
import { hashPassword } from '../utils/password.js';
import crypto from 'node:crypto';
import { pool } from '../db/pool.js';
import { requireAuth, requireAdmin, requirePasswordChanged } from '../middleware/auth.js';
import { wrap } from '../utils/wrap.js';
import { allApps } from '../utils/access.js';

const router = Router();
router.use(requireAuth, requirePasswordChanged, requireAdmin);

const USER_FIELDS = 'id, full_name, username, company_email, is_admin, active, must_change_password';

function isAllowedDomain(email) {
  const domain = process.env.ALLOWED_EMAIL_DOMAIN;
  if (!domain) return true;
  return email.endsWith(`@${domain.toLowerCase()}`);
}

// Readable temporary password: no 0/O/1/l/I confusion when read aloud.
function generatePassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(8), (b) => chars[b % chars.length]).join('');
}

// The admin may type the temporary password; otherwise one is generated.
function temporaryPassword(req) {
  const typed = String(req.body?.password || '').trim();
  if (!typed) return { password: generatePassword() };
  if (typed.length < 6) return { error: 'Le mot de passe temporaire doit contenir au moins 6 caractères' };
  return { password: typed };
}

router.get('/apps', wrap(async (_req, res) => {
  res.json(await allApps());
}));

// Every user with their app access, as { app_key: role }.
router.get('/users', wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.full_name, u.username, u.company_email, u.is_admin, u.active,
            u.must_change_password, u.last_login_at, u.created_at,
            COALESCE(jsonb_object_agg(x.app_key, x.role) FILTER (WHERE x.app_key IS NOT NULL), '{}') AS access
       FROM users u
       LEFT JOIN user_app_access x ON x.user_id = u.id
      GROUP BY u.id
      ORDER BY u.active DESC, u.full_name`
  );
  res.json(rows);
}));

// The company email is the login. No email is sent: the admin hands over the
// temporary password, and the user changes it at their first login.
router.post('/users', wrap(async (req, res) => {
  const full_name = String(req.body?.full_name || '').trim();
  const email = String(req.body?.company_email || '').toLowerCase().trim();
  if (!full_name || !email) return res.status(400).json({ error: "Le nom et l'email sont obligatoires" });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Email invalide' });
  if (!isAllowedDomain(email)) {
    return res.status(400).json({ error: `Seules les adresses @${process.env.ALLOWED_EMAIL_DOMAIN} sont autorisées` });
  }
  const { password, error } = temporaryPassword(req);
  if (error) return res.status(400).json({ error });

  const existing = await pool.query('SELECT id FROM users WHERE username = $1 OR company_email = $1', [email]);
  if (existing.rows.length) return res.status(409).json({ error: 'Un compte existe déjà avec cet email' });

  const password_hash = await hashPassword(password);
  const { rows } = await pool.query(
    `INSERT INTO users (full_name, username, company_email, password_hash)
     VALUES ($1, $2, $2, $3) RETURNING ${USER_FIELDS}`,
    [full_name, email, password_hash]
  );
  res.status(201).json({ user: rows[0], temporary_password: password });
}));

// The built-in "admin" account is the only administrator: admin rights are
// not something that can be given from the admin page.
router.patch('/users/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { full_name, active } = req.body || {};
  if (id === req.user.id && active === false) {
    return res.status(400).json({ error: 'Vous ne pouvez pas désactiver votre propre compte' });
  }
  const { rows } = await pool.query(
    `UPDATE users SET
       full_name = COALESCE($2, full_name),
       active    = COALESCE($3, active)
     WHERE id = $1
     RETURNING ${USER_FIELDS}`,
    [id, full_name?.trim() || null, typeof active === 'boolean' ? active : null]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json(rows[0]);
}));

router.post('/users/:id/reset-password', wrap(async (req, res) => {
  const { password, error } = temporaryPassword(req);
  if (error) return res.status(400).json({ error });
  const password_hash = await hashPassword(password);
  const { rows } = await pool.query(
    `UPDATE users SET password_hash = $2, must_change_password = TRUE
      WHERE id = $1 RETURNING ${USER_FIELDS}`,
    [Number(req.params.id), password_hash]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json({ user: rows[0], temporary_password: password });
}));

// Grants, changes or removes (null) access per app; apps left out are untouched.
// Body: { access: { app_key: role | null } }
router.put('/users/:id/access', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const access = req.body?.access || {};
  const apps = Object.fromEntries((await allApps()).map((a) => [a.key, a]));

  for (const [key, role] of Object.entries(access)) {
    if (!apps[key]) return res.status(400).json({ error: `Application inconnue : ${key}` });
    if (role !== null && !apps[key].roles.includes(role)) {
      return res.status(400).json({ error: `Rôle invalide pour ${apps[key].name} : ${role}` });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id FROM users WHERE id = $1', [id]);
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }
    for (const [key, role] of Object.entries(access)) {
      if (role === null) {
        await client.query('DELETE FROM user_app_access WHERE user_id = $1 AND app_key = $2', [id, key]);
      } else {
        await client.query(
          `INSERT INTO user_app_access (user_id, app_key, role) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, app_key) DO UPDATE SET role = EXCLUDED.role`,
          [id, key, role]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  res.json({ ok: true });
}));

export default router;
