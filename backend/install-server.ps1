# Installe (ou met à jour) l'API Tacquet Hub sur le serveur 192.168.0.134.
#
# Sur le serveur, dans PowerShell, depuis ce dossier :
#   powershell -ExecutionPolicy Bypass -File .\install-server.ps1
#
# - Crée .env au premier lancement (demande le mot de passe Postgres).
# - Construit l'image Docker et (re)lance le conteneur tacquet-hub-api.
# - Les données (base tacquet_hub + captures des tickets) sont conservées
#   d'une mise à jour à l'autre. Aucune autre base n'est touchée.

Set-Location $PSScriptRoot

function Fail($msg) { Write-Host "`nERREUR : $msg" -ForegroundColor Red; exit 1 }

docker version --format '{{.Server.Version}}' *> $null
if ($LASTEXITCODE -ne 0) { Fail "Docker ne répond pas. Lancez Docker Desktop puis relancez ce script." }

if (-not (Test-Path .env)) {
  Write-Host "Premier lancement : création du fichier .env" -ForegroundColor Cyan
  $pgUser = Read-Host "Utilisateur Postgres [postgres]"
  if (-not $pgUser) { $pgUser = 'postgres' }
  $pgPassword = Read-Host "Mot de passe Postgres de cet utilisateur (le même que pour le Tracker)"
  $domain = Read-Host "Domaine email autorisé, ex. tacquet.fr (vide = tous)"

  $bytes = New-Object byte[] 48
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $secret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  $pw = [uri]::EscapeDataString($pgPassword)

  @(
    "PORT=4100"
    "DATABASE_URL=postgres://${pgUser}:${pw}@192.168.0.134:5432/tacquet_hub"
    "JWT_SECRET=$secret"
    "JWT_EXPIRES_IN=30d"
    "ALLOWED_EMAIL_DOMAIN=$domain"
    "UPLOAD_DIR=./uploads"
  ) | Set-Content -Path .env -Encoding ascii
  Write-Host ".env créé (ne jamais le copier ni le committer)." -ForegroundColor Green
}

Write-Host "`nConstruction de l'image..." -ForegroundColor Cyan
docker build -t tacquet-hub-api .
if ($LASTEXITCODE -ne 0) { Fail "La construction de l'image a échoué (voir ci-dessus)." }

docker rm -f tacquet-hub-api *> $null
docker run -d --name tacquet-hub-api --restart unless-stopped --env-file .env `
  -p 4100:4100 -v tacquet-hub-uploads:/app/uploads tacquet-hub-api | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "Le conteneur n'a pas démarré." }

Write-Host "Démarrage de l'API..." -ForegroundColor Cyan
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-RestMethod -Uri 'http://localhost:4100/api/health' -TimeoutSec 2
    if ($r.ok) { $ok = $true; break }
  } catch { }
}
if (-not $ok) {
  Write-Host "`nL'API ne répond pas. Dernières lignes du journal :" -ForegroundColor Red
  docker logs --tail 30 tacquet-hub-api
  Fail "Vérifiez le mot de passe Postgres dans .env (le supprimer puis relancer ce script pour le ressaisir)."
}

if (-not (Get-NetFirewallRule -DisplayName 'Tacquet Hub API' -ErrorAction SilentlyContinue)) {
  try {
    New-NetFirewallRule -DisplayName 'Tacquet Hub API' -Direction Inbound -Protocol TCP -LocalPort 4100 -Action Allow -ErrorAction Stop | Out-Null
    Write-Host "Pare-feu : port 4100 ouvert." -ForegroundColor Green
  } catch {
    Write-Host "Pare-feu : règle non créée (lancer PowerShell en administrateur), ou port déjà ouvert à la main." -ForegroundColor Yellow
  }
}

Write-Host "`nOK : Tacquet Hub API en service sur http://192.168.0.134:4100" -ForegroundColor Green
Write-Host "Premier lancement : connexion avec le compte admin."
