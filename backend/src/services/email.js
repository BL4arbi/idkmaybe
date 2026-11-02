import nodemailer from 'nodemailer';
import { pool } from '../db/pool.js';

let transporter;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }
  return transporter;
}

export async function sendMail({ to, subject, html }) {
  if (!to || (Array.isArray(to) && !to.length)) return;
  if (!process.env.SMTP_HOST) {
    // No SMTP configured (e.g. local dev) — log instead of throwing.
    console.log(`[email:not-configured] to=${to} subject="${subject}"\n${html}`);
    return;
  }
  await getTransporter().sendMail({ from: process.env.SMTP_FROM, to, subject, html });
}

// Mail failures must never break the request that triggered them (a ticket
// is still created even if the SMTP server is down).
export function sendMailInBackground(mail) {
  sendMail(mail).catch((err) => console.error('[email] send failed:', err.message));
}

export async function adminEmails() {
  if (process.env.ADMIN_NOTIFY_EMAIL) return process.env.ADMIN_NOTIFY_EMAIL.split(',').map((s) => s.trim());
  const { rows } = await pool.query('SELECT company_email FROM users WHERE is_admin AND active AND company_email IS NOT NULL');
  return rows.map((r) => r.company_email);
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export const STATUS_LABELS = {
  open: 'Ouvert',
  in_progress: 'En cours',
  fixed: 'Corrigé',
  closed: 'Fermé',
};

export function newTicketEmail({ ticket, author, appName }) {
  return {
    subject: `[Ticket #${ticket.id}] ${ticket.title}`,
    html: `<p><b>${escapeHtml(author.full_name)}</b> (${escapeHtml(author.company_email || author.username)}) a signalé un problème
           sur <b>${escapeHtml(appName)}</b> — priorité ${escapeHtml(ticket.priority)}.</p>
           <p><b>${escapeHtml(ticket.title)}</b></p>
           <p style="white-space:pre-wrap">${escapeHtml(ticket.description)}</p>
           <p>Ouvrez Tacquet Hub &gt; Administration &gt; Tickets pour répondre.</p>`,
  };
}

export function ticketMessageEmail({ ticket, author, body }) {
  return {
    subject: `[Ticket #${ticket.id}] Nouvelle réponse — ${ticket.title}`,
    html: `<p><b>${escapeHtml(author.full_name)}</b> a répondu :</p>
           <p style="white-space:pre-wrap">${escapeHtml(body)}</p>
           <p>Ouvrez Tacquet Hub pour voir le ticket.</p>`,
  };
}

export function ticketStatusEmail({ ticket }) {
  return {
    subject: `[Ticket #${ticket.id}] ${STATUS_LABELS[ticket.status]} — ${ticket.title}`,
    html: `<p>Votre ticket <b>${escapeHtml(ticket.title)}</b> est maintenant :
           <b>${STATUS_LABELS[ticket.status]}</b>.</p>
           <p>Ouvrez Tacquet Hub pour voir le ticket.</p>`,
  };
}
