# Fix PostgREST on host Postgres by removing Supabase-image-only libraries
# (supautils, safeupdate) from role authenticator.
#
# Usage (from repo root, preferably elevated if supabase_admin password is unknown):
#   npm run registry:fix-postgrest
#   # or:
#   powershell -ExecutionPolicy Bypass -File .\scripts\fix-postgrest-authenticator.ps1
#
# If supabase_admin cannot login with POSTGRES_PASSWORD, this script can temporarily
# add localhost trust for that role, reload Postgres (needs Admin), fix the role,
# sync the password, then restore pg_hba.conf.

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$supabaseEnvPath = Join-Path $repoRoot 'supabase\.env'
$psqlCandidates = @(
  'C:\Program Files\PostgreSQL\15\bin\psql.exe',
  'C:\Program Files\PostgreSQL\12\bin\psql.exe'
)
$pgCtlCandidates = @(
  'C:\Program Files\PostgreSQL\15\bin\pg_ctl.exe',
  'C:\Program Files\PostgreSQL\12\bin\pg_ctl.exe'
)
$psql = $psqlCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
$pgCtl = $pgCtlCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
$pgData = 'D:\Data\PostgreSQL\15\data'
$hbaPath = Join-Path $pgData 'pg_hba.conf'
$hbaBackup = Join-Path $pgData 'pg_hba.conf.bak-postgrest-fix'

function Test-IsAdmin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($id)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

function Invoke-Psql([string]$User, [string]$Password, [string]$Sql) {
  $env:PGPASSWORD = $Password
  & $psql -h $pgHost -p $pgPort -U $User -d $pgDb -v ON_ERROR_STOP=1 -c $Sql
  return $LASTEXITCODE
}

function Test-PsqlLogin([string]$User, [string]$Password) {
  $env:PGPASSWORD = $Password
  & $psql -h $pgHost -p $pgPort -U $User -d $pgDb -v ON_ERROR_STOP=1 -c "SELECT 1" | Out-Null
  return ($LASTEXITCODE -eq 0)
}

if (-not (Test-Path $supabaseEnvPath)) {
  throw "Missing supabase\.env at $supabaseEnvPath"
}
if (-not $psql) {
  throw 'psql not found under PostgreSQL 15/12 Program Files — update path in this script.'
}

$pgPassword = $null
$pgHost = 'localhost'
$pgPort = '5434'
$pgDb = 'supabase'

Get-Content $supabaseEnvPath | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
  $name, $value = $_.Split('=', 2)
  $name = $name.Trim()
  $value = $value.Trim().Trim("'").Trim('"')
  switch ($name) {
    'POSTGRES_PASSWORD' { $pgPassword = $value }
    'POSTGRES_HOST' {
      if ($value -and $value -ne 'host.docker.internal') { $pgHost = $value }
    }
    'POSTGRES_PORT' { if ($value) { $pgPort = $value } }
    'POSTGRES_DB' { if ($value) { $pgDb = $value } }
  }
}

if (-not $pgPassword) {
  throw 'POSTGRES_PASSWORD missing from supabase\.env'
}

Write-Host "Connecting as ${pgHost}:${pgPort}/${pgDb} ..."
Write-Host 'Note: only a true superuser can clear session_preload_libraries (supabase_admin).'

$usedTrustBootstrap = $false
$adminOk = Test-PsqlLogin -User 'supabase_admin' -Password $pgPassword

if (-not $adminOk) {
  Write-Host 'supabase_admin login failed with POSTGRES_PASSWORD — attempting localhost trust bootstrap.'

  if (-not (Test-IsAdmin)) {
    Write-Host @'

Need Administrator once to:
  1) temporarily allow local trust for supabase_admin
  2) reload Postgres
  3) reset authenticator + sync supabase_admin password
  4) restore pg_hba.conf

Re-run elevated, e.g.:
  Start-Process powershell -Verb RunAs -ArgumentList '-ExecutionPolicy Bypass -File "FULLPATH\scripts\fix-postgrest-authenticator.ps1"'

Or as any cluster superuser:
  ALTER USER supabase_admin WITH PASSWORD ''<POSTGRES_PASSWORD>'';
'@
    throw 'Cannot login as supabase_admin and not running as Administrator.'
  }

  if (-not (Test-Path $hbaPath)) {
    throw "pg_hba.conf not found at $hbaPath"
  }
  if (-not $pgCtl) {
    throw 'pg_ctl not found — cannot reload Postgres after pg_hba edit.'
  }

  Copy-Item $hbaPath $hbaBackup -Force
  $hba = [System.IO.File]::ReadAllText($hbaPath)
  if ($hba -notmatch 'TEMP: local trust for PostgREST') {
    $marker = "# TYPE  DATABASE        USER            ADDRESS                 METHOD"
    $inject = @"
# TYPE  DATABASE        USER            ADDRESS                 METHOD
# TEMP: local trust for PostgREST authenticator fix (remove after)
host    all             supabase_admin  127.0.0.1/32            trust
host    all             supabase_admin  ::1/128                 trust
"@
    if ($hba -notmatch [regex]::Escape($marker)) {
      throw 'Could not find pg_hba marker line to inject trust rules.'
    }
    $hba = $hba.Replace($marker, $inject)
    Write-Utf8NoBom -Path $hbaPath -Content $hba
  }

  & $pgCtl reload -D $pgData
  if ($LASTEXITCODE -ne 0) {
    Copy-Item $hbaBackup $hbaPath -Force
    throw 'pg_ctl reload failed — restored pg_hba backup.'
  }
  Start-Sleep -Seconds 1

  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  & $psql -h 127.0.0.1 -p $pgPort -U supabase_admin -d $pgDb -v ON_ERROR_STOP=1 -c "SELECT 1" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Copy-Item $hbaBackup $hbaPath -Force
    & $pgCtl reload -D $pgData | Out-Null
    throw 'Trust login as supabase_admin failed — restored pg_hba backup.'
  }

  $usedTrustBootstrap = $true
  # Prefer TCP host used for trust rules
  $pgHost = '127.0.0.1'
  $pgPasswordForAdmin = ''
} else {
  $pgPasswordForAdmin = $pgPassword
}

$fixSql = @"
ALTER ROLE authenticator RESET ALL;
ALTER ROLE authenticator SET statement_timeout = '8s';
ALTER ROLE authenticator SET lock_timeout = '8s';
ALTER USER supabase_admin WITH PASSWORD '$pgPassword';
SELECT rolname, rolconfig FROM pg_roles WHERE rolname = 'authenticator';
"@

if ($usedTrustBootstrap) {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  & $psql -h $pgHost -p $pgPort -U supabase_admin -d $pgDb -v ON_ERROR_STOP=1 -c $fixSql
} else {
  $code = Invoke-Psql -User 'supabase_admin' -Password $pgPasswordForAdmin -Sql $fixSql
  if ($code -ne 0) { throw 'Failed to reset authenticator role' }
}
if ($LASTEXITCODE -ne 0) { throw 'Failed to reset authenticator role' }

if ($usedTrustBootstrap) {
  Write-Host 'Restoring pg_hba.conf ...'
  Copy-Item $hbaBackup $hbaPath -Force
  & $pgCtl reload -D $pgData
  if ($LASTEXITCODE -ne 0) {
    throw 'Authenticator fixed, but pg_hba restore reload failed — restore manually from pg_hba.conf.bak-postgrest-fix'
  }
  if (-not (Test-PsqlLogin -User 'supabase_admin' -Password $pgPassword)) {
    throw 'supabase_admin password sync verification failed after restoring pg_hba.'
  }
}

Write-Host 'Restarting supabase rest container...'
Push-Location (Join-Path $repoRoot 'supabase')
try {
  docker compose -f docker-compose.yml -f docker-compose.external-db.yml restart rest
} finally {
  Pop-Location
}

Write-Host 'Done. Check rest with: docker compose -f docker-compose.yml -f docker-compose.external-db.yml ps rest'
