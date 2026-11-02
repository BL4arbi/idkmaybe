/**
 * Copie les applications dans le Hub, à partir de leurs propres dossiers
 * (apps.sources.json). Chaque app reste développée dans son dépôt d'origine ;
 * le Hub embarque ses fichiers tels quels au moment du build.
 *
 * Usage : npm run sync-apps   (lancé automatiquement par build et release)
 *
 * Le dossier apps/ est ignoré par Git : il contient db-config.js de QHSE
 * (identifiants MariaDB), qui ne doit jamais aller sur GitHub.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const out = path.join(root, 'apps');
const sources = JSON.parse(fs.readFileSync(path.join(root, 'apps.sources.json'), 'utf8'));

function copy(src, dest) {
  if (!fs.existsSync(src)) throw new Error(`Introuvable : ${src}`);
  fs.cpSync(src, dest, { recursive: true });
}

function gitInfo(dir) {
  try {
    const commit = execSync('git rev-parse --short HEAD', { cwd: dir }).toString().trim();
    const dirty = execSync('git status --porcelain', { cwd: dir }).toString().trim() !== '';
    return dirty ? `${commit}+modifs-locales` : commit;
  } catch {
    return 'inconnu';
  }
}

const apps = {
  // Tacquet Measure: plain web pages. Same file list as its own installer,
  // minus its Electron main process and updater (the Hub replaces them).
  measure(src, dest) {
    const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
    for (const f of pkg.build.files) {
      if (f === 'main.js' || f === 'updater.js') continue;
      copy(path.join(src, f), path.join(dest, f));
    }
    return pkg.version;
  },

  // SolidWorks Team Tracker: the built screens (npm run build in its
  // frontend) and the SolidWorks preview helper of its main process.
  tracker(src, dest) {
    const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
    if (!fs.existsSync(path.join(src, 'dist', 'index.html'))) {
      throw new Error(`Tracker non construit : lancer "npm run build" dans ${src}`);
    }
    copy(path.join(src, 'dist'), path.join(dest, 'dist'));
    copy(path.join(src, 'electron', 'solidworksPreview.js'), path.join(dest, 'electron', 'solidworksPreview.js'));
    copy(path.join(src, 'electron', 'solidworks-preview.vbs'), path.join(dest, 'electron', 'solidworks-preview.vbs'));
    // solidworksPreview.js is an ES module.
    fs.writeFileSync(path.join(dest, 'electron', 'package.json'), '{ "type": "module" }\n');
    return pkg.version;
  },

  // QHSE: its own main process, database access, pages and styles, unchanged.
  // The Hub loads electron/main.js itself (see electron/apps/qhse-host.js).
  qhse(src, dest) {
    const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
    for (const f of ['electron/main.js', 'electron/db.js', 'electron/db-config.js']) {
      copy(path.join(src, f), path.join(dest, f));
    }
    for (const d of ['html', 'css', 'js', 'assets']) copy(path.join(src, d), path.join(dest, d));
    return pkg.version;
  },
};

fs.rmSync(out, { recursive: true, force: true });
const manifest = {};
for (const [key, sync] of Object.entries(apps)) {
  const src = sources[key];
  const dest = path.join(out, key);
  fs.mkdirSync(dest, { recursive: true });
  const version = sync(src, dest);
  manifest[key] = { version, source: src, commit: gitInfo(src) };
  console.log(` ${key.padEnd(8)} ${version.padEnd(8)} ${manifest[key].commit}  ← ${src}`);
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
