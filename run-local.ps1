<#
  Starts RetroLive for local development (Windows PowerShell):
    .\run-local.ps1            start the API (http://localhost:4000) and the web app (http://localhost:5173)
    .\run-local.ps1 -Stop      stop both

  Requirements: Node 22+, and a local PostgreSQL with an empty "retrolive" database.
  Settings are read from the .env file in this folder (copy .env.example to .env first).
#>
param(
    [switch]$Stop,
    # Turns off the per-IP rate limits, for the end-to-end tests that create dozens of accounts a minute from one machine.
    [switch]$E2E
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'

function Stop-App {
    Get-CimInstance Win32_Process |
        Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match [regex]::Escape($root) -and $_.CommandLine -match 'tsx|vite' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host "stopped node ($($_.ProcessId))" }
}

if ($Stop) { Stop-App; return }

if (-not (Test-Path (Join-Path $root '.env'))) {
    throw 'Missing .env - copy .env.example to .env and fill it in first.'
}
Stop-App

if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    Write-Host 'Installing dependencies...' -ForegroundColor Cyan
    Push-Location $root
    npm install --no-audit --no-fund
    Pop-Location
}

# make sure the database has the latest tables
Push-Location $backend
Write-Host 'Applying database migrations...' -ForegroundColor Cyan
$ErrorActionPreference = 'Continue'
npm run db:deploy --silent 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'Applying the database migrations failed (is PostgreSQL running and DATABASE_URL correct?)' }
npx prisma generate 2>&1 | Out-Null
$ErrorActionPreference = 'Stop'
Pop-Location

Write-Host 'Starting the API on :4000 ...' -ForegroundColor Cyan
if ($E2E) { $env:RATE_LIMITS_ENABLED = 'false'; Write-Host '(rate limits are OFF for the end-to-end tests)' -ForegroundColor Yellow }
Start-Process -FilePath cmd.exe -ArgumentList '/c', 'npx tsx src/server.ts > run.log 2>&1' -WorkingDirectory $backend -WindowStyle Hidden

Write-Host 'Starting the web app on :5173 ...' -ForegroundColor Cyan
Start-Process -FilePath cmd.exe -ArgumentList '/c', 'npx vite > run.log 2>&1' -WorkingDirectory $frontend -WindowStyle Hidden

$deadline = (Get-Date).AddSeconds(90)
$apiUp = $false; $webUp = $false
while ((Get-Date) -lt $deadline -and -not ($apiUp -and $webUp)) {
    Start-Sleep -Seconds 2
    if (-not $apiUp) { try { $apiUp = (Invoke-RestMethod http://localhost:4000/health -TimeoutSec 2).status -eq 'ok' } catch {} }
    if (-not $webUp) { try { $webUp = (Invoke-WebRequest http://localhost:5173 -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch {} }
}

if ($apiUp -and $webUp) {
    Write-Host ''
    Write-Host 'Ready:  http://localhost:5173' -ForegroundColor Green
    Write-Host 'Host a retro: create an account, make a session, then open the join link in a second browser window.'
    Write-Host 'Stop with:   .\run-local.ps1 -Stop'
} else {
    Write-Host "Not ready in time. API up: $apiUp, web up: $webUp" -ForegroundColor Yellow
    Write-Host 'Check backend\run.log and frontend\run.log'
}
