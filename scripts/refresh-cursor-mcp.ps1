# Refresh .cursor/mcp.json with a fresh CoreEngine admin access token.
# Usage (repo root):
#   .\scripts\refresh-cursor-mcp.ps1
#   .\scripts\refresh-cursor-mcp.ps1 -Email admin@example.com -Password '...'
param(
  [string]$Email = 'admin@example.com',
  [string]$Password = 'CoreEngineDevAdmin1!',
  [string]$BffUrl = 'http://127.0.0.1:4000'
)

$ErrorActionPreference = 'Stop'
$login = Invoke-RestMethod -Uri "$BffUrl/auth/login" -Method POST -ContentType 'application/json' -Body (@{
  email = $Email
  password = $Password
} | ConvertTo-Json)

if (-not $login.access_token) {
  throw 'Login failed — no access_token'
}

$cursorDir = Join-Path (Join-Path $PSScriptRoot '..') '.cursor'
New-Item -ItemType Directory -Force -Path $cursorDir | Out-Null
$cfg = @{
  mcpServers = @{
    coreengine = @{
      url = "$BffUrl/api/v1/mcp"
      headers = @{
        Authorization = "Bearer $($login.access_token)"
      }
    }
  }
}
$path = Join-Path $cursorDir 'mcp.json'
($cfg | ConvertTo-Json -Depth 6) | Set-Content -Path $path -Encoding utf8
Write-Host "Wrote $path (access token TTL ~15m). Reload MCP in Cursor if needed."
