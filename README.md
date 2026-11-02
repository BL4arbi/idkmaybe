# Tacquet Hub

Une seule application de bureau pour tous les outils Tacquet. Chacun se
connecte avec son email professionnel (le compte administrateur intégré se
connecte avec `admin`). L'administrateur choisit qui ouvre quelle application,
avec quel rôle. Le bouton **Signaler un problème** crée un ticket (capture
d'écran + erreurs récentes jointes), traité depuis la page **Tickets**.

```
backend/   API du Hub (Express + Postgres), tourne dans Docker sur 192.168.0.134:4100
frontend/  Application Tacquet Hub (Electron) : un seul installateur, mise à jour automatique
HANDOFF.md Guide de reprise : ajouter une app, publier une mise à jour, dépannage
```

Le Hub a **sa propre petite base** (`tacquet_hub`) pour les comptes, les accès
et les tickets. Il ne touche **pas** aux bases de production QHSE (MariaDB) et
Tracker (Postgres) : aucune table, colonne ou ligne n'y est créée, modifiée ou supprimée.

Mises à jour livrées par **GitHub Releases** sur
[BL4arbi/idkmaybe](https://github.com/BL4arbi/idkmaybe).

## Avancement

- [x] Étape 1 : connexion, page d'administration (comptes + accès par app), tickets, thème jour/sombre
- [ ] Étape 2 : ouvrir Tacquet Measure, le Tracker et QHSE dans le Hub (connexion unique, bascule instantanée)
- [ ] Étape 3 : retirer les trois installateurs séparés
- [ ] Phase 2 : faire passer l'accès base de QHSE par l'API (son installateur contient aujourd'hui le mot de passe MariaDB)

## Installer l'API sur 192.168.0.134

1. Copier le dossier `backend` sur le serveur (ou le zip `dist/tacquet-hub-server.zip`, sans `node_modules`).
2. Sur le serveur, dans PowerShell **en administrateur**, depuis ce dossier :

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install-server.ps1
   ```

   Au premier lancement, il demande le mot de passe Postgres et le domaine email,
   crée `.env`, construit l'image, lance le conteneur `tacquet-hub-api` (redémarrage
   automatique), crée la base `tacquet_hub` si elle n'existe pas et ouvre le port 4100.
   Pour une mise à jour : remplacer le dossier (garder `.env`) et relancer le même script.

3. Se connecter avec le compte **admin** (créé au premier démarrage, accès à toutes les apps).
   C'est le seul administrateur : lui seul crée les comptes et choisit les accès et les rôles.

Vérification depuis n'importe quel PC : `http://192.168.0.134:4100/api/health` doit répondre `{"ok":true}`.
Journal du serveur : `docker logs tacquet-hub-api`.

## Application de bureau

```bash
cd frontend
npm install
npm start          # lancement en développement (F12 = outils de développement)
npm run build      # installateur dans frontend/release/
npm run release    # version +1, construit et publie sur GitHub (voir HANDOFF.md)
```

Les Hubs installés vérifient GitHub au démarrage puis toutes les 4 heures,
téléchargent la nouvelle version en arrière-plan et l'installent à la fermeture.

## Comptes et accès

- Pas d'inscription ni d'email : l'administrateur crée chaque compte dans
  **Administration > Utilisateurs et accès**, tape un mot de passe temporaire (ou le laisse générer)
  et le transmet. La personne doit le changer à sa première connexion.
- Mot de passe oublié : **Réinit. mot de passe** sur sa ligne, puis transmettre le nouveau mot de passe temporaire.
- Dans le même tableau, une colonne par application : `—` (pas d'accès) ou le rôle dans cette app.
  Effet immédiat ; un compte désactivé est déconnecté à sa requête suivante.
- **Se souvenir de moi** (coché par défaut) garde la session 30 jours sur ce PC et pré-remplit l'identifiant.
  Décoché, fermer le Hub déconnecte. La session est chiffrée avec le compte Windows.
- Rôles par app, identiques à ceux des apps : QHSE `user`/`admin`, Tracker `engineer`/`manager`, Measure `user`.

## Apparence

Même identité que les apps existantes : bandeau noir avec le liseré rouge et le
logo Tacquet, couleurs du Tracker, bouton **Mode sombre / Mode jour**
(mémorisé par PC, suit Windows par défaut). Chaque tuile utilise l'icône de son
app (`frontend/asset/apps/<clé>.png`).

## API

| Méthode | Chemin | Qui |
|---|---|---|
| POST | `/api/auth/login` | tous : `{ identifier, password }` (identifiant ou email) |
| GET | `/api/auth/me` | connecté : utilisateur + apps avec rôle |
| POST | `/api/auth/change-password` | connecté |
| GET/POST/PATCH | `/api/admin/users`, `/api/admin/users/:id` | admin |
| PUT | `/api/admin/users/:id/access` | admin : `{ access: { qhse: "admin", tracker: null } }` |
| POST | `/api/admin/users/:id/reset-password` | admin : `{ password? }` (généré si vide) |
| GET/POST | `/api/tickets` | ses tickets ; l'admin voit tout (`?status=&app_key=`) |
| GET | `/api/tickets/:id`, `/api/tickets/:id/screenshot` | auteur ou admin |
| POST | `/api/tickets/:id/messages` | auteur ou admin (une réponse de l'auteur rouvre un ticket corrigé) |
| PATCH | `/api/tickets/:id` | admin : statut, priorité |
