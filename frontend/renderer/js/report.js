// "Signaler un problème": screenshot of the window as it is now, plus the
// recent errors, sent with the user's description.
const report = {
  async open(session, defaultAppKey) {
    // Capture before the modal opens, so the screenshot shows the problem.
    let screenshot = null;
    try {
      screenshot = await window.hub.captureScreenshot();
    } catch {
      // ticket can still be sent without it
    }

    const appSelect = selectEl(
      [['', 'Tacquet Hub (général)'], ...session.apps.map((a) => [a.key, a.name])],
      defaultAppKey || '',
      { id: 'report-app' });
    const title = el('input', { type: 'text', maxlength: '200', required: true, placeholder: 'Ex. : impossible d’enregistrer une formation' });
    const description = el('textarea', { rows: '6', required: true, placeholder: 'Que faisiez-vous ? Que s’est-il passé ? Qu’attendiez-vous ?' });
    const priority = selectEl(Object.entries(PRIORITY_LABELS), 'normal');
    const includeShot = el('input', { type: 'checkbox', checked: Boolean(screenshot), disabled: !screenshot });
    const error = el('p', { class: 'error' });
    const submit = el('button', { type: 'submit', class: 'btn primary' }, 'Envoyer');

    const form = el('form', { class: 'form' },
      el('label', {}, 'Application concernée'), appSelect,
      el('label', {}, 'Titre'), title,
      el('label', {}, 'Description'), description,
      el('label', {}, 'Priorité'), priority,
      screenshot && el('label', { class: 'check' }, includeShot, ' Joindre la capture d’écran'),
      screenshot && el('img', { src: screenshot, class: 'shot-preview', alt: 'Capture' }),
      el('p', { class: 'muted small' }, 'La version du Hub, votre poste et les dernières erreurs sont joints automatiquement.'),
      error,
      el('div', { class: 'actions' }, submit));

    const close = openModal('Signaler un problème', form, { wide: true });
    title.focus();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submit.disabled = true;
      error.textContent = '';
      try {
        const diagnostics = await window.hub.diagnostics();
        const ticket = await api.post('/api/tickets', {
          app_key: appSelect.value || null,
          hub_version: diagnostics.hub_version,
          title: title.value,
          description: description.value,
          priority: priority.value,
          screenshot: includeShot.checked ? screenshot : null,
          diagnostics,
        });
        close();
        toast(`Ticket #${ticket.id} envoyé. Merci !`, 'success');
        app.refreshIfOn('my-tickets');
      } catch (err) {
        error.textContent = err.message;
        submit.disabled = false;
      }
    });
  },
};
