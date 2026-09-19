# Testlauf Agency → AO mit Polnisch (Sandbox), 2026-09-19

**Ergebnis: Der komplette Workflow lief einmal autonom durch.** Agency-Runner fand 2 Ideen → Freigabe von Karte 1 → Bridge übergab an den AO-Orchestrator → Orchestrator plante und startete genau einen Worker `ag-1` → PR #1 → Codex verlangte 3 Änderungen → Worker korrigierte → Codex gab frei → Agency-Job `done/review`, Merge-Karte liegt bereit. **Kein Merge.** Gesamtdauer Freigabe → geprüfter PR: **19 min 11 s**.

- **Sandbox:** `D:\Sandbox_Agency_AO\` — Agency `53651ce`, AO-Fork-Clone `f5a9166`, Polnisch-Clone `b616f41`; AO-Daemon isoliert (`ao daemon`, Port 3201, eigenes `AO_DATA_DIR`)
- **PR:** https://github.com/guschi18/polnisch-sandbox/pull/1 (privates Repo, offen)
- **Bridge:** `D:\agency-orchestrator-bridge\bridge\` (Node, ohne Abhängigkeiten, 31 Tests grün)

## Zeitleiste

| Zeit | Schritt | Dauer |
|---|---|---|
| 22:21 | Baseline der Originale aufgenommen | |
| 22:22 | Agency (:3100) und isolierter AO-Daemon (:3201) laufen | |
| 22:24 | Polnisch registriert, Repo `polnisch-sandbox` angelegt, Standard-Setup aktiv | |
| 22:25 | Baseline Polnisch: 228/228 Tests grün | |
| 22:29 | Bridge fertig, läuft | |
| 22:30:04 | Agency-Runner als AO-Standalone-Session gestartet | |
| 22:34:26 | Runner fertig: 2 Karten (RISE 78 und 57), bewusst keine dritte | 4 min 22 s |
| 22:35:23 | **Freigabe** Karte 1 „Gegenlese-Bogen“ → Job 1 | |
| 22:35:32 | Bridge beansprucht Job | 9 s |
| 22:35:38 | Orchestrator `polnisch-1` neu gestartet, Auftrag gesendet (2252 Zeichen) | 15 s |
| 22:36:38 | Worker `ag-1` (`polnisch-2`) erkannt | 1 min 15 s |
| 22:40:21 | PR #1 offen, 5 Dateien | 5 min |
| 22:41:46 | Codex-Review 1 startet | +1,5 min Leerlauf-Schwelle |
| 22:46:18 | Review 1: **changes_requested** (3 Befunde: Datenverlust beim Überschreiben, fehlender `--einheit`-Wert, zu breite Dateiauswahl) | 4,5 min |
| 22:48:23 | Worker pusht Korrektur | 2 min |
| 22:49:03 | **Bridge absichtlich neu gestartet** → kein zweiter Versand, kein zweiter Worker | |
| 22:51:46 | Codex-Review 2 startet | |
| 22:54:20 | Review 2: **approved**, alle 3 Threads gelöst | 2,5 min |
| 22:54:34 | Bridge: Job `done/review`, Merge-Karte gepusht | **19 min 11 s** ab Freigabe |

## Unabhängige Prüfung des PR

Frischer Clone des PR-Branches `ao/polnisch-2/gegenlese-bogen`:

- `npm test`: **243/243 grün** (228 alt + 15 neu)
- `npm run check-content`: unverändert „24 Einheiten ohne Fehler (9 Hinweise)“
- `npm run gegenlesen`: 233 Wörter + 303 Sätze = **536 Zeilen** — exakt die Zahl, die der Orchestrator vorab berechnet hatte; UTF-8-BOM, Semikolon
- zweiter Lauf überschreibt nicht; `--einheit` ohne Wert und `--einheit 30-2` brechen mit klarer Meldung ab
- CSV liegt in `.scratch/gegenlesen/`, `git status` bleibt sauber
- nur die 5 vom Orchestrator erlaubten Dateien geändert, +333/−0

## Kennzahlen

| Kennzahl | Wert |
|---|---|
| Karten je Lauf | 2 (Budget 3) |
| Zeit bis zur entscheidungsreifen Karte | 4 min 22 s |
| Zeit Freigabe → Übergabe an AO | 15 s |
| Zeit Freigabe → PR | 5 min |
| Zeit Freigabe → geprüfter PR | 19 min 11 s |
| Review-Runden | 2 (1 × changes_requested, 1 × approved) |
| Worker je Karte | 1 (Soll 1) |
| menschliche Eingriffe während der Ausführung | 0 |
| Kosten (laut AO) | Runner 2,71 $ · Orchestrator 0,57 $ · Worker 0,13 $ (GLM, vermutlich unvollständig erfasst) · Codex-Reviewer nicht ausgewiesen |

## Schwachstellen

Schwere: **H** blockiert oder gefährdet den autonomen Ablauf · **M** falsches Ergebnis oder Nacharbeit möglich · **N** Reibung

### Betrieb und Einrichtung

| # | Schwere | Befund | Beleg | Vorschlag |
|---|---|---|---|---|
| S1 | H | **`ao start` startet keinen Daemon**, sondern öffnet die Desktop-App (mit `~/.ao`). Headless/isoliert geht nur der versteckte Befehl `ao daemon` | `ao start --help`, `internal/cli/root.go:337` | Dauerbetrieb über `ao daemon` + `AO_DATA_DIR/AO_RUN_FILE/AO_PORT`; Arbeitsdokument R1 korrigiert |
| S2 | H | **`ao stop` lässt Kindprozesse weiterlaufen**: 3 Chat-Hosts (Claude Code, OpenCode), Review-PTY-Host und Codex blieben aktiv, bis sie von Hand beendet wurden | Prozessliste nach `ao stop` | Beim Stoppen die Prozessgruppe beenden; bis dahin Aufräumskript |
| S3 | H | **`git clone D:\Polnisch` setzt `origin` auf das lokale Original** → Worker hätten ins echte Repo gepusht | `git remote -v` nach Clone | Für jede Sandbox Pflichtschritt: `origin` entfernen, bevor AO das Projekt registriert |
| S4 | M | `ao-rules/` (Regeln + `apply-ao-project.ps1`) ist per `.git/info/exclude` ausgeschlossen → nicht versioniert, fehlt in jedem Clone | `.git/info/exclude:8` | `ao-rules/` einchecken |
| S5 | M | Agency: `npm run dev/build/start` nutzen POSIX-Env-Syntax → unter Windows nicht startbar | `package.json` | Start über pwsh mit `$env:WRANGLER_LOG_PATH`; dauerhaft Node-Wrapper |
| S6 | N | npm 11 blockiert Install-Skripte (`workerd`, `esbuild`, `sharp`); Dev-Server lief trotzdem | `npm install-scripts ls` | beobachten |
| S7 | N | `AO_TELEMETRY_REMOTE=0` beendet den Daemon sofort (nur `off\|posthog`), Meldung nur in stderr | `logs/ao.err.log` | – |
| S8 | N | Das Beenden des pwsh-Starters beendet den Agency-Dev-Server nicht (`workerd` bleibt) | Prozessliste | Prozessbaum beenden |

### Workflow und Qualität

| # | Schwere | Befund | Beleg | Vorschlag |
|---|---|---|---|---|
| S9 | **H** | **Niemand im Ablauf führt die Tests unabhängig aus.** Der AO-Reviewer *darf* keine Tests ausführen: sein Prompt verbietet ausdrücklich das Starten von Programmen, Tests, Builds und Skripten, weil sie den Checkout verändern oder fremden Code ausführen könnten (`internal/review/prompt.go:49`). Das Repo hat zudem keine CI (`ci: unknown`). Die Freigabe beruht also auf der Worker-Aussage plus einem rein lesenden Review | Review-Body Run 2, `internal/review/prompt.go:49` | Minimale GitHub-Action (`npm test`) je Pipeline-Projekt; Bridge verlangt dann `ci = passing` statt nur „nicht rot“ |
| S10 | M | **AO meldet einen PR sofort als „Mergeable“, bevor der Review lief** (ohne Pflicht-Checks ist GitHub-Mergeability sofort `mergeable`) | Monitor 22:40:21; `pkg/contract/kanban.go:96` | **Behoben** im Fork: Mergebarkeit wird jetzt erst nach dem Auto-Review-Zweig geprüft (`kanban.go`, Tests grün, in `FORK-CHANGES.md` dokumentiert). Die Bridge las ohnehin nur `reviews.runs[].verdict` |
| S11 | M | AO-Reviews erscheinen auf GitHub nur als `COMMENTED` (Autor = Reviewer = `guschi18`, Selbst-Approve unmöglich); `prs[].review` bleibt `none` | `gh pr view 1` | Freigabe nur aus AO-Review-Runs lesen (umgesetzt); für echte GitHub-Approvals eigener Bot-Account |
| S12 | M | Auto-Review startet erst nach **1 min Worker-Leerlauf** + Sweep-Takt; jede Runde kostet so ~1,5 min Wartezeit | `autoreview/coordinator.go:18-20` | akzeptabel; bei Bedarf `IdleThreshold` senken |
| S13 | M | **Merge-Karte zu dünn** gemessen an Agencys LAYOUT-Regel („Merge braucht Current-Head-Diff: SHA, Pfade, Summen …”) | `skills/agency/LAYOUT.md:47` | **Behoben:** Karte zeigt jetzt Head-SHA, Quell-/Zielbranch, Dateitabelle mit +/− (aus `/workspace/files`), Commits, Review-Verlauf und einen ehrlichen CI-Hinweis |
| S14 | M | Die Merge-Karte ersetzt die Ursprungskarte per Upsert (gleicher `dedupeKey`) → ursprünglicher Karteninhalt war weg | Karte 1 v2 | **Behoben:** Ursprungskarte steckt jetzt aufklappbar in der Merge-Karte. Der gleiche `dedupeKey` bleibt bewusst — ein eigener hätte die alte Karte mit ihrem „Mit AO umsetzen”-Knopf im Stapel gelassen, ein zweiter Klick hätte dieselbe Arbeit erneut gestartet. Die eingebettete Karte wird entschärft (`neutralizeCardActions`) |
| S15 | N | Orchestrator antwortet auf Englisch, obwohl Regeln und Auftrag deutsch sind; PR-Titel ohne Umlaute (Repo-Konvention) | Orchestrator-Verlauf | `orchestratorRules`: Antwortsprache Deutsch |
| S16 | N | Der Orchestrator benennt seine eigene Session um („Gegenlese-Bogen export“) — bei mehreren Aufträgen ist der Projekt-Orchestrator dann nicht mehr am Namen erkennbar | Monitor 22:37:00 | Bridge findet Orchestratoren über `kind` + `projectId` (umgesetzt), nicht über den Namen |
| S17 | N | Kostenerfassung lückenhaft: Codex-Reviewer ohne Kosten, OpenCode-Worker offenbar nur teilweise | `conversation.usage` | für Kennzahlen eigene Kostenquelle nötig |

### Agency-API (Bestätigungen)

| # | Befund |
|---|---|
| S18 | `GET /api/agent-jobs` liefert nur `queued` und abgelaufene Jobs; beanspruchte Jobs findet nur noch die Bridge-DB → `bridge.db` ist Pflicht (umgesetzt) |
| S19 | **V1 geklärt:** `POST running` mit `result` speichert Live-Text, den die Working-Karte zeigt — ohne Upsert (umgesetzt) |
| S20 | `/api/ideas/action` mit Same-Origin-Header löst eine Freigabe aus — der Fallback funktionierte, weil die Chrome-Erweiterung nicht verbunden war. Genau das darf die Bridge nie tun (R7) |

### Eigene Bridge-Fehler (vor dem Lauf durch Tests gefunden, behoben)

| # | Befund |
|---|---|
| S21 | `sent_at == 0` galt als „nicht gesendet“ |
| S22 | Blockierte Läufe ohne Versand wären nachträglich doch an AO gesendet worden |
| S23 | Duplikat-Zähler war bei 0 Treffern −1 und meldete einen falschen Befund |

## Was gut funktioniert hat

- **Kartenqualität:** Runner hat Belege aus dem Repo gezogen, Unsicherheit gekennzeichnet, bewusst nur 2 statt 3 Karten gepusht und begründet, was er nicht prüfen konnte.
- **Orchestrator-Planung:** 5 Dateien fest vorgegeben, Architektur vorgegeben, Widerspruch in der Karte (Filter vor/nach Ursprungsbestimmung) selbst aufgelöst, erwartete Zeilenzahl vorab berechnet — und sie stimmte.
- **Worker-Namenskonvention** `ag-<jobId>` wurde exakt eingehalten → Zuordnung ohne Heuristik.
- **Review-Schleife** mit echten, berechtigten Befunden; Worker hat alle 3 korrekt behoben.
- **Idempotenz:** Bridge-Neustart mitten im Lauf ohne Doppel-Dispatch.
- **Isolation:** `D:\Polnisch`, AO-Fork und `~/.ao` blieben unverändert.

## Verifikation der Isolation

Vorher/nachher-Vergleich (`D:\Sandbox_Agency_AO\logs\baseline.txt` ↔ `after.txt`):

| Prüfung | Ergebnis |
|---|---|
| `D:\Polnisch` Status + HEAD `b616f41` | unverändert |
| `D:\Tools\Agent_Orchestrator` Status + HEAD `f5a9166` | unverändert |
| `~/.ao/data/ao.db` | unverändert (17.09. 17:54, gleiche Größe) |
| `guschi18/polnisch-app` Refs und PRs | unverändert, keine PRs |
| Agency-Skill global installiert | nein |
| `guschi18/polnisch-sandbox` | privat |

## Nachträge (nach dem Lauf umgesetzt)

| Was | Ergebnis |
|---|---|
| AO-Fork: „Ready/Mergeable" erst nach dem Review (S10) | `backend/pkg/contract/kanban.go` geändert, ein Upstream-Test angepasst, drei neue Tests; `go test ./pkg/contract/... ./internal/service/session/... ./internal/autoreview/...` grün; Eintrag in `FORK-CHANGES.md`. **Wirkt erst nach einem Neubau der Desktop-App** |
| Bridge: vollständige Merge-Karte (S13, S14) | Dateitabelle, Commits, Review-Verlauf, Ursprungskarte aufklappbar; Bridge-Tests 33/33 grün; live in der Sandbox erzeugt (Karte 1 v3) und mit eingebetteter Ursprungskarte als Selbsttestkarte geprüft: genau eine Do-Aktion, alte Prompts entfernt |
| Offen | GitHub-Action mit `npm test` je Pipeline-Projekt (S9) — erst danach kann die Bridge `ci = passing` verlangen |

## Offen / nicht getestet

- Merge-Pfad der Bridge (bewusst deaktiviert, `BRIDGE_ALLOW_MERGE`).
- Blockierte Ersatzkarte im echten Lauf (nur in Tests).
- Freigabe über die echte Oberfläche (Chrome-Erweiterung war nicht verbunden; Fallback über denselben API-Aufruf).
- Karte 2 (Browser-Tests) liegt unbearbeitet in Agency.
- Aufbewahrt: Sandbox-Ordner, Repo `polnisch-sandbox` mit offenem PR #1. Löschen nur auf deine Anweisung.
