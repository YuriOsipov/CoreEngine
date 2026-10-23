# Provision a new Helix customer database: platform kernel + documents pack
# (+ optional vertical domain pack).
#
# Usage (repo root):
#   powershell -File .\scripts\provision-platform-db.ps1
#   powershell -File .\scripts\provision-platform-db.ps1 -Domain sales
#   powershell -File .\scripts\provision-platform-db.ps1 -Domain clinic -AdminPassword 'ChangeMeNow!'
#
# Prerequisites:
#   - Empty (or target) Postgres reachable via supabase/.env
#   - psql available
#   - npm install (and crm-bff deps) for domain pack loader / password hash

param(
  [ValidateSet('none', 'sales', 'clinic', 'pricing', 'documents')]
  [string]$Domain = 'none',
  [string]$AdminEmail = 'admin@example.com',
  [string]$AdminPassword = 'admin12345'
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

Write-Host '==> 1/4 Kernel SQL (supabase/migrations)'
& powershell -NoProfile -File (Join-Path $repoRoot 'scripts\apply-registry-migration.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Kernel migrate failed' }

Write-Host "==> 2/4 Admin password for $AdminEmail"
& npx --prefix .\crm-bff tsx --env-file=.env --env-file=supabase/.env .\scripts\set-user-password.mts $AdminEmail $AdminPassword
if ($LASTEXITCODE -ne 0) { throw 'Failed to set admin password' }

Write-Host '==> 3/4 Documents pack (doc_template / snapshots / values)'
& npx --prefix .\crm-bff tsx --env-file=.env --env-file=supabase/.env .\scripts\apply-domain-pack.mts documents
if ($LASTEXITCODE -ne 0) { throw 'Documents pack failed' }

if ($Domain -ne 'none' -and $Domain -ne 'documents') {
  Write-Host "==> 4/4 Domain pack: $Domain"
  & npx --prefix .\crm-bff tsx --env-file=.env --env-file=supabase/.env .\scripts\apply-domain-pack.mts $Domain
  if ($LASTEXITCODE -ne 0) { throw "Domain pack failed: $Domain" }
} else {
  Write-Host '==> 4/4 Vertical domain pack: skipped'
}

Write-Host ''
Write-Host 'Provision complete.'
Write-Host "  Login: $AdminEmail / (password you set)"
Write-Host '  Next: npm run bff:dev   then   npm run dev'
if ($Domain -eq 'none') {
  Write-Host '  Or apply a pack later: npm run platform:apply-pack -- sales'
}
