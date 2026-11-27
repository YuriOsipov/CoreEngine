# Mint a dedicated MCP credential and write it into .cursor/mcp.json.
# Usage (repo root):
#   .\scripts\refresh-cursor-mcp.ps1
#   .\scripts\refresh-cursor-mcp.ps1 -Email admin@example.com -Password '...'
#
# Requires local login (POST /auth/login). SSO-only: use Setup → MCP in the UI.
# Prefer short TTL + read scope for day-to-day assistants.
param(
  [string]$Email = 'admin@example.com',
  [string]$Password = 'CoreEngineDevAdmin1!',
  [string]$BffUrl = 'http://127.0.0.1:4000',
  [string]$Label = 'cursor-local',
  [string[]]$Scopes = @('read'),
  [int]$ExpiresInHours = 24
)

$ErrorActionPreference = 'Stop'

if ($BffUrl -notmatch '^https?://(localhost|127\.0\.0\.1)(:\d+)?(/.*)?$') {
  if ($BffUrl -notmatch '^https://') {
    throw 'Non-local BffUrl must use HTTPS. Refusing to send credentials over plain HTTP.'
  }
}

$login = Invoke-RestMethod -Uri "$BffUrl/auth/login" -Method POST -ContentType 'application/json' -Body (@{
  email = $Email
  password = $Password
} | ConvertTo-Json)

if (-not $login.access_token) {
  throw 'Login failed — no access_token'
}

$credBody = @{
  label = $Label
  scopes = $Scopes
  expiresInHours = $ExpiresInHours
} | ConvertTo-Json

$created = Invoke-RestMethod -Uri "$BffUrl/api/v1/mcp/credentials" -Method POST `
  -ContentType 'application/json' `
  -Headers @{ Authorization = "Bearer $($login.access_token)" } `
  -Body $credBody

if (-not $created.token) {
  throw 'Create MCP credential failed — no token returned'
}

$cursorDir = Join-Path (Join-Path $PSScriptRoot '..') '.cursor'
New-Item -ItemType Directory -Force -Path $cursorDir | Out-Null
$cfg = @{
  mcpServers = @{
    coreengine = @{
      url = "$BffUrl/api/v1/mcp"
      headers = @{
        Authorization = "Bearer $($created.token)"
      }
    }
  }
}
$path = Join-Path $cursorDir 'mcp.json'
($cfg | ConvertTo-Json -Depth 6) | Set-Content -Path $path -Encoding utf8
Write-Host "Wrote $path (MCP credential '$Label', scopes=$($Scopes -join ','), ${ExpiresInHours}h). Reload MCP in Cursor if needed."
