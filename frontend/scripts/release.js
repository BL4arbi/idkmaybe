/**
 * Nouvelle version du Hub : version +1, copie des apps à jour, installateur.
 *
 * Usage : npm run update
 *
 * Donne les 3 fichiers à livrer sur https://github.com/BL4arbi/idkmaybe/releases :
 * l'installateur .exe, son .blockmap et latest.yml. Les Hubs installés voient
 * la nouvelle version au démarrage (ou dans les 4 heures) et s'installent à la
 * fermeture.
 * Si la variable GH_TOKEN est définie (token GitHub, droit "Contents: write"),
 * la release est envoyée directement en brouillon.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const [major, minor, patch] = pkg.version.split('.').map(Number);
const newVersion = `${major}.${minor}.${patch + 1}`;
pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`\n Version : ${major}.${minor}.${patch} → ${newVersion}\n`);

console.log(' Copie des applications…');
execSync('node scripts/sync-apps.js', { stdio: 'inherit', cwd: root });

console.log('\n Construction de l’installateur…\n');
const publish = process.env.GH_TOKEN ? 'always' : 'never';
execSync(`npx electron-builder --publish ${publish}`, { stdio: 'inherit', cwd: root });

const dir = path.join(root, 'release');
const exe = `Tacquet-Hub-Setup-${newVersion}.exe`;
const files = [exe, `${exe}.blockmap`, 'latest.yml'];
for (const f of files) {
  if (!fs.existsSync(path.join(dir, f))) throw new Error(`Fichier manquant : ${path.join(dir, f)}`);
}

console.log(`\n Terminé — Tacquet Hub ${newVersion}`);
if (publish === 'always') {
  console.log(' Envoyé sur GitHub en brouillon : https://github.com/BL4arbi/idkmaybe/releases → "Publish release".');
} else {
  console.log(' → https://github.com/BL4arbi/idkmaybe/releases/new');
  console.log(` → Tag : v${newVersion}`);
  console.log(' → Téléverse ces 3 fichiers, puis "Publish release" :');
  for (const f of files) console.log(`     ${path.join(dir, f)}`);
}
console.log(`\n Puis : git commit -am "chore: v${newVersion}"\n`);
