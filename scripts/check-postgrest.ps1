# Smoke-check Supabase PostgREST (supabase-rest) against host Postgres.
#
# Usage (repo root):
#   npm run registry:check-rest
#
# Reads ANON_KEY + SUPABASE_PUBLIC_URL from supabase\.env

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$supabaseEnvPath = Join-Path $repoRoot 'supabase\.env'

if (-not (Test-Path $supabaseEnvPath)) {
  throw "Missing supabase\.env at $supabaseEnvPath"
}

$anonKey = $null
$baseUrl = 'http://localhost:8000'

Get-Content $supabaseEnvPath | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
  $name, $value = $_.Split('=', 2)
  $name = $name.Trim()
  $value = $value.Trim().Trim("'").Trim('"')
  switch ($name) {
    'ANON_KEY' { $anonKey = $value }
    'SUPABASE_PUBLIC_URL' { if ($value) { $baseUrl = $value.TrimEnd('/') } }
  }
}

if (-not $anonKey) {
  throw 'ANON_KEY missing from supabase\.env'
}

$restStatus = docker ps --filter 'name=supabase-rest' --format '{{.Status}}' 2>$null
if (-not $restStatus) {
  throw 'supabase-rest container not found'
}
Write-Host "container: $restStatus"
if ($restStatus -notmatch 'healthy') {
  throw "supabase-rest is not healthy: $restStatus"
}

$uri = "$baseUrl/rest/v1/entities?select=api_name&limit=3"
$headers = @{
  apikey        = $anonKey
  Authorization = "Bearer $anonKey"
}

try {
  $response = Invoke-WebRequest -Uri $uri -Headers $headers -UseBasicParsing -TimeoutSec 15
} catch {
  throw "PostgREST request failed: $($_.Exception.Message)"
}

if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
  throw "Unexpected status $($response.StatusCode)"
}

$payload = $response.Content
$rows = $payload | ConvertFrom-Json
$count = if ($rows -is [array]) { $rows.Count } else { 1 }
Write-Host "PostgREST OK ($($response.StatusCode)) - entities sample rows=$count"
if ($count -lt 1) {
  Write-Host 'WARN: 0 entities visible to anon — apply migration 202609030002_registry_anon_select.sql or re-import schema'
}
