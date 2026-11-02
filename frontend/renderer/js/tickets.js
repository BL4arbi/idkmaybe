// Ticket list + detail. Used for "Mes tickets" (mode 'mine') and for the
// admin inbox (mode 'admin', which adds filters, status/priority controls,
// screenshot and diagnostics).
const ticketsView = {
  async render(container, session, mode) {
    const isAdmin = mode === 'admin';
    const filters = { status: '', app_key: '' };
    const list = el('div', { class: 'ticket-list' });
    const detail = el('div', { class: 'ticket-detail' }, el('p', { class: 'muted' }, 'Sélectionnez un ticket.'));
    let selectedId = null;

    const load = async () => {
      const params = new URLSearchParams();
      if (!isAdmin) params.set('mine', '1');
      if (filters.status) params.set('status', filters.status);
      if (filters.app_key) params.set('app_key', filters.app_key);
      list.replaceChildren(el('p', { class: 'muted' }, 'Chargement…'));
      try {
        const tickets = await api.get(`/api/tickets?${params}`);
        list.replaceChildren(...(tickets.length ? tickets.map(row) : [el('p', { class: 'muted' }, 'Aucun ticket.')]));
      } catch (err) {
        list.replaceChildren(el('p', { class: 'error' }, err.message));
      }
    };

    const row = (t) => el('button', {
      class: `ticket-row${t.id === selectedId ? ' selected' : ''}`,
      'data-id': t.id,
      onclick: () => {
        selectedId = t.id;
        for (const r of list.querySelectorAll('.ticket-row')) r.classList.toggle('selected', Number(r.dataset.id) === t.id);
        showDetail(t.id);
      },
    },
      el('div', { class: 'ticket-row-top' },
        el('span', { class: 'ticket-id' }, `#${t.id}`),
        badge(STATUS_LABELS[t.status], `status-${t.status}`),
        t.priority !== 'normal' && badge(PRIORITY_LABELS[t.priority], `prio-${t.priority}`)),
      el('div', { class: 'ticket-title' }, t.title),
      el('div', { class: 'muted small' },
        `${t.app_name}${isAdmin ? ` · ${t.author_name}` : ''} · ${formatDate(t.updated_at)}`,
        t.message_count ? ` · ${t.message_count} message(s)` : ''));

    const showDetail = async (id) => {
      detail.replaceChildren(el('p', { class: 'muted' }, 'Chargement…'));
      let t;
      try {
        t = await api.get(`/api/tickets/${id}`);
      } catch (err) {
        detail.replaceChildren(el('p', { class: 'error' }, err.message));
        return;
      }

      const controls = isAdmin && el('div', { class: 'ticket-controls' },
        el('label', {}, 'Statut ', selectEl(Object.entries(STATUS_LABELS), t.status, {
          onchange: (e) => update({ status: e.target.value }),
        })),
        el('label', {}, 'Priorité ', selectEl(Object.entries(PRIORITY_LABELS), t.priority, {
          onchange: (e) => update({ priority: e.target.value }),
        })));

      const update = async (changes) => {
        try {
          await api.patch(`/api/tickets/${id}`, changes);
          toast('Ticket mis à jour', 'success');
          load();
        } catch (err) {
          toast(err.message, 'error');
        }
      };

      const shot = el('div');
      if (t.has_screenshot) {
        api.imageUrl(`/api/tickets/${id}/screenshot`).then((url) => {
          if (url) shot.append(el('a', { href: '#', onclick: (e) => { e.preventDefault(); openModal('Capture d’écran', el('img', { src: url, class: 'shot-full' }), { wide: true }); } },
            el('img', { src: url, class: 'shot-thumb', alt: 'Capture' })));
        });
      }

      const reply = el('textarea', { rows: '3', placeholder: isAdmin ? 'Répondre à l’utilisateur…' : 'Ajouter une précision…' });
      const send = el('button', { class: 'btn primary', onclick: async () => {
        if (!reply.value.trim()) return;
        send.disabled = true;
        try {
          const res = await api.post(`/api/tickets/${id}/messages`, { body: reply.value });
          if (res.reopened) toast('Le ticket a été rouvert.');
          await load();
          showDetail(id);
        } catch (err) {
          toast(err.message, 'error');
          send.disabled = false;
        }
      } }, 'Envoyer');

      detail.replaceChildren(
        el('div', { class: 'ticket-head' },
          el('h2', {}, `#${t.id} ${t.title}`),
          el('div', { class: 'muted small' },
            `${t.app_name} · ${t.author_name} (${t.author_email || t.author_username}) · ${formatDate(t.created_at)}`,
            t.hub_version ? ` · Hub ${t.hub_version}` : '')),
        controls || el('div', {}, badge(STATUS_LABELS[t.status], `status-${t.status}`), ' ', badge(`Priorité ${PRIORITY_LABELS[t.priority].toLowerCase()}`)),
        el('div', { class: 'message original' }, t.description),
        shot,
        isAdmin && t.diagnostics && el('details', { class: 'diagnostics' },
          el('summary', {}, 'Informations techniques'),
          el('pre', {}, JSON.stringify(t.diagnostics, null, 2))),
        el('div', { class: 'messages' }, t.messages.map((m) => el('div', { class: `message${m.author_is_admin ? ' from-admin' : ''}` },
          el('div', { class: 'muted small' }, `${m.author_name} · ${formatDate(m.created_at)}`),
          el('div', { class: 'message-body' }, m.body)))),
        el('div', { class: 'reply' }, reply, el('div', { class: 'actions' }, send)));
    };

    const filterBar = isAdmin && el('div', { class: 'filters' },
      selectEl([['', 'Tous les statuts'], ...Object.entries(STATUS_LABELS)], '', {
        onchange: (e) => { filters.status = e.target.value; load(); },
      }),
      selectEl([['', 'Toutes les applications'], ['hub', 'Tacquet Hub'], ...(session.allApps || []).map((a) => [a.key, a.name])], '', {
        onchange: (e) => { filters.app_key = e.target.value; load(); },
      }));

    container.append(
      el('div', { class: 'page-head' },
        el('h1', {}, isAdmin ? 'Tickets' : 'Mes tickets'),
        !isAdmin && el('button', { class: 'btn primary', onclick: () => report.open(session) }, 'Nouveau ticket')),
      filterBar,
      el('div', { class: 'tickets-layout' }, list, detail));
    await load();
  },
};
