// Small DOM helpers. Everything is built with el() and textContent, never
// innerHTML, so user-typed text (ticket titles, names) can't inject markup.

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'value') node.value = value;
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

function $(id) {
  return document.getElementById(id);
}

function show(node, visible = true) {
  node.classList.toggle('hidden', !visible);
}

function toast(message, kind = 'info') {
  const node = el('div', { class: `toast ${kind}` }, message);
  $('toast-root').append(node);
  setTimeout(() => node.remove(), 4000);
}

// Opens a modal; returns a close() function.
// An open app is drawn above the Hub page, so while a Hub dialog or menu is
// open the app view is hidden (the main process keeps it alive).
function updateOverlay() {
  const open = $('modal-root').children.length > 0 || !$('user-dropdown').classList.contains('hidden');
  window.hub.setOverlay(open);
}

function closeAllModals() {
  $('modal-root').replaceChildren();
  show($('user-dropdown'), false);
  updateOverlay();
}

function openModal(title, body, { wide = false } = {}) {
  const root = $('modal-root');
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    updateOverlay();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const overlay = el('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay) close(); } },
    el('div', { class: `modal${wide ? ' wide' : ''}` },
      el('div', { class: 'modal-head' }, el('h2', {}, title), el('button', { class: 'icon-btn', onclick: close, title: 'Fermer' }, '×')),
      body));
  root.append(overlay);
  document.addEventListener('keydown', onKey);
  updateOverlay();
  return close;
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

const ROLE_LABELS = { user: 'Utilisateur', admin: 'Admin', engineer: 'Ingénieur', manager: 'Manager' };
const STATUS_LABELS = { open: 'Ouvert', in_progress: 'En cours', fixed: 'Corrigé', closed: 'Fermé' };
const PRIORITY_LABELS = { low: 'Basse', normal: 'Normale', high: 'Haute', urgent: 'Urgente' };

function badge(text, kind) {
  return el('span', { class: `badge ${kind || ''}` }, text);
}

function selectEl(options, value, attrs = {}) {
  return el('select', attrs, options.map(([v, label]) => el('option', { value: v, selected: v === value }, label)));
}

window.addEventListener('error', (e) => window.hub.log('error', `${e.message} (${e.filename}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => window.hub.log('error', e.reason?.stack || e.reason));
