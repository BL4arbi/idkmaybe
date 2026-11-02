# Tacquet Hub — guide de reprise

Ce document explique comment faire vivre le Hub : ajouter une application,
publier une mise à jour, administrer, dépanner. Pour l'installation initiale,
voir [README.md](README.md).

---

## 1. Règles à ne jamais enfreindre

1. **Bases de production intouchables.** Le Hub ne crée, ne modifie et ne
   supprime rien dans les bases QHSE (MariaDB, 192.168.0.134:3306) et Tracker
   (Postgres `solidworks_tracker`). Il n'a que sa propre base `tacquet_hub`.
   Toute intégration d'app réutilise l'accès aux données **tel qu'il existe
   aujourd'hui**, sans migration.
2. **Une app intégrée fonctionne exactement comme avant.** Mêmes écrans, mêmes
   fonctions, mêmes données. Seuls changent : la connexion (faite par le Hub)
   et l'endroit où elle s'ouvre.
3. **Aucun secret dans Git.** Le dépôt [BL4arbi/idkmaybe](https://github.com/BL4arbi/idkmaybe)
   est **public**. Jamais de `.env`, de `db-config.js`, de mot de passe ou de
   token dans un commit. Le `.gitignore` les bloque ; vérifier `git status`
   avant chaque commit.
4. **Tester avant de publier.** Une release part chez tout le monde dans les
   4 heures. Toujours `npm start` puis `npm run build` et installer l'exe sur
   son propre PC avant `npm run release`.

---

## 2. Organisation

```
backend/                      API du Hub (Docker, 192.168.0.134:4100)
  src/db/schema.sql           tables + LISTE DES APPLICATIONS (bloc INSERT INTO apps)
  src/db/migrate.js           applique le schéma à chaque démarrage, crée le compte admin s'il n'existe pas
  src/routes/auth.js          connexion, changement de mot de passe
  src/routes/admin.js         comptes, accès par app, mots de passe temporaires
  src/routes/tickets.js       tickets, messages, captures
  src/scripts/reset-admin.js  secours : redonner un mot de passe au compte admin
frontend/                     application Electron
  electron/main.js            fenêtre, session chiffrée, captures, logs, mises à jour auto
  electron/preload.js         ponts autorisés entre l'écran et Electron (window.hub)
  renderer/                   écrans du Hub (HTML/CSS/JS sans framework, sans étape de build)
    js/apps.js                page d'accueil : les tuiles des apps
    js/admin-users.js         Administration > Utilisateurs et accès
    js/tickets.js             Mes tickets / Administration > Tickets
    js/report.js              fenêtre « Signaler un problème »
    js/theme.js               mode jour / sombre
    css/style.css             couleurs (variables en haut du fichier, jour puis sombre)
  asset/apps/<clé>.png        icône de chaque app sur sa tuile
  scripts/release.js          version +1, build, publication GitHub
```

Qui parle à quoi :

```
PC utilisateur                         Serveur 192.168.0.134
┌──────────────────────┐   HTTP 4100   ┌──────────────────────────┐
│ Tacquet Hub          │──────────────▶│ API Hub ──▶ base tacquet_hub │
│  (connexion, accès,  │  (connexion,  └──────────────────────────┘
│   tickets)           │   admin,
│                      │   tickets)     inchangés :
│  apps intégrées ─────┼──────────────▶ MariaDB QHSE, API + Postgres Tracker
└──────────────────────┘  même chemin qu'aujourd'hui
```

---

## 3. Vitesse : ce qui est garanti

Le passage au Hub ne doit **rien ralentir**. Principes appliqués et à respecter :

- **Les écrans du Hub sont dans l'installateur.** Rien n'est téléchargé pour
  afficher une page ; changer de page dans le Hub ne recharge rien.
- **L'API du Hub n'est appelée qu'à la connexion, dans l'administration et pour
  les tickets.** Jamais pendant qu'on travaille dans une app.
- **Étape 2 — bascule instantanée entre apps.** Chaque app tournera dans sa
  propre vue (`WebContentsView`) dans la fenêtre du Hub, **créée au premier
  clic puis gardée en mémoire**. Revenir sur une app = l'afficher, sans
  rechargement : on la retrouve exactement où on l'avait laissée (formulaire en
  cours, plan ouvert, filtre…). Les apps auxquelles l'utilisateur a accès
  peuvent être préchargées en arrière-plan juste après la connexion.
- **Chaque app garde son chemin de données actuel** (QHSE → MariaDB en direct,
  Tracker → son API) : mêmes temps de réponse qu'aujourd'hui.
- Coût : environ 100 à 200 Mo de mémoire par app ouverte, comme si elle était
  lancée séparément — mais un seul Electron au lieu de trois.

Mesuré sur l'API (15 utilisateurs qui agissent **au même instant**, ce qui est
plus dur que l'usage réel) :

| Action | Médiane | Pire cas |
|---|---|---|
| 15 connexions simultanées | 230 ms | 260 ms |
| Ouverture du Hub | 32 ms | 69 ms |
| Liste de ses tickets | 39 ms | 122 ms |
| Envoi d'un ticket avec capture (530 Ko) | 124 ms | 193 ms |

Ce qui le permet : mots de passe vérifiés en parallèle (scrypt de Node, 8 fils),
jusqu'à 20 connexions base simultanées, vérification de session par simple
requête indexée. Pour refaire la mesure après une modification, lancer un test
de charge équivalent contre `docker-compose.local.yml` (section 9).

Règle pour tout ajout : **ne jamais mettre d'appel réseau au Hub sur le chemin
d'une action courante** dans une app.

---

## 4. Ajouter une application

### 4.1 Ce qui marche dès aujourd'hui (tuile + droits d'accès)

1. **Déclarer l'app** dans `backend/src/db/schema.sql`, bloc `INSERT INTO apps` :

   ```sql
   ('planning', 'Planning atelier', 'Planification des machines', ARRAY['user', 'chef'], 4)
   --  clé       nom affiché         description                  rôles possibles       ordre
   ```

   - `clé` : courte, minuscules, sans espace, **ne plus jamais la changer**
     (elle relie les accès et les tickets).
   - `rôles` : du moins au plus élevé. Le compte admin reçoit le dernier.

2. **Redémarrer l'API** sur le serveur : `docker restart tacquet-hub-api`
   (le schéma est réappliqué, la nouvelle app apparaît ; rien d'existant n'est effacé).
   Si le code du backend a changé, reconstruire l'image (README, étape 3).

3. **Icône** : déposer un PNG carré (256×256 conseillé) dans
   `frontend/asset/apps/<clé>.png`. Sans icône, la tuile affiche l'initiale.

4. Dans **Administration > Utilisateurs et accès**, une colonne apparaît pour
   cette app : choisir qui y a accès et avec quel rôle. On peut aussi y choisir
   l'app dans « Signaler un problème ».

### 4.2 Ouvrir l'app dans le Hub (mis en place à l'étape 2)

L'étape 2 ajoutera le mécanisme commun ; il sera décrit ici avec un exemple
réel. Le principe, pour chaque app :

1. Le code de l'app est inclus dans l'installateur du Hub (dossier
   `frontend/apps/<clé>/`), sans modifier ses écrans ni son accès aux données.
2. Elle est déclarée dans un registre (`frontend/electron/modules.js`) :
   page d'entrée, preload éventuel, fonctions Electron dont elle a besoin.
3. À l'ouverture, le Hub lui transmet **qui est connecté et son rôle dans cette
   app** ; son propre écran de connexion n'est plus affiché.
4. L'app est testée fonction par fonction contre la liste de ce qu'elle fait
   aujourd'hui (voir §7) avant toute release.

### 4.3 Ajouter ou renommer un rôle

Modifier le tableau `ARRAY[...]` de l'app dans `schema.sql`, redémarrer l'API.
Retirer un rôle déjà attribué : d'abord réattribuer les personnes concernées
dans l'administration, sinon elles gardent un rôle qui n'existe plus.

---

## 5. Publier une mise à jour

Dépôt de livraison : **https://github.com/BL4arbi/idkmaybe** (public, nécessaire
pour que les Hubs installés téléchargent les mises à jour sans mot de passe).

1. Tester : `cd frontend && npm start`.
2. Construire et installer sur son PC : `npm run build`, puis lancer
   `frontend/release/Tacquet-Hub-Setup-<version>.exe`.
3. Publier :

   ```bash
   cd frontend
   set GH_TOKEN=<token GitHub, droit Contents: write sur idkmaybe>
   npm run release
   ```

   Le script augmente la version, construit et envoie un **brouillon** de
   release. Aller sur la page Releases du dépôt et cliquer **Publish release**.
   Sans `GH_TOKEN`, il construit seulement et indique les 3 fichiers à
   téléverser à la main (`.exe`, `.exe.blockmap`, `latest.yml`).
4. Committer et pousser le changement de version.

Les Hubs installés se mettent à jour au démarrage suivant ou dans les 4 heures,
et s'installent à la fermeture du Hub.

Mise à jour de l'**API** (backend) : sur le serveur, récupérer le code, puis
`docker build -t tacquet-hub-api backend`, `docker rm -f tacquet-hub-api` et
relancer la commande `docker run` du README. Les données (base + captures dans le
volume `tacquet-hub-uploads`) sont conservées.

---

## 6. Administration courante

| Besoin | Où |
|---|---|
| Créer un compte | Administration > Utilisateurs et accès > **Nouvel utilisateur** (mot de passe temporaire tapé ou généré) |
| Mot de passe oublié | **Réinit. mot de passe** sur la ligne, transmettre le mot de passe temporaire |
| Donner / retirer une app | Colonne de l'app : rôle ou `—` (effet immédiat) |
| Bloquer quelqu'un | Décocher **Actif** (déconnecté immédiatement, historique conservé) |
| Mot de passe admin perdu | Sur le serveur : `docker exec tacquet-hub-api npm run reset-admin -- "NouveauMotDePasse"` |
| Traiter un ticket | Administration > Tickets : statut, priorité, réponse ; « Informations techniques » = erreurs récentes et poste |

Sauvegarde de la base du Hub (à planifier sur le serveur) :

```bash
docker exec <conteneur-postgres> pg_dump -U postgres tacquet_hub > tacquet_hub_AAAA-MM-JJ.sql
```

---

## 7. Avant d'intégrer une app : checklist « rien ne change »

À remplir pour chaque app **avant** sa première release dans le Hub :

- [ ] Liste de toutes ses pages et fonctions (une ligne chacune).
- [ ] Chaque fonction testée dans le Hub sur un poste de test, résultat identique à l'app seule.
- [ ] Aucune requête d'écriture nouvelle ou modifiée vers sa base (comparer le code d'accès aux données avant/après).
- [ ] Les rôles du Hub donnent exactement les mêmes droits que les rôles de l'app aujourd'hui.
- [ ] Ancienne app toujours installée et utilisable en parallèle pendant la transition (retour arrière possible).
- [ ] Sauvegarde de la base de l'app faite juste avant la release.

---

## 8. Dépannage

| Symptôme | Cause probable / action |
|---|---|
| « Serveur injoignable » à la connexion | PC hors réseau Tacquet, API arrêtée (`docker ps` sur 192.168.0.134) ou port 4100 bloqué |
| Tester sur un autre serveur | Créer `%APPDATA%\tacquet-hub\config.json` : `{ "serverUrl": "http://hôte:port" }` |
| Pas de mise à jour reçue | Release encore en brouillon, ou `latest.yml` manquant dans la release |
| Comprendre un plantage | `%APPDATA%\tacquet-hub\hub-log.txt` sur le poste ; les 50 dernières lignes sont jointes à chaque ticket |
| Erreurs de l'API | `docker logs tacquet-hub-api` |

---

## 9. Essayer en local (sans toucher au serveur)

```bash
docker compose -f docker-compose.local.yml up -d --build
```

Lance une base de test et l'API du Hub sur ce PC (`http://localhost:4100`).
Pour que le Hub installé l'utilise, créer `%APPDATA%\tacquet-hub\config.json` :
`{ "serverUrl": "http://localhost:4100" }` — **le supprimer** ensuite pour
revenir au serveur 192.168.0.134. Arrêt : `docker compose -f docker-compose.local.yml down`
(ajouter `-v` pour effacer les données de test).
