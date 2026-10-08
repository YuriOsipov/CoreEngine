# Apply a single PM-related SQL migration by filename (arg1) or default fix.
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$supabaseEnvPath = Join-Path $repoRoot 'supabase\.env'
$fileName = if ($args.Count -ge 1 -and $args[0]) { [string]$args[0] } else { '202609140002_pm_promoted_system_columns.sql' }
$mig = Join-Path $repoRoot "supabase\migrations\$fileName"

if (-not (Test-Path $supabaseEnvPath)) { throw "Missing $supabaseEnvPath" }
if (-not (Test-Path $mig)) { throw "Missing $mig" }

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
$password = if ($envMap['POSTGRES_BOOTSTRAP_PASSWORD']) { $envMap['POSTGRES_BOOTSTRAP_PASSWORD'] } else { $envMap['POSTGRES_PASSWORD'] }

$psqlCandidates = @(
  'psql',
  'D:\PostgreSQL\15\bin\psql.exe',
  'C:\Program Files\PostgreSQL\15\bin\psql.exe',
  'C:\Program Files\PostgreSQL\14\bin\psql.exe'
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
if (-not $psql) { throw 'psql not found' }

$env:PGPASSWORD = $password
Write-Host "Applying $fileName to ${hostName}:${port}/${db}"
& $psql -h $hostName -p $port -U $user -d $db -v ON_ERROR_STOP=1 -f $mig
if ($LASTEXITCODE -ne 0) { throw 'Migration failed' }
Write-Host 'Done.'
