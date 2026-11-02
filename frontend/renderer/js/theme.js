// Light/dark theme, same behaviour as the Tracker: the saved choice, or the
// Windows setting if the user never chose.
const theme = {
  KEY: 'theme',

  current() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  },

  init() {
    let saved = null;
    try {
      saved = localStorage.getItem(this.KEY);
    } catch {
      // no storage: follow Windows
    }
    const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', saved || (dark ? 'dark' : 'light'));
  },

  toggle() {
    const next = this.current() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(this.KEY, next);
    } catch {
      // best-effort — the choice just won't persist across restarts
    }
    this.label();
  },

  label() {
    const dark = this.current() === 'dark';
    for (const b of document.querySelectorAll('.theme-toggle')) {
      b.textContent = dark ? 'Mode jour' : 'Mode sombre';
      b.title = dark ? 'Passer en mode jour' : 'Passer en mode sombre';
    }
  },
};

theme.init();
document.addEventListener('DOMContentLoaded', () => {
  theme.label();
  for (const b of document.querySelectorAll('.theme-toggle')) b.addEventListener('click', () => theme.toggle());
});
