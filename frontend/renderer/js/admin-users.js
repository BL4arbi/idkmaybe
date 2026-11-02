// Admin: users and who can open which app, with which role.
const adminUsersView = {
  async render(container, session) {
    const apps = session.allApps;
    const tbody = el('tbody');
    const search = el('input', { type: 'search', placeholder: 'Rechercher un nom ou un email…', oninput: () => draw() });
    let users = [];

    const load = async () => {
      users = await api.get('/api/admin/users');
      draw();
    };

    const draw = () => {
      const q = search.value.toLowerCase().trim();
      const shown = users.filter((u) => !q || u.full_name.toLowerCase().includes(q) || u.username.includes(q));
      tbody.replaceChildren(...shown.map(userRow));
    };

    const userRow = (u) => el('tr', { class: u.active ? '' : 'inactive' },
      el('td', {}, el('div', { class: 'strong' }, u.full_name),
        el('div', { class: 'muted small' }, u.company_email || `Identifiant : ${u.username}`),
        u.must_change_password && el('div', { class: 'muted small' }, 'Mot de passe temporaire')),
      apps.map((a) => el('td', {}, selectEl(
        [['', '—'], ...a.roles.map((r) => [r, ROLE_LABELS[r] || r])],
        u.access[a.key] || '',
        { class: u.access[a.key] ? 'has-access' : '', onchange: (e) => setAccess(u, a, e.target) }))),
      el('td', { class: 'center' }, el('input', {
        type: 'checkbox', checked: u.active, disabled: u.id === session.user.id,
        onchange: (e) => patchUser(u, { active: e.target.checked }, e.target),
      })),
      el('td', { class: 'muted small' }, formatDate(u.last_login_at)),
      el('td', {}, el('button', { class: 'btn small', onclick: () => resetPassword(u) }, 'Réinit. mot de passe')));

    const setAccess = async (u, a, select) => {
      const role = select.value || null;
      try {
        await api.put(`/api/admin/users/${u.id}/access`, { access: { [a.key]: role } });
        if (role) u.access[a.key] = role;
        else delete u.access[a.key];
        select.className = role ? 'has-access' : '';
        toast(`${u.full_name} : ${a.name} → ${role ? ROLE_LABELS[role] || role : 'aucun accès'}`, 'success');
      } catch (err) {
        select.value = u.access[a.key] || '';
        toast(err.message, 'error');
      }
    };

    const patchUser = async (u, changes, input) => {
      try {
        Object.assign(u, await api.patch(`/api/admin/users/${u.id}`, changes));
        draw();
      } catch (err) {
        input.checked = !input.checked;
        toast(err.message, 'error');
      }
    };

    const showPassword = (u, password) => openModal('Mot de passe temporaire', el('div', { class: 'form' },
      el('p', {}, `Mot de passe temporaire de ${u.full_name} (identifiant : ${u.username}) :`),
      el('div', { class: 'temp-password' }, password),
      el('p', { class: 'muted small' }, 'Transmettez-le à la personne. Elle devra le changer à sa prochaine connexion. Il ne sera plus affiché ensuite.'),
      el('div', { class: 'actions' }, el('button', { class: 'btn', onclick: () => { navigator.clipboard.writeText(password); toast('Copié'); } }, 'Copier'))));

    // Temporary password typed by the admin, or generated when left empty.
    const passwordField = () => el('input', { type: 'text', minlength: '6', placeholder: 'Laisser vide pour en générer un', autocomplete: 'off' });

    const resetPassword = (u) => {
      const password = passwordField();
      const error = el('p', { class: 'error' });
      const form = el('form', { class: 'form' },
        el('p', {}, `Donner un nouveau mot de passe temporaire à ${u.full_name}. Son mot de passe actuel ne fonctionnera plus.`),
        el('label', {}, 'Mot de passe temporaire'), password,
        error,
        el('div', { class: 'actions' }, el('button', { type: 'submit', class: 'btn primary' }, 'Réinitialiser')));
      const close = openModal('Réinitialiser le mot de passe', form);
      password.focus();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const res = await api.post(`/api/admin/users/${u.id}/reset-password`, { password: password.value });
          close();
          showPassword(res.user, res.temporary_password);
          load();
        } catch (err) {
          error.textContent = err.message;
        }
      });
    };

    const createUser = () => {
      const name = el('input', { type: 'text', required: true });
      const email = el('input', { type: 'email', required: true });
      const password = passwordField();
      const error = el('p', { class: 'error' });
      const form = el('form', { class: 'form' },
        el('label', {}, 'Nom complet'), name,
        el('label', {}, 'Email professionnel (servira d’identifiant)'), email,
        el('label', {}, 'Mot de passe temporaire'), password,
        el('p', { class: 'muted small' }, 'La personne devra changer ce mot de passe à sa première connexion. Vous choisirez ses applications dans le tableau.'),
        error,
        el('div', { class: 'actions' }, el('button', { type: 'submit', class: 'btn primary' }, 'Créer')));
      const close = openModal('Nouvel utilisateur', form);
      name.focus();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const res = await api.post('/api/admin/users', {
            full_name: name.value, company_email: email.value, password: password.value,
          });
          close();
          await load();
          showPassword(res.user, res.temporary_password);
        } catch (err) {
          error.textContent = err.message;
        }
      });
    };

    container.append(
      el('div', { class: 'page-head' },
        el('h1', {}, 'Utilisateurs et accès'),
        el('button', { class: 'btn primary', onclick: createUser }, 'Nouvel utilisateur')),
      el('p', { class: 'muted' }, 'Choisissez pour chaque personne les applications qu’elle peut ouvrir et son rôle dans chacune. Les changements sont enregistrés immédiatement.'),
      el('div', { class: 'filters' }, search),
      el('div', { class: 'table-wrap' }, el('table', { class: 'grid' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Utilisateur'),
          apps.map((a) => el('th', {}, a.name)),
          el('th', {}, 'Actif'), el('th', {}, 'Dernière connexion'), el('th', {}))),
        tbody)));
    await load();
  },
};
