#Requires -Version 7.2
<#
.SYNOPSIS
  Faehrt den Agency-AO-Stapel hoch: Agency auf :3100, Projektabgleich, Bridge.

.DESCRIPTION
  Der Reihe nach:
    1. prueft, ob die AO-Desktop-App laeuft (~/.ao/running.json plus Prozess)
    2. startet Agency auf Port 3100 und wartet, bis die API antwortet
    3. fuehrt den Projektabgleich einmal aus (danach macht die Bridge ihn selbst)
    4. startet die Bridge mit profil\pipeline.json, Logs nach laufzeit\
    5. oeffnet http://localhost:3100 im Browser

  Die AO-Desktop-App wird bewusst nicht gestartet: sie gehoert dir, nicht
  diesem Skript. Laeuft sie nicht, bricht der Start mit klarer Meldung ab.

  npm run dev wird nicht benutzt - das Skript in Agencys package.json setzt
  die Umgebungsvariable in POSIX-Syntax und scheitert unter Windows. Statt
  dessen wird vinext direkt aufgerufen und WRANGLER_LOG_PATH hier gesetzt.

.PARAMETER Stop
  Beendet Agency und Bridge wieder und laesst nichts Laufendes zurueck.

.PARAMETER Status
  Zeigt nur, was laeuft.

.PARAMETER NoBrowser
  Startet alles, oeffnet aber keinen Browser.

.PARAMETER AgencyPath
  Agency-Klon (Default: D:\Tools\Agency\agency).

.PARAMETER Port
  Port fuer Agency (Default: 3100).

.EXAMPLE
  pwsh -File D:\agency-orchestrator-bridge\scripts\start-pipeline.ps1
.EXAMPLE
  pwsh -File D:\agency-orchestrator-bridge\scripts\start-pipeline.ps1 -Stop
#>
[CmdletBinding()]
param(
  [switch]$Stop,
  [switch]$Status,
  [switch]$NoBrowser,
  [string]$AgencyPath = 'D:\Tools\Agency\agency',
  [int]$Port = 3100
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot   = Split-Path -Parent $PSScriptRoot
$BridgeDir  = Join-Path $RepoRoot 'bridge'
$ProfilDir  = Join-Path $RepoRoot 'profil'
$RuntimeDir = Join-Path $RepoRoot 'laufzeit'
$PidFile    = Join-Path $RuntimeDir 'pipeline-pids.json'
$AgencyUrl  = "http://localhost:$Port"

function Write-Step($text) { Write-Host "  $text" }
function Write-Ok($text)   { Write-Host "  OK  $text" -ForegroundColor Green }
function Write-Warn($text) { Write-Host "  !   $text" -ForegroundColor Yellow }
function Write-Fail($text) { Write-Host "  X   $text" -ForegroundColor Red }

# ---- Zustand -----------------------------------------------------------------

function Read-Pids {
  if (-not (Test-Path $PidFile)) { return @{} }
  try { return (Get-Content -Raw $PidFile | ConvertFrom-Json -AsHashtable) } catch { return @{} }
}

function Write-Pids($map) {
  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  $map | ConvertTo-Json | Set-Content -Path $PidFile -Encoding utf8
}

# Ein gespeicherter Prozess zaehlt nur, wenn er noch laeuft UND seit dem Start
# dieses Skripts existiert: PIDs werden nach einem Neustart wiederverwendet.
function Get-LiveProcess($processId, $startedAt) {
  if (-not $processId) { return $null }
  $p = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if (-not $p) { return $null }
  if ($startedAt) {
    try { if ($p.StartTime -lt ([datetime]$startedAt).AddSeconds(-30)) { return $null } } catch { }
  }
  return $p
}

function Test-AgencyUp {
  try {
    $r = Invoke-WebRequest -Uri "$AgencyUrl/api/state" -Headers @{ 'x-radar-local-agent' = '1' } `
      -TimeoutSec 3 -SkipHttpErrorCheck -ErrorAction Stop
    return $r.StatusCode -lt 500
  } catch { return $false }
}

function Get-AoStatus {
  $runFile = Join-Path $env:USERPROFILE '.ao\running.json'
  if (-not (Test-Path $runFile)) {
    return [pscustomobject]@{ Running = $false; Reason = "$runFile fehlt" }
  }
  try { $info = Get-Content -Raw $runFile | ConvertFrom-Json }
  catch { return [pscustomobject]@{ Running = $false; Reason = "$runFile ist unlesbar" } }
  if (-not $info.port) { return [pscustomobject]@{ Running = $false; Reason = 'running.json ohne Port' } }
  if (-not (Get-Process -Id $info.pid -ErrorAction SilentlyContinue)) {
    return [pscustomobject]@{ Running = $false; Reason = "Prozess $($info.pid) laeuft nicht mehr (verwaiste running.json)" }
  }
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$($info.port)/api/v1/projects" -TimeoutSec 5 -ErrorAction Stop
    $count = (($r.Content | ConvertFrom-Json).projects).Count
    return [pscustomobject]@{ Running = $true; Port = $info.port; Projects = $count }
  } catch {
    return [pscustomobject]@{ Running = $false; Reason = "AO antwortet auf Port $($info.port) nicht: $($_.Exception.Message)" }
  }
}

# ---- Aktionen ----------------------------------------------------------------

function Invoke-Stop {
  Write-Host 'Pipeline anhalten' -ForegroundColor Cyan
  $pids = Read-Pids
  $stopped = 0
  foreach ($name in @('agency', 'bridge')) {
    $entry = $pids[$name]
    if (-not $entry) { continue }
    $p = Get-LiveProcess $entry.pid $entry.startedAt
    if (-not $p) { Write-Step "$name lief nicht mehr"; continue }
    # Zuerst die Kinder: vinext startet einen Wrangler-Workerd-Prozess.
    Get-CimInstance Win32_Process -Filter "ParentProcessId = $($p.Id)" -ErrorAction SilentlyContinue |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    Write-Ok "$name beendet (PID $($p.Id))"
    $stopped++
  }
  Write-Pids @{}
  if (Test-AgencyUp) {
    Write-Warn "Auf $AgencyUrl antwortet weiter etwas - das hat dieses Skript nicht gestartet."
  } elseif ($stopped -eq 0) {
    Write-Step 'Es lief nichts, was dieses Skript gestartet hatte.'
  }
  Write-Host 'Die AO-Desktop-App laeuft weiter (die beendest du selbst).'
}

function Show-Status {
  Write-Host 'Stand' -ForegroundColor Cyan
  $ao = Get-AoStatus
  if ($ao.Running) { Write-Ok "AO laeuft auf Port $($ao.Port), $($ao.Projects) Projekt(e) registriert" }
  else { Write-Fail "AO: $($ao.Reason)" }

  if (Test-AgencyUp) { Write-Ok "Agency antwortet auf $AgencyUrl" } else { Write-Fail "Agency antwortet auf $AgencyUrl nicht" }

  $pids = Read-Pids
  foreach ($name in @('agency', 'bridge')) {
    $entry = $pids[$name]
    $p = if ($entry) { Get-LiveProcess $entry.pid $entry.startedAt } else { $null }
    if ($p) { Write-Ok "$name laeuft (PID $($p.Id))" } else { Write-Step "${name}: von diesem Skript nicht gestartet" }
  }

  $pipelineFile = Join-Path $ProfilDir 'pipeline.json'
  if (Test-Path $pipelineFile) {
    $pipeline = Get-Content -Raw $pipelineFile | ConvertFrom-Json
    foreach ($p in $pipeline.PSObject.Properties) {
      $flags = @()
      if ($p.Value.analysieren) { $flags += 'analysieren' }
      if ($p.Value.umsetzen)    { $flags += 'umsetzen' }
      if ($p.Value.PSObject.Properties.Name -contains 'nichtMehrInAo') { $flags += "nicht mehr in AO seit $($p.Value.nichtMehrInAo)" }
      Write-Step ("{0,-20} {1}" -f $p.Name, $(if ($flags) { $flags -join ', ' } else { 'gesperrt' }))
    }
  } else {
    Write-Step 'pipeline.json gibt es noch nicht - sie entsteht beim ersten Abgleich.'
  }
}

function Start-Agency {
  if (Test-AgencyUp) { Write-Ok "Agency antwortet schon auf $AgencyUrl"; return $null }
  if (-not (Test-Path (Join-Path $AgencyPath 'package.json'))) {
    throw "Agency-Klon fehlt: $AgencyPath`n      git clone https://github.com/browser-use/agency.git `"$AgencyPath`"; cd `"$AgencyPath`"; npm ci"
  }
  if (-not (Test-Path (Join-Path $AgencyPath 'node_modules\.bin\vinext.cmd'))) {
    throw "In $AgencyPath fehlen die Abhaengigkeiten. Einmal ausfuehren: cd `"$AgencyPath`"; npm ci"
  }

  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  $out = Join-Path $RuntimeDir 'agency.log'
  $err = Join-Path $RuntimeDir 'agency.err.log'
  # WRANGLER_LOG_PATH setzt sonst npm run dev - in POSIX-Syntax, die unter
  # Windows scheitert. Deshalb hier und vinext direkt.
  $env:WRANGLER_LOG_PATH = '.wrangler/wrangler.log'
  $proc = Start-Process -FilePath (Join-Path $AgencyPath 'node_modules\.bin\vinext.cmd') `
    -ArgumentList @('dev', '--hostname', 'localhost', '--port', "$Port") `
    -WorkingDirectory $AgencyPath -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $out -RedirectStandardError $err

  Write-Step "Agency startet (PID $($proc.Id)), warte auf die API ..."
  foreach ($i in 1..60) {
    Start-Sleep -Seconds 2
    if (Test-AgencyUp) { Write-Ok "Agency antwortet auf $AgencyUrl nach $($i * 2) s"; return $proc }
    if ($proc.HasExited) { throw "Agency hat sich sofort beendet. Log: $err" }
  }
  throw "Agency antwortet nach 120 s nicht. Log: $out / $err"
}

function Invoke-Sync {
  Push-Location $BridgeDir
  try {
    $output = & node sync-projects.mjs 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Warn "Projektabgleich fehlgeschlagen: $output"; return }
    $output | ForEach-Object { Write-Step $_ }
  } finally { Pop-Location }
}

function Start-Bridge {
  $pids = Read-Pids
  if ($pids['bridge']) {
    $p = Get-LiveProcess $pids['bridge'].pid $pids['bridge'].startedAt
    if ($p) { Write-Ok "Bridge laeuft schon (PID $($p.Id))"; return $p }
  }
  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  $out = Join-Path $RuntimeDir 'bridge.log'
  $err = Join-Path $RuntimeDir 'bridge.err.log'
  $env:AGENCY_URL = $AgencyUrl
  $proc = Start-Process -FilePath 'node' -ArgumentList @('index.mjs') `
    -WorkingDirectory $BridgeDir -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $out -RedirectStandardError $err
  Start-Sleep -Seconds 2
  if ($proc.HasExited) { throw "Bridge hat sich sofort beendet. Log: $err" }
  Write-Ok "Bridge laeuft (PID $($proc.Id)), Log: $out"
  return $proc
}

# ---- Ablauf ------------------------------------------------------------------

if ($Stop)   { Invoke-Stop;  exit 0 }
if ($Status) { Show-Status;  exit 0 }

Write-Host 'Pipeline starten' -ForegroundColor Cyan

# 1. AO
$ao = Get-AoStatus
if (-not $ao.Running) {
  Write-Fail "Die Agent-Orchestrator-App laeuft nicht: $($ao.Reason)"
  Write-Host ''
  Write-Host '  Starte sie ueber das Startmenue ("Agent Orchestrator") und ruf dieses Skript dann erneut auf.'
  Write-Host '  Ohne AO gibt es keine Projekte und keinen Weg, Auftraege auszufuehren.'
  exit 1
}
Write-Ok "AO laeuft auf Port $($ao.Port), $($ao.Projects) Projekt(e) registriert"

# 2. Agency
$agencyProc = Start-Agency

# 3. Projektabgleich (danach alle 5 Minuten durch die Bridge selbst)
Invoke-Sync

# 4. Bridge
$bridgeProc = Start-Bridge

$pids = Read-Pids
if ($agencyProc) { $pids['agency'] = @{ pid = $agencyProc.Id; startedAt = (Get-Date).ToString('o') } }
if ($bridgeProc) { $pids['bridge'] = @{ pid = $bridgeProc.Id; startedAt = (Get-Date).ToString('o') } }
Write-Pids $pids

# 5. Browser
if (-not $NoBrowser) { Start-Process $AgencyUrl | Out-Null }

Write-Host ''
Write-Host "Feed: $AgencyUrl" -ForegroundColor Cyan
Write-Host "Logs: $RuntimeDir"
Write-Host 'Runner starten:  pwsh -File "' -NoNewline
Write-Host (Join-Path $PSScriptRoot 'start-runner.ps1') -NoNewline
Write-Host '" -ProjectId <id>'
Write-Host 'Anhalten:        pwsh -File "' -NoNewline
Write-Host $PSCommandPath -NoNewline
Write-Host '" -Stop'
