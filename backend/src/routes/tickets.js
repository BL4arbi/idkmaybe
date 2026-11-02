import { Router } from 'express';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { pool } from '../db/pool.js';
import { requireAuth, requireAdmin, requirePasswordChanged } from '../middleware/auth.js';
import {
  sendMailInBackground, adminEmails, newTicketEmail, ticketMessageEmail, ticketStatusEmail, STATUS_LABELS,
} from '../services/email.js';
import { wrap } from '../utils/wrap.js';

const router = Router();
router.use(requireAuth, requirePasswordChanged);

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

const TICKET_SELECT = `
  SELECT t.id, t.user_id, t.app_key, COALESCE(a.name, 'Tacquet Hub') AS app_name, t.hub_version,
         t.title, t.description, t.status, t.priority, (t.screenshot_path IS NOT NULL) AS has_screenshot,
         t.created_at, t.updated_at, u.full_name AS author_name, u.company_email AS author_email, u.username AS author_username,
         (SELECT COUNT(*)::int FROM ticket_messages m WHERE m.ticket_id = t.id) AS message_count
    FROM tickets t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN apps a ON a.key = t.app_key`;

// Loads a ticket the current user is allowed to see (their own, or any for admins).
async function visibleTicket(req, res) {
  const { rows } = await pool.query(`${TICKET_SELECT} WHERE t.id = $1`, [Number(req.params.id)]);
  const ticket = rows[0];
  if (!ticket || (!req.user.is_admin && ticket.user_id !== req.user.id)) {
    res.status(404).json({ error: 'Ticket introuvable' });
    return null;
  }
  return ticket;
}

async function saveScreenshot(dataUrl) {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl || '');
  if (!match) return null;
  const dir = path.join(UPLOAD_DIR, 'screenshots');
  await mkdir(dir, { recursive: true });
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.png`;
  await writeFile(path.join(dir, name), Buffer.from(match[1], 'base64'));
  return path.join('screenshots', name);
}

router.get('/', wrap(async (req, res) => {
  const where = [];
  const params = [];
  // "mine=1" lets an admin see only the tickets they reported themselves.
  if (!req.user.is_admin || req.query.mine === '1') {
    params.push(req.user.id);
    where.push(`t.user_id = $${params.length}`);
  }
  if (req.query.status) {
    params.push(String(req.query.status));
    where.push(`t.status = $${params.length}`);
  }
  if (req.query.app_key) {
    if (req.query.app_key === 'hub') {
      where.push('t.app_key IS NULL');
    } else {
      params.push(String(req.query.app_key));
      where.push(`t.app_key = $${params.length}`);
    }
  }
  const { rows } = await pool.query(
    `${TICKET_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY (t.status IN ('fixed', 'closed')), t.updated_at DESC`,
    params
  );
  res.json(rows);
}));

router.post('/', wrap(async (req, res) => {
  const { app_key, hub_version, title, description, priority, screenshot, diagnostics } = req.body || {};
  if (!String(title || '').trim() || !String(description || '').trim()) {
    return res.status(400).json({ error: 'Le titre et la description sont obligatoires' });
  }
  if (priority && !PRIORITIES.includes(priority)) return res.status(400).json({ error: 'Priorité invalide' });

  let appName = 'Tacquet Hub';
  if (app_key) {
    const { rows } = await pool.query('SELECT name FROM apps WHERE key = $1', [app_key]);
    if (!rows[0]) return res.status(400).json({ error: 'Application inconnue' });
    appName = rows[0].name;
  }

  const screenshot_path = await saveScreenshot(screenshot);
  const { rows } = await pool.query(
    `INSERT INTO tickets (user_id, app_key, hub_version, title, description, priority, screenshot_path, diagnostics)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [req.user.id, app_key || null, hub_version || null, title.trim(), description.trim(),
      priority || 'normal', screenshot_path, diagnostics ? JSON.stringify(diagnostics) : null]
  );
  const { rows: created } = await pool.query(`${TICKET_SELECT} WHERE t.id = $1`, [rows[0].id]);
  sendMailInBackground({ to: await adminEmails(), ...newTicketEmail({ ticket: created[0], author: req.user, appName }) });
  res.status(201).json(created[0]);
}));

router.get('/:id', wrap(async (req, res) => {
  const ticket = await visibleTicket(req, res);
  if (!ticket) return;
  const { rows: messages } = await pool.query(
    `SELECT m.id, m.body, m.created_at, u.full_name AS author_name, u.is_admin AS author_is_admin,
            (m.user_id = $2) AS is_mine
       FROM ticket_messages m JOIN users u ON u.id = m.user_id
      WHERE m.ticket_id = $1 ORDER BY m.created_at`,
    [ticket.id, req.user.id]
  );
  // Diagnostics are for the admin; the reporter doesn't need to see raw logs.
  let diagnostics = null;
  if (req.user.is_admin) {
    const { rows } = await pool.query('SELECT diagnostics FROM tickets WHERE id = $1', [ticket.id]);
    diagnostics = rows[0].diagnostics;
  }
  res.json({ ...ticket, diagnostics, messages });
}));

// Not served as a public static folder: screenshots can show sensitive data.
router.get('/:id/screenshot', wrap(async (req, res) => {
  const ticket = await visibleTicket(req, res);
  if (!ticket) return;
  const { rows } = await pool.query('SELECT screenshot_path FROM tickets WHERE id = $1', [ticket.id]);
  if (!rows[0].screenshot_path) return res.status(404).json({ error: 'Pas de capture' });
  res.sendFile(path.resolve(UPLOAD_DIR, rows[0].screenshot_path));
}));

router.post('/:id/messages', wrap(async (req, res) => {
  const ticket = await visibleTicket(req, res);
  if (!ticket) return;
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Le message est vide' });

  await pool.query('INSERT INTO ticket_messages (ticket_id, user_id, body) VALUES ($1, $2, $3)', [ticket.id, req.user.id, body]);
  // A reply from the reporter on a fixed ticket means it isn't fixed after all.
  const reopen = !req.user.is_admin && ['fixed', 'closed'].includes(ticket.status);
  await pool.query(
    `UPDATE tickets SET updated_at = now()${reopen ? ", status = 'open'" : ''} WHERE id = $1`,
    [ticket.id]
  );

  const to = req.user.id === ticket.user_id ? await adminEmails() : ticket.author_email;
  sendMailInBackground({ to, ...ticketMessageEmail({ ticket, author: req.user, body }) });
  res.status(201).json({ ok: true, reopened: reopen });
}));

router.patch('/:id', requireAdmin, wrap(async (req, res) => {
  const { status, priority } = req.body || {};
  if (status && !STATUS_LABELS[status]) return res.status(400).json({ error: 'Statut invalide' });
  if (priority && !PRIORITIES.includes(priority)) return res.status(400).json({ error: 'Priorité invalide' });
  const before = await visibleTicket(req, res);
  if (!before) return;

  await pool.query(
    `UPDATE tickets SET status = COALESCE($2, status), priority = COALESCE($3, priority), updated_at = now()
      WHERE id = $1`,
    [before.id, status || null, priority || null]
  );
  const { rows } = await pool.query(`${TICKET_SELECT} WHERE t.id = $1`, [before.id]);
  if (status && status !== before.status && before.user_id !== req.user.id) {
    sendMailInBackground({ to: before.author_email, ...ticketStatusEmail({ ticket: rows[0] }) });
  }
  res.json(rows[0]);
}));

export default router;
