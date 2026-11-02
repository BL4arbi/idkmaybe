/**
 * Incrémente la version patch (0.1.0 → 0.1.1), construit l'installateur et
 * le publie sur GitHub Releases (BL4arbi/idkmaybe). Les Hubs installés le
 * téléchargent tout seuls.
 *
 * Usage : npm run release
 * Publication automatique si la variable GH_TOKEN est définie
 * (token GitHub avec le droit "Contents: write" sur le dépôt) ;
 * sinon l'installateur est seulement construit, à téléverser à la main.
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

const publish = process.env.GH_TOKEN ? 'always' : 'never';
execSync(`npx electron-builder --publish ${publish}`, { stdio: 'inherit', cwd: root });

const exe = `Tacquet-Hub-Setup-${newVersion}.exe`;
if (publish === 'always') {
  console.log(`\n Publié sur GitHub (brouillon de release v${newVersion}).`);
  console.log(' → Va sur https://github.com/BL4arbi/idkmaybe/releases et clique "Publish release".');
  console.log('   Les Hubs installés se mettront à jour dans les 4 heures (ou au prochain démarrage).\n');
} else {
  console.log(`\n Construit : frontend\\release\\${exe}  (GH_TOKEN absent, rien n'a été publié)`);
  console.log(' → https://github.com/BL4arbi/idkmaybe/releases > New release');
  console.log(` → Tag : v${newVersion}`);
  console.log(` → Téléverse les 3 fichiers : ${exe}, ${exe}.blockmap, latest.yml\n`);
}
console.log(' N’oublie pas de committer le changement de version : git commit -am "v' + newVersion + '"\n');
