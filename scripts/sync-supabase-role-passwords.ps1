# Sync Supabase service role passwords to POSTGRES_PASSWORD from supabase/.env
# Required when Auth/REST fail with:
#   password authentication failed for user "authenticator"
#
# Usage:
#   powershell -File .\scripts\sync-supabase-role-passwords.ps1

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$supabaseEnvPath = Join-Path $repoRoot 'supabase\.env'

$envMap = @{}
Get-Content $supabaseEnvPath | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith('#')) { return }
  $idx = $line.IndexOf('=')
  if ($idx -lt 1) { return }
  $envMap[$line.Substring(0, $idx).Trim()] = $line.Substring($idx + 1).Trim()
}

$hostName = if ($envMap['POSTGRES_HOST'] -eq 'host.docker.internal') { 'localhost' } else { $envMap['POSTGRES_HOST'] }
$port = $envMap['POSTGRES_PORT']
$db = $envMap['POSTGRES_DB']
$user = if ($envMap['POSTGRES_BOOTSTRAP_USER']) { $envMap['POSTGRES_BOOTSTRAP_USER'] } else { 'postgres' }
$bootstrapPassword = if ($envMap['POSTGRES_BOOTSTRAP_PASSWORD']) { $envMap['POSTGRES_BOOTSTRAP_PASSWORD'] } else { $envMap['POSTGRES_PASSWORD'] }
$servicePassword = $envMap['POSTGRES_PASSWORD']

if (-not $servicePassword) {
  throw 'POSTGRES_PASSWORD missing in supabase/.env'
}

$psql = 'C:\Program Files\PostgreSQL\12\bin\psql.exe'
if (-not (Test-Path $psql)) {
  $cmd = Get-Command psql -ErrorAction SilentlyContinue
  if (-not $cmd) { throw 'psql not found' }
  $psql = $cmd.Source
}

$sql = @"
ALTER USER authenticator WITH PASSWORD '$servicePassword';
ALTER USER pgbouncer WITH PASSWORD '$servicePassword';
ALTER USER supabase_auth_admin WITH PASSWORD '$servicePassword';
ALTER USER supabase_functions_admin WITH PASSWORD '$servicePassword';
ALTER USER supabase_storage_admin WITH PASSWORD '$servicePassword';
SELECT 'ok' AS status;
"@

$env:PGPASSWORD = $bootstrapPassword
Write-Host "Updating service role passwords on ${hostName}:${port}/${db} ..."
& $psql -h $hostName -p $port -U $user -d $db -v ON_ERROR_STOP=1 -c $sql
if ($LASTEXITCODE -ne 0) { throw 'Password sync failed' }

Write-Host 'Restarting Auth / REST / Storage ...'
Push-Location (Join-Path $repoRoot 'supabase')
try {
  docker compose -f docker-compose.yml -f docker-compose.external-db.yml up -d auth rest storage
} finally {
  Pop-Location
}

Write-Host 'Done. Check: docker ps --filter name=supabase'
