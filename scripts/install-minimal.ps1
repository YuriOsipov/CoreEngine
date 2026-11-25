# One-shot lightweight install: Postgres + BFF (+ optional stub UI).
# Usage (repo root):
#   powershell -File ./scripts/install-minimal.ps1
#   powershell -File ./scripts/install-minimal.ps1 -Domain sales -WithUi
# n8n is not started here. Customers pull that upstream image themselves:
#   docker compose -f docker-compose.minimal.yml --profile automation up -d n8n
# Activepieces starts with this stack (restart: always). -WithActivepieces is accepted and ignored.
#   powershell -File ./scripts/install-minimal.ps1 -AdminPassword 'ChooseAUniqueSecret!'
param(
  [ValidateSet('none', 'sales', 'clinic', 'pricing', 'documents')]
  [string]$Domain = 'sales',
  [switch]$WithUi,
  [switch]$WithN8n,
  [switch]$WithActivepieces,
  [string]$AdminPassword = ''
)

$ErrorActionPreference = 'Stop'
if ($WithN8n) {
  throw @"
This installer does not start n8n. Pull the upstream image yourself:

  docker compose -f docker-compose.minimal.yml --profile automation up -d n8n

See THIRD_PARTY.md. Sell implementation and support, not n8n access.
"@
}
# Activepieces is part of the default stack. Keep -WithActivepieces so older commands still run.
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $Root

function Get-RandSecret {
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '').Replace('/', '').Substring(0, [Math]::Min(32, 32))
}

function Get-RandHex([int]$ByteCount) {
  $bytes = New-Object byte[] $ByteCount
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return ([BitConverter]::ToString($bytes) -replace '-', '').ToLower()
}

function Set-EnvKv([string]$Path, [string]$Key, [string]$Value) {
  $lines = @(Get-Content -LiteralPath $Path)
  $found = $false
  $next = foreach ($line in $lines) {
    if ($line -match "^$([regex]::Escape($Key))=") {
      $found = $true
      "$Key=$Value"
    } else {
      $line
    }
  }
  if (-not $found) { $next += "$Key=$Value" }
  Set-Content -LiteralPath $Path -Value $next -Encoding utf8
}

function Get-EnvKv([string]$Path, [string]$Key) {
  $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match "^$([regex]::Escape($Key))=" } | Select-Object -First 1
  if (-not $line) { return '' }
  return ($line -replace "^$([regex]::Escape($Key))=", '')
}

if (-not (Test-Path -LiteralPath '.env')) {
  Copy-Item '.env.docker.example' '.env'
  Write-Host '==> Created .env from .env.docker.example'
}

Set-EnvKv '.env' 'POSTGRES_DB' 'coreengine'

$pw = Get-EnvKv '.env' 'POSTGRES_PASSWORD'
$appPw = Get-EnvKv '.env' 'POSTGRES_APP_PASSWORD'
if (-not $pw) {
  $pw = Get-RandSecret
  Set-EnvKv '.env' 'POSTGRES_PASSWORD' $pw
  Write-Host '==> Generated POSTGRES_PASSWORD in .env'
}
if (-not $appPw) {
  $appPw = Get-RandSecret
  Set-EnvKv '.env' 'POSTGRES_APP_PASSWORD' $appPw
  Set-EnvKv '.env' 'POSTGRES_BOOTSTRAP_PASSWORD' $appPw
  Write-Host '==> Generated POSTGRES_APP_PASSWORD in .env'
}

function Set-EnvKvIfEmpty([string]$Path, [string]$Key, [string]$Value) {
  $cur = Get-EnvKv $Path $Key
  if ($cur) { return }
  Set-EnvKv $Path $Key $Value
  Write-Host "==> Generated $Key in .env"
}

Set-EnvKvIfEmpty '.env' 'AP_ENCRYPTION_KEY' (Get-RandHex 16)
Set-EnvKvIfEmpty '.env' 'AP_JWT_SECRET' (Get-RandHex 32)
Set-EnvKvIfEmpty '.env' 'AP_POSTGRES_PASSWORD' (Get-RandSecret)
Set-EnvKvIfEmpty '.env' 'ACTIVEPIECES_WEBHOOK_SECRET' (Get-RandSecret)
Set-EnvKvIfEmpty '.env' 'ACTIVEPIECES_BASE_URL' 'http://activepieces:80'

Copy-Item '.env' 'supabase/.env' -Force
Write-Host '==> Synced supabase/.env from .env'

$compose = @('compose', '-f', 'docker-compose.minimal.yml')

Write-Host '==> Starting Postgres'
& docker @compose up -d db

Write-Host '==> Waiting for Postgres health'
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  & docker @compose exec -T db pg_isready -U postgres -d coreengine 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 1
}
if (-not $ready) { throw 'Postgres did not become ready in time' }

$provisionArgs = @('--domain', $Domain)
if ($AdminPassword) {
  $provisionArgs += @('--admin-password', $AdminPassword)
}

Write-Host "==> Provisioning kernel + pack ($Domain)"
& docker @compose run --rm --workdir /app bff `
  npx --prefix ./crm-bff tsx --env-file=.env --env-file=supabase/.env `
  ./scripts/provision-platform-db.mts @provisionArgs
if ($LASTEXITCODE -ne 0) { throw 'Provision failed' }

Write-Host '==> Starting BFF'
& docker @compose up -d bff

Write-Host '==> Starting Activepieces (restart: always)'
& docker @compose up -d activepieces activepieces-worker
if ($LASTEXITCODE -ne 0) { throw 'Activepieces did not start' }

if ($WithUi) {
  Write-Host '==> Building optional web UI (@docengine/* from npm, or npm run docengine:use-local)'
  & docker @compose --profile ui up -d --build web
}

Write-Host ''
Write-Host 'Lightweight install ready.'
Write-Host '  BFF health: http://localhost:4000/health'
if ($WithUi) { Write-Host '  UI:         http://localhost:8080' }
Write-Host '  n8n:        not started. Pull upstream yourself if you want it (see THIRD_PARTY.md):'
Write-Host '              docker compose -f docker-compose.minimal.yml --profile automation up -d n8n'
Write-Host '  Activepieces: http://127.0.0.1:8081 (restarts with Docker)'
Write-Host '  Login:      admin@example.com (password from provision output above)'
Write-Host '  Upgrade:    see docs/upgrading.md'
Write-Host '  Backup:     see docs/backup-restore.md'
Write-Host '  Support:    see SUPPORT.md'
