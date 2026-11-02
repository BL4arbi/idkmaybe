// The home page: one tile per app the user has access to.
// Opening the tools inside the Hub comes in the next step (integration of
// Tacquet Measure, the Tracker and QHSE); until then a tile says so.
const appsView = {
  render(container, session) {
    const apps = session.apps;
    container.append(
      el('h1', {}, `Bonjour ${session.user.full_name.split(' ')[0]}`),
      el('p', { class: 'muted' }, apps.length
        ? 'Vos applications :'
        : "Vous n'avez encore accès à aucune application. Demandez à l'administrateur de vous en ouvrir l'accès."),
      el('div', { class: 'tiles' }, apps.map((a) => el('button', { class: 'tile', onclick: () => this.open(a) },
        el('div', { class: 'tile-icon' }, el('img', {
          src: `../asset/apps/${a.key}.png`, alt: '',
          // An app added later without an icon file shows its initial instead.
          onerror: (e) => e.target.replaceWith(a.name.slice(0, 1)),
        })),
        el('div', { class: 'tile-name' }, a.name),
        el('div', { class: 'tile-desc' }, a.description || ''),
        badge(ROLE_LABELS[a.role] || a.role)))));
  },

  open(appInfo) {
    toast(`${appInfo.name} sera intégré dans le Hub à la prochaine mise à jour.`);
  },
};
