// Boot, login, navigation.
const app = {
  session: null,
  current: null,
  // 'Se souvenir de moi': keep the session (and the identifier) on this PC.
  remember: true,

  async start() {
    const info = await window.hub.info();
    api.baseUrl = info.serverUrl;
    api.onUnauthorized = () => this.logout('Votre session a expiré. Reconnectez-vous.');
    api.onMustChangePassword = () => this.showAuth('change');
    $('server-line').textContent = `Tacquet Hub ${info.version} · serveur ${info.serverUrl}`;
    this.bindAuthForms();
    this.bindShell();

    const saved = await window.hub.getSession();
    if (saved?.identifier) $('login-identifier').value = saved.identifier;
    if (saved?.token) {
      this.remember = true;
      api.token = saved.token;
      try {
        // Refresh user + apps: access may have changed since last time.
        const me = await api.get('/api/auth/me');
        return this.enter({ token: saved.token, ...me });
      } catch (err) {
        if (api.token) $('login-error').textContent = err.message;
      }
    }
    this.showAuth('login');
  },

  showAuth(which) {
    show($('shell'), false);
    show($('auth-screen'));
    show($('login-form'), which === 'login');
    show($('change-form'), which === 'change');
    if (which === 'login') ($('login-identifier').value ? $('login-password') : $('login-identifier')).focus();
    else $('change-current').focus();
  },

  bindAuthForms() {
    $('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const button = e.target.querySelector('button[type=submit]');
      button.disabled = true;
      $('login-error').textContent = '';
      try {
        const res = await api.post('/api/auth/login', {
          identifier: $('login-identifier').value,
          password: $('login-password').value,
        });
        $('login-password').value = '';
        this.remember = $('login-remember').checked;
        await this.enter(res);
      } catch (err) {
        $('login-error').textContent = err.message;
      } finally {
        button.disabled = false;
      }
    });

    $('change-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('change-error').textContent = '';
      if ($('change-new').value !== $('change-confirm').value) {
        $('change-error').textContent = 'Les mots de passe ne correspondent pas.';
        return;
      }
      try {
        await api.post('/api/auth/change-password', {
          current_password: $('change-current').value,
          new_password: $('change-new').value,
        });
        e.target.reset();
        const me = await api.get('/api/auth/me');
        await this.enter({ token: api.token, ...me });
        toast('Mot de passe mis à jour', 'success');
      } catch (err) {
        $('change-error').textContent = err.message;
      }
    });

    $('change-cancel').addEventListener('click', () => this.logout());
  },

  bindShell() {
    $('report-btn').addEventListener('click', () => report.open(this.session, this.activeAppKey()));
    // The user menu drops over the content area: hide the app view meanwhile.
    const setMenu = (open) => {
      show($('user-dropdown'), open);
      updateOverlay();
    };
    $('user-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      setMenu($('user-dropdown').classList.contains('hidden'));
    });
    document.addEventListener('click', () => {
      if (!$('user-dropdown').classList.contains('hidden')) setMenu(false);
    });

    new ResizeObserver(() => this.sendBounds()).observe($('content'));
    window.hub.onLogoutRequest(() => this.logout());
    window.hub.onNotice((message) => toast(message, 'error'));
    $('menu-logout').addEventListener('click', () => this.logout());
    $('menu-password').addEventListener('click', () => this.changePasswordModal());
  },

  async enter(session) {
    api.token = session.token;
    if (session.user.is_admin) {
      try {
        session.allApps = await api.get('/api/admin/apps');
      } catch {
        session.allApps = [];
      }
    }
    this.session = session;
    await this.saveSession();

    if (session.user.must_change_password) return this.showAuth('change');

    show($('auth-screen'), false);
    show($('shell'));
    $('user-btn').textContent = session.user.full_name;
    this.buildNav();
    this.go('home');

    // The main process opens the apps for this person only, with their role.
    await window.hub.setIdentity({
      token: session.token,
      user: session.user,
      apps: session.apps.map((a) => ({ key: a.key, role: a.role })),
    });
    // Start the apps in the background so the first click is instant too.
    setTimeout(() => {
      if (this.session === session) window.hub.preloadApps();
    }, 1500);
  },

  async saveSession() {
    if (this.remember) {
      await window.hub.setSession({ token: api.token, identifier: this.session.user.username });
    } else {
      await window.hub.clearSession();
    }
  },

  async logout(message) {
    api.token = null;
    this.session = null;
    this.current = null;
    closeAllModals();
    await window.hub.clearIdentity();
    // Keep the identifier pre-filled for next time, but not the session.
    const saved = await window.hub.getSession();
    if (saved?.identifier && this.remember) await window.hub.setSession({ identifier: saved.identifier });
    else await window.hub.clearSession();
    this.showAuth('login');
    $('login-error').textContent = message || '';
  },

  pages() {
    const pages = [
      { id: 'home', label: 'Accueil', render: (c) => appsView.render(c, this.session) },
    ];
    if (this.session.apps.length) {
      pages.push({ section: 'Applications' });
      for (const a of this.session.apps) pages.push({ id: `app:${a.key}`, label: a.name, appKey: a.key });
    }
    pages.push(
      { section: 'Support' },
      { id: 'my-tickets', label: 'Mes tickets', render: (c) => ticketsView.render(c, this.session, 'mine') },
    );
    if (this.session.user.is_admin) {
      pages.push(
        { section: 'Administration' },
        { id: 'admin-users', label: 'Utilisateurs et accès', render: (c) => adminUsersView.render(c, this.session) },
        { id: 'admin-tickets', label: 'Tickets', render: (c) => ticketsView.render(c, this.session, 'admin') },
      );
    }
    return pages;
  },

  buildNav() {
    $('sidebar').replaceChildren(...this.pages().map((p) => (p.section
      ? el('div', { class: 'nav-section' }, p.section)
      : el('button', { class: 'nav-item', 'data-page': p.id, onclick: () => this.go(p.id) },
        p.appKey && el('img', { class: 'nav-icon', src: `../asset/apps/${p.appKey}.png`, alt: '' }),
        p.label))));
  },

  // The app currently on screen (null on Hub pages).
  activeAppKey() {
    return this.current?.startsWith('app:') ? this.current.slice(4) : null;
  },

  async go(id) {
    const page = this.pages().find((p) => p.id === id);
    if (!page) return;
    this.current = id;
    for (const b of document.querySelectorAll('.nav-item')) b.classList.toggle('active', b.dataset.page === id);
    const content = $('content');
    content.classList.toggle('app-host', Boolean(page.appKey));

    // Apps are drawn by the main process over the content area; switching
    // only shows/hides them, nothing is reloaded.
    if (page.appKey) {
      content.replaceChildren(el('div', { class: 'app-loading muted' }, `Ouverture de ${page.label}…`));
      this.sendBounds();
      const res = await window.hub.openApp(page.appKey);
      if (res.error) content.replaceChildren(el('p', { class: 'error' }, res.error));
      return;
    }
    await window.hub.showHub();
    content.replaceChildren();
    try {
      await page.render(content);
    } catch (err) {
      content.append(el('p', { class: 'error' }, err.message));
    }
  },

  refreshIfOn(id) {
    if (this.current === id) this.go(id);
  },

  // Where the app views go: exactly over the content area.
  sendBounds() {
    const r = $('content').getBoundingClientRect();
    window.hub.setAppBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
  },

  changePasswordModal() {
    const current = el('input', { type: 'password', required: true, autocomplete: 'current-password' });
    const next = el('input', { type: 'password', required: true, minlength: '6', autocomplete: 'new-password' });
    const confirmInput = el('input', { type: 'password', required: true, minlength: '6', autocomplete: 'new-password' });
    const error = el('p', { class: 'error' });
    const form = el('form', { class: 'form' },
      el('label', {}, 'Mot de passe actuel'), current,
      el('label', {}, 'Nouveau mot de passe (6 caractères min.)'), next,
      el('label', {}, 'Confirmer'), confirmInput,
      error,
      el('div', { class: 'actions' }, el('button', { type: 'submit', class: 'btn primary' }, 'Enregistrer')));
    const close = openModal('Changer mon mot de passe', form);
    current.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (next.value !== confirmInput.value) {
        error.textContent = 'Les mots de passe ne correspondent pas.';
        return;
      }
      try {
        await api.post('/api/auth/change-password', { current_password: current.value, new_password: next.value });
        close();
        toast('Mot de passe mis à jour', 'success');
      } catch (err) {
        error.textContent = err.message;
      }
    });
  },
};

app.start();
