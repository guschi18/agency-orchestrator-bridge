#Requires -Version 7.2
<#
.SYNOPSIS
  Baut den Auftrag fuer einen Discovery-Lauf ueber genau ein Projekt.

.DESCRIPTION
  Ein Lauf untersucht ein Projekt, mit dessen Projektdatei und dessen
  Kartenbudget. Das Skript liest Projekt-ID, Pfad und Budget aus
  profil\ao-projects.json und profil\pipeline.json - geraten wird nichts.

  Es schreibt den Auftrag nach laufzeit\runner-<projekt>.md, legt ihn in die
  Zwischenablage und zeigt ihn an. Du startest damit eine AO-Session
  (Claude/Opus) und fuegst den Text ein.

  Bewusst ohne automatischen Spawn: ein Worker im Zielprojekt wuerde dort
  einen Branch und einen Worktree anlegen - der Runner soll aber nur lesen.
  Ein Lauf kostete im Test 2,71 $; er wird deshalb von Hand ausgeloest.

.PARAMETER ProjectId
  AO-Projekt-ID, wie sie in profil\ao-projects.json steht.

.PARAMETER MaxKarten
  Kartenbudget fuer diesen Lauf (Default: maxKarten aus pipeline.json).

.PARAMETER AgencyPath
  Agency-Klon mit dem Skill (Default: D:\Tools\Agency\agency).

.PARAMETER Port
  Port, auf dem Agency laeuft. Ohne Angabe sucht das Skript sie auf 3100 und
  3000 - eine von Hand gestartete Agency landet sonst auf 3000, und der Runner
  wuerde seine Karten an einen toten Port schicken.

.PARAMETER NoClipboard
  Den Auftrag nicht in die Zwischenablage legen.

.EXAMPLE
  pwsh -File D:\agency-orchestrator-bridge\scripts\start-runner.ps1 -ProjectId polnisch
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$ProjectId,
  [int]$MaxKarten = 0,
  [string]$AgencyPath = 'D:\Tools\Agency\agency',
  [int]$Port = 0,
  [switch]$NoClipboard
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot     = Split-Path -Parent $PSScriptRoot
$ProfilDir    = Join-Path $RepoRoot 'profil'
$RuntimeDir   = Join-Path $RepoRoot 'laufzeit'
$ProjectsFile = Join-Path $ProfilDir 'ao-projects.json'
$PipelineFile = Join-Path $ProfilDir 'pipeline.json'
$MeFile       = Join-Path $ProfilDir 'me.md'
$DocFile      = Join-Path $ProfilDir "projekte\$ProjectId.md"

function Fail($text) { Write-Host "  X   $text" -ForegroundColor Red; exit 1 }

if (-not (Test-Path $ProjectsFile)) {
  Fail "$ProjectsFile fehlt. Erst den Abgleich laufen lassen: pwsh -File `"$PSScriptRoot\start-pipeline.ps1`""
}

$mirror  = Get-Content -Raw $ProjectsFile | ConvertFrom-Json
$project = $mirror.projects | Where-Object { $_.id -eq $ProjectId }
if (-not $project) {
  Fail "AO kennt kein Projekt `"$ProjectId`". Bekannt: $(($mirror.projects.id) -join ', ')"
}
if ($project.folderMissing) { Fail "Der Ordner von `"$ProjectId`" fehlt ($($project.path))." }

$pipeline = if (Test-Path $PipelineFile) { Get-Content -Raw $PipelineFile | ConvertFrom-Json } else { $null }
$entry    = if ($pipeline) { $pipeline.PSObject.Properties[$ProjectId].Value } else { $null }
if (-not $entry -or -not $entry.analysieren) {
  Fail "`"$ProjectId`" ist nicht zur Analyse freigegeben. In $PipelineFile `"analysieren`": true setzen."
}
if ($MaxKarten -le 0) { $MaxKarten = if ($entry.maxKarten) { $entry.maxKarten } else { 3 } }

if (-not (Test-Path $MeFile))  { Fail "$MeFile fehlt." }
if (-not (Test-Path $DocFile)) { Fail "$DocFile fehlt. Der Abgleich legt eine Vorlage an - fuelle sie zuerst." }

$doc = Get-Content -Raw $DocFile
if ($doc -match '_\(eine Zeile: Was ist das Projekt') {
  Write-Host "  !   $DocFile ist noch die unausgefuellte Vorlage - die Karten werden entsprechend beliebig." -ForegroundColor Yellow
}

$skillDir = Join-Path $AgencyPath 'skills\agency'
if (-not (Test-Path (Join-Path $skillDir 'SKILL.md'))) {
  Fail "Agency-Skill nicht gefunden: $skillDir. Stimmt -AgencyPath?"
}

# Der Auftrag nennt die Agency-URL. Raet das Skript hier falsch, pusht der
# Runner seine Karten an einen toten Port und merkt es erst am Ende.
function Test-AgencyPort([int]$p) {
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:$p/api/state" -Headers @{ 'x-radar-local-agent' = '1' } `
      -TimeoutSec 3 -SkipHttpErrorCheck -ErrorAction Stop
    return $r.StatusCode -lt 500
  } catch { return $false }
}

if ($Port -gt 0) {
  if (-not (Test-AgencyPort $Port)) { Fail "Auf http://localhost:$Port antwortet keine Agency." }
} else {
  $Port = @(3100, 3000) | Where-Object { Test-AgencyPort $_ } | Select-Object -First 1
  if (-not $Port) {
    Fail "Agency laeuft nicht (weder auf 3100 noch auf 3000). Starten: pwsh -File `"$PSScriptRoot\start-pipeline.ps1`""
  }
}
$AgencyUrl = "http://localhost:$Port"
if ($Port -ne 3100) {
  Write-Host "  !   Agency laeuft auf Port $Port statt 3100. Laeuft die Bridge gegen denselben Port?" -ForegroundColor Yellow
}

$auftrag = @"
Du bist der Agency-Runner fuer einen einmaligen Discovery-Lauf ueber **ein** Projekt: ``$ProjectId``.

1. Lies diese Dateien vollstaendig und halte dich an sie:
   - $skillDir\SKILL.md
   - $skillDir\APPROVALS.md
   - $skillDir\LAYOUT.md
   - $MeFile  (gilt immer; hat Vorrang bei Sprache und Ausfuehrung)
   - $DocFile  (Ziele, Quellen und Grenzen genau dieses Projekts)
   - $ProjectsFile  (Projekt-ID und Pfad - nie raten)
   - $AgencyPath\scripts\push-card.mjs  (so werden Karten gepusht)

2. Untersuche **nur** ``$($project.path)`` und **nur lesend**: Code, Tests, die in der Projektdatei
   genannten Quellen, git log. Nichts aendern, nichts committen, keine ``.env`` lesen, keine Secrets
   in Karten schreiben.

3. Finde die wertvollsten Verbesserungen nach den Massstaeben der Projektdatei und pushe
   **hoechstens $MaxKarten Karten** an die laufende Agency unter $AgencyUrl
   (POST /api/ideas mit Header ``x-radar-local-agent: 1``, z. B.
   ``node "$AgencyPath\scripts\push-card.mjs" <meta.json>`` mit Arbeitsdateien unter
   $AgencyPath\agent-work\).
   Lieber weniger Karten als schwache - eine schwache Karte kostet dich eine echte Entscheidung.

   Jede Karte:
   - ``project`` und ``category`` = "$ProjectId"
   - stabiler ``dedupeKey`` "${ProjectId}:<thema>"
   - vollstaendiges ``rise``, ``effortSeconds`` + ``effortReason``
   - ``agentContext.ao`` = { projectId: "$ProjectId", action: "implement", route: "orchestrator",
     task: { objective, evidence[], acceptanceCriteria[], constraints[] } }, zusammen unter 2500 Zeichen
   - eine Do-Aktion "Mit AO umsetzen"
   - Karten-HTML: kein ``<a>``, ``<script>``, ``<svg>``, keine Event-Handler, keine externen Bilder.
     Links nur als ``<button data-radar-action="open" data-radar-url="...">``.

4. Pruefe nach dem Push mit GET $AgencyUrl/api/state (Header ``x-radar-local-agent: 1``),
   dass die Karten angekommen sind.

5. Antworte am Ende mit: Liste der Karten (id, dedupeKey, Titel, RISE) und was du nicht pruefen konntest.

Du setzt nichts selbst um. Die Umsetzung startet erst, wenn der Nutzer eine Karte freigibt;
dann uebergibt die Bridge sie an den AO-Orchestrator.
"@

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
$outFile = Join-Path $RuntimeDir "runner-$ProjectId.md"
$auftrag | Set-Content -Path $outFile -Encoding utf8

Write-Host "Runner-Auftrag fuer '$ProjectId'" -ForegroundColor Cyan
Write-Host "  Pfad:    $($project.path)"
Write-Host "  Budget:  $MaxKarten Karten"
Write-Host "  Ziele:   $DocFile"
Write-Host "  Auftrag: $outFile"
if (-not $NoClipboard) {
  try { Set-Clipboard -Value $auftrag; Write-Host '  In der Zwischenablage.' -ForegroundColor Green } catch { }
}
Write-Host ''
Write-Host 'So geht es weiter:' -ForegroundColor Cyan
Write-Host '  1. In der AO-App eine neue Session mit Claude/Opus oeffnen.'
Write-Host '  2. Den Auftrag einfuegen und abschicken.'
Write-Host "  3. Karten im Feed ansehen: $AgencyUrl"
Write-Host ''
Write-Host '--- Auftrag ---' -ForegroundColor DarkGray
Write-Host $auftrag
