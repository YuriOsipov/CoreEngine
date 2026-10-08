# Apply CRM registry SQL migrations to local Supabase Postgres.
# Usage (from repo root):
#   powershell -File .\scripts\apply-registry-migration.ps1

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$supabaseEnvPath = Join-Path $repoRoot 'supabase\.env'
$migrationsDir = Join-Path $repoRoot 'supabase\migrations'

if (-not (Test-Path $supabaseEnvPath)) {
  throw "Missing $supabaseEnvPath"
}

$envMap = @{}
Get-Content $supabaseEnvPath | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith('#')) { return }
  $idx = $line.IndexOf('=')
  if ($idx -lt 1) { return }
  $key = $line.Substring(0, $idx).Trim()
  $value = $line.Substring($idx + 1).Trim()
  $envMap[$key] = $value
}

$hostName = if ($envMap['POSTGRES_HOST'] -eq 'host.docker.internal') { 'localhost' } else { $envMap['POSTGRES_HOST'] }
$port = $envMap['POSTGRES_PORT']
$db = $envMap['POSTGRES_DB']
$user = if ($envMap['POSTGRES_BOOTSTRAP_USER']) { $envMap['POSTGRES_BOOTSTRAP_USER'] } else { 'postgres' }
$password = if ($envMap['POSTGRES_BOOTSTRAP_PASSWORD']) { $envMap['POSTGRES_BOOTSTRAP_PASSWORD'] } else { $envMap['POSTGRES_PASSWORD'] }

$psqlCandidates = @(
  'psql',
  'D:\PostgreSQL\15\bin\psql.exe',
  'C:\Program Files\PostgreSQL\15\bin\psql.exe',
  'C:\Program Files\PostgreSQL\14\bin\psql.exe',
  'C:\Program Files\PostgreSQL\12\bin\psql.exe'
)

$psql = $null
foreach ($candidate in $psqlCandidates) {
  if ($candidate -eq 'psql') {
    $cmd = Get-Command psql -ErrorAction SilentlyContinue
    if ($cmd) { $psql = $cmd.Source; break }
  } elseif (Test-Path $candidate) {
    $psql = $candidate
    break
  }
}

if (-not $psql) {
  throw 'psql not found. Install PostgreSQL client tools or add psql to PATH.'
}

$files = Get-ChildItem $migrationsDir -Filter '*.sql' | Sort-Object Name
if ($files.Count -eq 0) {
  throw "No SQL files in $migrationsDir"
}

$env:PGPASSWORD = $password
Write-Host "Applying $($files.Count) migration(s) to ${hostName}:${port}/${db} as ${user}"

& $psql -h $hostName -p $port -U $user -d $db -v ON_ERROR_STOP=1 -c @"
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
"@
if ($LASTEXITCODE -ne 0) {
  throw 'Failed to ensure public.schema_migrations'
}

$tracked = & $psql -h $hostName -p $port -U $user -d $db -tA -c "SELECT COUNT(*) FROM public.schema_migrations"
$entityCount = & $psql -h $hostName -p $port -U $user -d $db -tA -c "SELECT COUNT(*) FROM public.entities"
if ($LASTEXITCODE -ne 0) {
  throw 'Failed to inspect schema_migrations / entities'
}
if ([int](($tracked | Out-String).Trim()) -eq 0 -and [int](($entityCount | Out-String).Trim()) -gt 0) {
  Write-Host 'Recording previously applied migrations (existing database)'
  foreach ($file in $files) {
    if ($file.Name -eq '202609180001_pm_task_to_stage.sql') { continue }
    & $psql -h $hostName -p $port -U $user -d $db -v ON_ERROR_STOP=1 -c "INSERT INTO public.schema_migrations (filename) VALUES ('$($file.Name)') ON CONFLICT (filename) DO NOTHING;"
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to record existing migration: $($file.Name)"
    }
  }
}

foreach ($file in $files) {
  $applied = & $psql -h $hostName -p $port -U $user -d $db -tA -c "SELECT 1 FROM public.schema_migrations WHERE filename = '$($file.Name)'"
  if (($applied | Out-String).Trim() -eq '1') {
    Write-Host "skip $($file.Name)"
    continue
  }
  Write-Host "-> $($file.Name)"
  & $psql -h $hostName -p $port -U $user -d $db -v ON_ERROR_STOP=1 -f $file.FullName
  if ($LASTEXITCODE -ne 0) {
    throw "Migration failed: $($file.Name)"
  }
  & $psql -h $hostName -p $port -U $user -d $db -v ON_ERROR_STOP=1 -c "INSERT INTO public.schema_migrations (filename) VALUES ('$($file.Name)') ON CONFLICT (filename) DO NOTHING;"
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to record migration: $($file.Name)"
  }
}

Write-Host 'Done.'
