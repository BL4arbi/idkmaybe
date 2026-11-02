// Update progress window: download percentage, then installation.
const status = document.getElementById('status');
const fill = document.getElementById('fill');
const pct = document.getElementById('pct');

window.updater.onProgress(({ percent }) => {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  fill.style.width = `${p}%`;
  pct.textContent = `${p} %`;
});

window.updater.onInstalling(() => {
  status.textContent = 'Installation… Tacquet Hub va se fermer puis se rouvrir tout seul.';
  fill.classList.add('indeterminate');
  pct.textContent = '';
});

window.updater.onFailed((message) => {
  status.textContent = `Échec du téléchargement : ${message}. Nouvel essai au prochain démarrage.`;
  status.classList.add('error');
  fill.style.width = '0%';
  pct.textContent = '';
});
