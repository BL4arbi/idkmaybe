// The home page: one tile per app the user has access to. A tile opens the
// app inside the Hub (same as its entry in the sidebar).
const appsView = {
  render(container, session) {
    const apps = session.apps;
    container.append(
      el('h1', {}, `Bonjour ${session.user.full_name.split(' ')[0]}`),
      el('p', { class: 'muted' }, apps.length
        ? 'Vos applications :'
        : "Vous n'avez encore accès à aucune application. Demandez à l'administrateur de vous en ouvrir l'accès."),
      el('div', { class: 'tiles' }, apps.map((a) => el('button', { class: 'tile', onclick: () => app.go(`app:${a.key}`) },
        el('div', { class: 'tile-icon' }, el('img', {
          src: `../asset/apps/${a.key}.png`, alt: '',
          // An app added later without an icon file shows its initial instead.
          onerror: (e) => e.target.replaceWith(a.name.slice(0, 1)),
        })),
        el('div', { class: 'tile-name' }, a.name),
        el('div', { class: 'tile-desc' }, a.description || ''),
        badge(ROLE_LABELS[a.role] || a.role)))));
  },
};
