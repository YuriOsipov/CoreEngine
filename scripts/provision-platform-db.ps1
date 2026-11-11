# Provision a new CoreEngine customer database: platform kernel + documents pack
# (+ optional vertical domain pack).
#
# Usage (repo root):
#   powershell -File .\scripts\provision-platform-db.ps1
#   powershell -File .\scripts\provision-platform-db.ps1 -Domain sales
#   powershell -File .\scripts\provision-platform-db.ps1 -Domain clinic -AdminPassword 'ChangeMeNow!'
#
# If -AdminPassword is omitted, a random password is generated and printed once
# (no well-known default such as admin12345).
#
# Prerequisites:
#   - Empty (or target) Postgres reachable via supabase/.env
#   - psql available
#   - npm install (and crm-bff deps) for domain pack loader / password hash

param(
  [ValidateSet('none', 'sales', 'clinic', 'pricing', 'documents')]
  [string]$Domain = 'none',
  [string]$AdminEmail = 'admin@example.com',
  [string]$AdminPassword = ''
)

# Native tools (psql) write NOTICE to stderr; do not treat that as terminating.
$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$supabaseEnv = Join-Path $repoRoot 'supabase\.env'
if (-not (Test-Path $supabaseEnv)) {
  $example = Join-Path $repoRoot 'supabase\.env.example'
  throw ("Missing supabase\.env - copy from supabase\.env.example and point at the new customer DB. Example: " + $example)
}

$passwordWasGenerated = [string]::IsNullOrWhiteSpace($AdminPassword)
if ($passwordWasGenerated) {
  $bytes = New-Object byte[] 18
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $AdminPassword = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

Write-Host '==> 1/5 Auth JWT secret'
& npx --prefix .\crm-bff tsx --env-file=.env --env-file=supabase/.env .\scripts\ensure-auth-jwt-secret.mts
if ($LASTEXITCODE -ne 0) { throw 'Failed to ensure AUTH_JWT_SECRET' }

Write-Host '==> 2/5 Kernel SQL (supabase/migrations)'
& powershell -NoProfile -File (Join-Path $repoRoot 'scripts\apply-registry-migration.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Kernel migrate failed' }

Write-Host "==> 3/5 Admin password for $AdminEmail"
& npx --prefix .\crm-bff tsx --env-file=.env --env-file=supabase/.env .\scripts\set-user-password.mts $AdminEmail $AdminPassword --must-change
if ($LASTEXITCODE -ne 0) { throw 'Failed to set admin password' }

Write-Host '==> 4/5 Documents pack (doc_template / snapshots / values)'
& npx --prefix .\crm-bff tsx --env-file=.env --env-file=supabase/.env .\scripts\apply-domain-pack.mts documents
if ($LASTEXITCODE -ne 0) { throw 'Documents pack failed' }

if ($Domain -ne 'none' -and $Domain -ne 'documents') {
  Write-Host "==> 5/5 Domain pack: $Domain"
  & npx --prefix .\crm-bff tsx --env-file=.env --env-file=supabase/.env .\scripts\apply-domain-pack.mts $Domain
  if ($LASTEXITCODE -ne 0) { throw "Domain pack failed: $Domain" }
} else {
  Write-Host '==> 5/5 Vertical domain pack: skipped'
}

Write-Host ''
Write-Host 'Provision complete.'
if ($passwordWasGenerated) {
  Write-Host "  Login: $AdminEmail"
  Write-Host "  Generated admin password (save now; not stored in plaintext): $AdminPassword"
} else {
  Write-Host "  Login: $AdminEmail / (password you set via -AdminPassword)"
}
Write-Host '  First login requires a password change (must_change_password).'
Write-Host '  Next: npm run bff:dev   then   npm run dev'
if ($Domain -eq 'none') {
  Write-Host '  Or apply a pack later: npm run platform:apply-pack -- sales'
}
