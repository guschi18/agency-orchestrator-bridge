# Integrationsrecherche: Agency + Agent Orchestrator

**Stand:** 17. September 2026  
**Untersuchungsziel:** Prüfen, wie aus Agency und dem lokalen Fork von Agent Orchestrator eine kontrollierte Pipeline von der Ideenfindung bis zum geprüften Pull Request werden kann.  
**Lokale Quellen:** `D:\Tools\Agency` und `D:\Tools\Agent_Orchestrator`

## 1. Kurzurteil

Die Idee ist technisch sinnvoll und mit den vorhandenen Systemen umsetzbar:

> **Agency entdeckt, recherchiert und priorisiert Arbeit. Der Mensch genehmigt. AO plant, delegiert, isoliert, prüft und verfolgt die Umsetzung. Agency zeigt das Ergebnis und die nächste Entscheidung.**

Beide Systeme ergänzen sich gut, weil ihre Verantwortlichkeiten kaum überlappen:

- Agency besitzt bereits Karten, Entscheidungen, Feedback, eine lokale Job-Queue und einen Agenten-Skill für proaktive Recherche.
- AO besitzt bereits ein verbindliches Projektregister, langlebige Projekt-Orchestratoren, isolierte Worker-Worktrees, PR-/CI-Beobachtung, automatische Reviewer und abgeleitete Statuswerte.
- Der lokale AO-Fork ist bereits auf genau die gewünschte Rollenverteilung eingestellt: Claude Code/Opus als Orchestrator, OpenCode/GLM als Worker, Codex als Reviewer und `autoReview: true`.

Die Integration sollte **nicht** als tiefe Verschmelzung beider Repositories beginnen. Der kleinste tragfähige Weg ist:

1. AO bleibt die Quelle der Wahrheit für Projekte, Sessions, PRs, CI und Reviews.
2. Agency bleibt die Quelle der Wahrheit für Vorschläge, Nutzerentscheidungen und Lernfeedback.
3. Eine kleine lokale Bridge übersetzt eine freigegebene Agency-Karte in einen strukturierten Auftrag an den zuständigen AO-Orchestrator.
4. Agency speichert zunächst nur die Zuordnung ihrer Karte zu AO-Projekt, Orchestrator und Worker.
5. Merge bleibt immer eine zweite, ausdrückliche Freigabe.

Ein wichtiger Befund verändert jedoch den früheren Session-Entwurf:

> `POST /api/v1/orchestrators/delegate` delegiert nicht zuerst an den Orchestrator. Der Endpoint startet direkt einen Worker. Der Orchestrator wird danach höchstens für eine asynchrone Titelverbesserung verwendet.

Für den gewünschten Ablauf „Orchestrator plant → Worker implementiert → Reviewer prüft“ muss die Bridge daher entweder eine Nachricht an die echte Orchestrator-Session senden oder später ein neues, korrelationsfähiges AO-Task-API erhalten.

## 2. Recherchebasis und verifizierter Stand

### 2.1 Agency-Idee aus der gespeicherten Session

Die Datei [`codex-session-2026-09-16-2148-agency.md`](codex-session-2026-09-16-2148-agency.md) enthält die ursprüngliche Idee und die bisherigen Annahmen. Daraus ergibt sich folgendes Zielbild:

```text
lokale Projekte, Issues, PRs, CI und Nutzersignale
                         ↓
                 Agency recherchiert
                         ↓
              entscheidungsreife Karte
                         ↓
                 menschliche Freigabe
                         ↓
             AO-Orchestrator plant Task
                         ↓
                AO-Worker implementiert
                         ↓
                AO-Reviewer prüft
                         ↓
              PR/CI/Review zurück in Agency
                         ↓
                  separate Merge-Freigabe
                         ↓
          Ergebnis verbessert künftige Vorschläge
```

Zusätzlich soll eine zentrale Agency-Instanz mehrere lokale Projekte verwalten können, wobei AO das Projektregister liefert und in Agency pro Projekt Analyse, Priorität und Ausführung ein- oder ausgeschaltet werden können.

### 2.2 Untersuchte Agency-Version

Für die Analyse wurde das aktuelle offizielle Repository temporär ausgecheckt:

- Repository: [browser-use/agency](https://github.com/browser-use/agency)
- Commit: `53651cecb61d5b71b208504c7790c1e0e94bb3ad`
- Commit-Datum: 11. September 2026
- Paketversion: `0.1.0`, `private: true`
- GitHub-Snapshot: 76 Commits, keine Releases, 0 offene Issues und 7 offene Pull Requests zum Recherchezeitpunkt
- Technologie: React 19, TypeScript, Vinext/Vite, Drizzle ORM, lokale D1/SQLite-Datenbank

Die offizielle README beschreibt ausdrücklich, dass Agency keine eigene Hintergrund-Engine und keinen eingebauten Connector- oder Scheduler-Dienst besitzt. Eine aktive Coding-Agent-Session liest Jobs, koordiniert Arbeit und schreibt Resultate zurück. Siehe [Agency README](https://github.com/browser-use/agency/blob/main/README.md) und [Agency Skill](https://github.com/browser-use/agency/blob/main/skills/agency/SKILL.md).

### 2.3 Untersuchte AO-Version

Analysiert wurde der lokale Fork unter `D:\Tools\Agent_Orchestrator`:

- Branch: `main`
- HEAD: `f5a9166ac` vom 17. September 2026
- Origin: `guschi18/agent-orchestrator`
- Upstream: `Untrivial-ai/agent-orchestrator`
- Basis: Upstream-Nightly `v0.13.1-nightly.202609152112` plus sieben Fork-Commits
- Lizenz: Apache-2.0; siehe [offizielle Lizenz](https://github.com/Untrivial-ai/agent-orchestrator/blob/main/LICENSE)
- Arbeitsbaum war vor dieser Recherche bereits verändert; diese Änderungen wurden nicht angefasst.

Der Fork ergänzt unter anderem:

- editierbare Worker-/Orchestrator-Regeln und ein Standard-Setup,
- OpenCode-Effort-Weitergabe,
- eigenen Fork-Updater,
- frühere Orchestrator-Historien,
- Graft-Kontextgraph.

Die relevanten Fork-Regeln stehen in:

- [`../Agent_Orchestrator/ao-rules/orchestrator-rules.md`](../Agent_Orchestrator/ao-rules/orchestrator-rules.md)
- [`../Agent_Orchestrator/ao-rules/worker-rules.md`](../Agent_Orchestrator/ao-rules/worker-rules.md)
- [`../Agent_Orchestrator/frontend/src/renderer/lib/ao-standard-setup.ts`](../Agent_Orchestrator/frontend/src/renderer/lib/ao-standard-setup.ts)

Zusätzlich wurde der im Fork vorgeschriebene Graft-Kontextgraph verwendet: einmal als vollständige Repository-Karte und zweimal als quellengestützte Ablaufanalyse für (a) Projektauflistung, Orchestrator-Start, Nachrichtenversand, Worker-/PR-/CI-/Review-Beobachtung und (b) die genaue Semantik von `/orchestrators/delegate`. Die drei Abfragen meldeten zusammen rund **7.469.078 eingesparte Kontext-Tokens** beziehungsweise **5,71 US-Dollar** geschätzte Kontextkosten. Die daraus gewonnenen Pfade wurden anschließend direkt im Go- und TypeScript-Quellcode gegengeprüft.

## 3. Was Agency heute tatsächlich leistet

### 3.1 Agency ist Oberfläche, lokaler Speicher und Agentenprotokoll

Agency besteht im Kern aus drei Teilen:

1. einer visuellen Kartenoberfläche,
2. einer lokalen D1/SQLite-Datenbank,
3. einem Skill, der einen extern laufenden Coding-Agenten zu Recherche, Kartenerstellung, Freigaben und Ausführung anweist.

Agency selbst erzeugt keine Vorschläge. Der aktive Agent liest `me.md`, die Approval- und Layout-Regeln, verfügbare Quellen sowie bestehende Karten und Jobs. Er recherchiert, bereitet etwas Konkretes vor und pusht eine Karte über `POST /api/ideas`.

Wichtige Dateien im untersuchten Agency-Stand:

| Bereich | Quelle | Befund |
|---|---|---|
| Agentenverhalten | `skills/agency/SKILL.md` | Recherche, Vorbereitung, Karten, Recheck vor Aktion |
| Freigaben | `skills/agency/APPROVALS.md` | externe Aktionen und Merge benötigen abgegrenzte Freigaben |
| Persistenz | `db/schema.ts` | Karten, Feedback, Agent-Jobs, Aufmerksamkeit und Interaktionen |
| Karten-Ingest | `app/api/ideas/route.ts` | Upsert über stabilen `dedupeKey`, HTML-Validierung, RISE-Wertung |
| Entscheidung | `app/api/ideas/action/route.ts` | Klick erzeugt einen `agent_jobs`-Eintrag und setzt die Karte auf Working |
| Queue | `app/api/agent-jobs/route.ts` | Jobs lesen, claimen/erneuern und terminal abschließen |
| Statussicht | `app/api/state/route.ts` | New/Working/Done plus aktueller Job und Ergebnis |
| freie Aufgabe | `app/api/tasks/route.ts` | erzeugt eine neue Working-Karte und einen Queue-Job |

### 3.2 Das aktuelle Statusmodell

Agency besitzt zwei miteinander gekoppelte Statusmodelle:

**Kartenstatus**

- `new`
- `working`
- `done`
- intern zusätzlich `rejected`

**Jobstatus**

- `queued`
- `running`
- `done`
- `failed`

**Job-Ergebnis**

- `completed`: versprochenes Ergebnis ist verifiziert; Karte wird Done
- `review`: vorbereitete Arbeit braucht eine weitere Entscheidung; Karte wird New
- `blocked`: präziser Blocker; Karte wird New

Ein laufender Job besitzt eine Lease von sechs Stunden. Es gibt maximal zehn gleichzeitig sichtbare Jobs. Ein erneutes `running`-Update erneuert die Lease. Es existiert jedoch **kein exklusiver Claim-Token**; der Agency-Skill verlangt deshalb genau einen Koordinator.

### 3.3 Was Agency für die gewünschte Pipeline noch fehlt

Das Feld `ideas.project` ist nur ein freier Textwert. Agency besitzt derzeit:

- keine Projekt-Tabelle,
- keine Repository-Pfade oder AO-Projekt-IDs,
- keinen Projekt-Selector,
- keine Beziehung zwischen Karte und externer Ausführung,
- keine AO-Session-/Worker-Zuordnung,
- keine eingebaute Statussynchronisation,
- keinen dauerhaften Hintergrundprozess.

Die Kartenansicht filtert nach Status und Topics, nicht nach einem formellen Projektobjekt. Eine zentrale Agency für mehrere Projekte ist damit möglich, aber heute nur über Agentenanweisungen und das freie `project`-Feld, nicht über eine belastbare Konfiguration.

### 3.4 Sicherheitsmodell von Agency

Agency ist bewusst eine vertrauenswürdige lokale Single-User-App:

- unauthentifizierte lokale Routen,
- Betrieb ausschließlich auf Loopback,
- kein öffentlicher Tunnel,
- Karteninhalte nur aus vertrauenswürdigen Agentenquellen,
- restriktive HTML-Prüfung ohne Scripts, Eventhandler, Forms, Iframes, Remote-Medien oder normale Links,
- Agentenaufrufe benötigen bei fehlendem Same-Origin-Kontext einen lokalen Header oder optionalen Agent-Key.

Dieses Modell passt zu AO, aber nur solange beide Dienste strikt lokal bleiben.

## 4. Was der lokale Agent Orchestrator bereits leistet

### 4.1 Architektur und Verantwortungsgrenzen

AO besteht aus:

- einem langlebigen Go-Daemon,
- einem dünnen Cobra-CLI-Client,
- einer Electron/React-Oberfläche,
- SQLite-Persistenz,
- Session-, Workspace-, Runtime-, SCM- und Review-Services.

Der Daemon bindet nur an `127.0.0.1`; der Standardport ist `3001`. Ist dieser belegt, kann AO auf einen ephemeren Port ausweichen und schreibt den tatsächlichen Port in `~/.ao/running.json`. Die REST-API ist auf Loopback ohne Authentifizierung erreichbar. CORS akzeptiert lokale Browser-Ursprünge. Das CLI liest `running.json`, prüft den Prozess und spricht anschließend HTTP mit dem Daemon.

Quellen:

- [`../Agent_Orchestrator/backend/internal/config/config.go`](../Agent_Orchestrator/backend/internal/config/config.go)
- [`../Agent_Orchestrator/backend/internal/httpd/server.go`](../Agent_Orchestrator/backend/internal/httpd/server.go)
- [`../Agent_Orchestrator/backend/internal/cli/client.go`](../Agent_Orchestrator/backend/internal/cli/client.go)
- [`../Agent_Orchestrator/docs/architecture.md`](../Agent_Orchestrator/docs/architecture.md)

### 4.2 AO ist bereits das richtige Projektregister

`GET /api/v1/projects` liefert je Projekt unter anderem:

- stabile Projekt-ID,
- Anzeigename,
- lokalen Pfad,
- Projekttyp,
- Session-Präfix,
- konfigurierten Orchestrator-Agenten,
- `folderMissing` und gegebenenfalls Auflösungsfehler.

`GET /api/v1/projects/{id}` liefert zusätzlich Repository, Default-Branch, vollständige Projektkonfiguration und Workspace-Unterrepos.

Damit sollte Agency keine zweite Repository-Wahrheit pflegen. Es genügt, die AO-Projekt-ID und Agency-spezifische Einstellungen wie `enabled`, Priorität und Analysebudget zu speichern.

Wichtig: `ao project ls --json` verwendet aktuell eine handgeschriebene CLI-Projektion, die Pfad und einige neuere Felder verwirft. Für den Projekt-Selector ist daher die direkte AO-HTTP-Antwort besser als die CLI-Ausgabe.

### 4.3 Orchestrator, Worker und Reviewer sind bereits getrennt

AO setzt die gewünschte Rollenteilung bereits systemisch um:

- Der Projekt-Orchestrator plant und koordiniert, darf standardmäßig keinen Code ändern und startet Worker über `ao spawn`.
- Ein Worker besitzt eine fokussierte Aufgabe, einen isolierten Worktree, Branch, Agent, Modell und eigene Session.
- Der SCM-Observer verfolgt PR, CI, Review, Mergeability und Kommentare.
- Reviewer werden auf Worker-PRs ausgeführt; Ergebnisse können automatisch an den Worker zurückgegeben werden.
- Displaystatus wird nicht gespeichert, sondern aus Session-, Aktivitäts-, PR-, CI- und Review-Fakten abgeleitet.

Der lokale Fork setzt standardmäßig:

| Rolle | Harness/Modell | Relevante Regel |
|---|---|---|
| Orchestrator | Claude Code / `claude-opus-5` | Architektur entscheiden, fokussierte Worker-Aufträge formulieren |
| Worker | OpenCode / `opencode-go/glm-5.3-flash`, Effort `high` | nur Scope umsetzen, testen, PR öffnen |
| Reviewer | Codex / `gpt-5.4`, Effort `xhigh` | automatischer Review |
| Projekt | `autoReview: true` | Review startet nach PR-Zuordnung |

### 4.4 Relevante AO-Schnittstellen

| Aufgabe | HTTP | CLI |
|---|---|---|
| Projekte lesen | `GET /api/v1/projects` | `ao project ls --json` |
| Projektdetails | `GET /api/v1/projects/{id}` | `ao project get <id> --json` |
| Orchestratoren lesen | `GET /api/v1/orchestrators` | `ao orchestrator ls --json` |
| Orchestrator starten | `POST /api/v1/orchestrators` | `ao spawn --kind orchestrator --project <id> --name <name>` |
| Nachricht senden | `POST /api/v1/sessions/{id}/send` | `ao send --session <id> --message <text>` |
| Worker direkt starten | `POST /api/v1/sessions` | `ao spawn --project <id> --name <name> --prompt <text>` |
| Direktdelegation | `POST /api/v1/orchestrators/delegate` | kein gleichwertiger eigener CLI-Befehl |
| Sessions lesen | `GET /api/v1/sessions?project=<id>` | `ao session ls --project <id> --json` |
| Sessiondetail | `GET /api/v1/sessions/{id}` | `ao session get <id> --json` |
| PR-Detail | `GET /api/v1/sessions/{id}/pr` | teilweise über `ao session ls/get` |
| Reviews | Review-Routen unter `/api/v1/reviews` | `ao review ls/trigger/cancel/submit` |
| Merge | PR-Routen | `ao pr merge` |

Die frühere Session enthielt bei zwei Befehlen eine falsche Syntax. Korrekt ist:

```powershell
ao project add --path D:\Projects\mein-projekt
ao send --session <orchestrator-session-id> --message "<auftrag>"
```

Nicht korrekt sind `ao project add <path>` und `ao send <id> <text>`.

## 5. Der wichtigste Integrationsbefund

### 5.1 Warum `/orchestrators/delegate` nicht die Kernidee erfüllt

Der Name ist missverständlich. Der Service `DelegateTask` in
`backend/internal/service/session/delegation.go` führt folgenden Ablauf aus:

1. Projekt und Agentenkonfiguration validieren.
2. **Direkt einen Worker spawnen.**
3. `workerId` sofort zurückgeben.
4. Im Hintergrund einen Orchestrator finden, wiederaufnehmen oder starten.
5. Diesen Orchestrator ausschließlich bitten, den bereits gestarteten Worker umzubenennen.

Das ist hervorragend für eine robuste direkte Task-Erstellung, denn die Response enthält sofort eine stabile `workerId`. Es umgeht aber die gewünschte Planungs- und Zerlegungsrolle des Orchestrators.

### 5.2 Drei technisch mögliche Übergabewege

| Weg | Vorteil | Nachteil | Eignung |
|---|---|---|---|
| `/orchestrators/delegate` | sofortige `workerId`, einfache Zuordnung, vorhandenes UI nutzt ihn | Orchestrator plant und überwacht die Aufgabe nicht | schneller technischer Pilot |
| Nachricht an Orchestrator | erfüllt das gewünschte Rollenmodell | Antwort enthält keine Task-/Worker-Korrelation | fachlich richtiger MVP mit begrenzter Heuristik |
| neues korrelationsfähiges AO-Task-API | sauber, dauerhaft, mehrere Worker möglich | AO-Backend, Persistenz, OpenAPI und Tests müssen erweitert werden | spätere robuste Vollintegration |

### 5.3 Empfehlung

Der erste Nutzenbeweis sollte über eine echte Orchestrator-Nachricht erfolgen, aber bewusst auf **genau einen Worker pro Agency-Karte** begrenzt werden. Der Orchestrator erhält die Pflicht, den Worker mit einem deterministischen Namen wie `ag-<cardId>` zu starten. Die Bridge kann ihn anschließend über die rohe Session-API erkennen.

Diese Heuristik hat eine klare Obergrenze: Sie ist für einen Worker pro Karte ausreichend, aber nicht für mehrteilige Pläne und parallele Worker. Sobald echte Multi-Worker-Aufträge benötigt werden, sollte AO eine dauerhafte externe Task-/Korrelations-ID erhalten.

## 6. Empfohlene Zielarchitektur

```text
┌──────────────────────── Agency ────────────────────────┐
│ me.md / Dream / Projektpräferenzen                     │
│ Agent recherchiert → Karte → Freigabe                  │
│ Agency DB: idea + job + AO-Zuordnung                   │
└──────────────────────────┬─────────────────────────────┘
                           │ localhost, expliziter Auftrag
                    ┌──────▼──────┐
                    │ AO Bridge   │
                    │ - Projekte  │
                    │ - Dedupe    │
                    │ - Dispatch  │
                    │ - Polling   │
                    └──────┬──────┘
                           │ AO-HTTP auf 127.0.0.1
┌──────────────────────────▼─────────────────────────────┐
│ Agent Orchestrator                                    │
│ Projektregister → Projekt-Orchestrator → Worker        │
│                  → PR/CI → Reviewer → Status           │
└──────────────────────────┬─────────────────────────────┘
                           │ Status/PR/Review
                    ┌──────▼──────┐
                    │ AO Bridge   │
                    └──────┬──────┘
                           │ Kartenstatus / Ergebnis
┌──────────────────────────▼─────────────────────────────┐
│ Agency: geprüfter PR + separate Merge-Entscheidung     │
└────────────────────────────────────────────────────────┘
```

### 6.1 Klare Eigentümerschaft

| Information | Autoritative Quelle |
|---|---|
| Projekt-ID, Pfad, Repository, Default-Branch | AO |
| aktiver Orchestrator | AO |
| Worker, Worktree, Branch | AO |
| PR, CI, Review, Mergeability | AO |
| Vorschlag, Belege, Nutzen, RISE, Nutzereffort | Agency |
| Freigabe zur Umsetzung | Agency |
| Freigabe zum Merge | Agency, anschließend durch AO ausgeführt |
| Lernfeedback aus Annahme/Ablehnung | Agency |
| Zuordnung Agency-Karte ↔ AO-Ausführung | Bridge/Agency |

Agency sollte weder AO-Status selbst herleiten noch Repository-Pfade aus Karten vertrauen. AO sollte weder die Kartenpriorisierung noch das persönliche Lernprofil übernehmen.

### 6.2 Kompakter Task-Vertrag

Der an AO gesendete Auftrag sollte strukturiert, aber unter AOs Nachrichtenlimit von 4096 Zeichen bleiben:

```yaml
source: agency
sourceCardId: 123
dedupeKey: biomined-auth-expired-token
aoProjectId: biomined
objective: Behebe den Fehler beim Aktualisieren abgelaufener Tokens.
evidence:
  - Reproduktion in tests/auth/refresh.test.ts
acceptanceCriteria:
  - Reproduktionstest schlägt vor dem Fix fehl
  - Fix hält bestehende Tests grün
  - Worker öffnet einen PR
constraints:
  - keine Änderung des Login-Flows
  - kein automatischer Merge
approvalScope:
  localChanges: true
  pushAndPullRequest: true
  merge: false
workflow:
  workerName: ag-123
  workers: 1
  reviewer: project-default
```

Der Prompt an den Orchestrator muss außerdem ausdrücklich sagen:

- zunächst aktuelle Sessions prüfen und keine Doppelarbeit erzeugen,
- genau einen Worker mit `--name ag-123` starten,
- Architekturentscheidungen selbst treffen,
- den Worker fokussiert anweisen,
- Review- und CI-Probleme an denselben Worker zurückgeben,
- nicht mergen,
- Agency-ID und `dedupeKey` in der Worker-Anweisung erhalten.

### 6.3 Minimales Datenmodell in Agency

Für den ersten zuverlässigen Stand reichen zwei kleine Tabellen.

**`ao_projects`**

| Feld | Zweck |
|---|---|
| `ao_project_id` | stabile externe Projekt-ID, Primary Key |
| `enabled` | soll Agency dieses Projekt untersuchen? |
| `priority` | einfache Reihenfolge, z. B. 0–100 |
| `max_suggestions` | Limit je Recherchewelle |
| `scan_areas` | kleine JSON-Liste, z. B. Issues/PR/CI/Tests |
| `allow_dispatch` | darf „Mit AO umsetzen“ angeboten werden? |
| `updated_at` | Konfigurationsstand |

Name und Pfad müssen nicht dupliziert werden; sie kommen live aus AO.

**`ao_runs`**

| Feld | Zweck |
|---|---|
| `idea_id` | genau eine aktive Ausführung je Agency-Karte |
| `job_id` | zugehöriger Agency-Job |
| `dedupe_key` | Schutz gegen Doppelklick/Retry |
| `ao_project_id` | AO-Zielprojekt |
| `orchestrator_session_id` | adressierter Orchestrator |
| `worker_session_id` | im Ein-Worker-MVP erkannter Worker |
| `state` | `dispatching`, `running`, `blocked`, `review`, `ready`, `completed`, `failed` |
| `last_ao_status` | letzter AO-Rohstatus für Diagnose |
| `dispatched_at`, `last_synced_at` | Betrieb und Stale-Erkennung |
| `error` | begrenzte, nicht geheime Fehlermeldung |

Eine separate Join-Tabelle für mehrere Worker ist bewusst nicht Teil des MVP. Sie wird erst nötig, wenn ein Agency-Vorschlag tatsächlich mehrere parallele Worker verwenden soll.

### 6.4 Projekt-Selector

Agency sollte die Projektliste live aus `GET /api/v1/projects` lesen und nur die Agency-spezifischen Schalter lokal speichern:

| Projekt | Agency analysiert | Priorität | Max. Vorschläge | AO-Ausführung |
|---|---:|---:|---:|---:|
| Biomined | ✓ | 90 | 5 | ✓ |
| Trading Tools | ✓ | 60 | 3 | ✓ |
| Old Dashboard | – | 0 | 0 | – |

Sinnvolle erste Felder:

- aktiv/pausiert,
- Priorität,
- maximales Vorschlagsbudget,
- Analysebereiche,
- AO-Ausführung erlaubt/verboten.

Eigene Zeitpläne, Branch-Regeln und Agent-/Modell-Auswahl pro Projekt sollten zunächst **nicht** in Agency dupliziert werden. Diese Informationen existieren bereits in AO-Projektkonfiguration und Runner-Scheduler.

### 6.5 Dispatch-Ablauf

1. Der Nutzer klickt auf eine klar beschriftete Aktion „Mit AO umsetzen“.
2. Agency erzeugt wie bisher einen Job und setzt die Karte auf Working.
3. Der Bridge-Koordinator claimt den Job.
4. Er prüft live:
   - Karte und Version sind aktuell,
   - AO-Projekt ist aktiviert und vorhanden,
   - Projektordner fehlt nicht,
   - es existiert keine `ao_runs`-Zeile für denselben `idea_id`/`dedupeKey`,
   - AO-Daemon ist erreichbar.
5. Er findet den neuesten nicht terminierten Orchestrator für das Projekt.
6. Falls keiner existiert, startet er einen über `POST /api/v1/orchestrators`.
7. Er schreibt zuerst eine `dispatching`-Zuordnung und sendet dann den kompakten Auftrag an `/sessions/{orchestratorId}/send`.
8. Er pollt die rohe Session-API und erkennt den Worker `ag-<cardId>`.
9. Er aktualisiert `ao_runs` und erneuert die Agency-Job-Lease.
10. Er übernimmt AOs Status, PR-, CI- und Review-Fakten in eine kleine Live-Anzeige der Working-Karte.
11. Bei geprüftem Ergebnis ersetzt er die Karte durch den tatsächlichen PR-/Review-Stand und beendet den Job mit `done/review`.
12. Agency zeigt die separate Entscheidung „Merge“.

### 6.6 Statusabbildung

Agency sollte AOs bereits abgeleitete Zustände nicht neu berechnen. Eine schlanke Abbildung genügt:

| AO | Agency-Ausführung | Agency-Verhalten |
|---|---|---|
| `working`, `idle`, `pr_open`, `draft`, `review_pending` | `running`/`review` | Working, Status live anzeigen |
| `needs_input`, `no_signal` | `blocked` | Working mit „In AO öffnen“; nicht als erledigt markieren |
| `ci_failed`, `changes_requested` | `running` | Worker-/Review-Schleife weiterlaufen lassen |
| `approved`, `mergeable` bei aktuellem Head | `ready` | Karte als neue Merge-Entscheidung präsentieren |
| `merged` | `completed` | Agency-Job `done/completed` |
| `terminated` ohne Ergebnis | `failed` | präzisen Blocker zeigen |

`approved` allein reicht nicht automatisch zum Merge. Vor der Merge-Aktion müssen aktueller Head, CI, offene Review-Threads und Mergeability erneut live geprüft werden.

### 6.7 Polling statt Event-Infrastruktur im MVP

AO besitzt CDC/SSE, aber Agency besitzt noch keinen langlebigen internen Worker. Für den MVP ist ein einzelner lokaler Poller einfacher und ausreichend:

- während aktiver Runs alle 15–30 Sekunden,
- ohne aktive Runs deutlich seltener oder gar nicht,
- Agency-Lease spätestens vor sechs Stunden erneuern,
- exponentielles Backoff bei nicht erreichbarem AO,
- kein paralleler zweiter Bridge-Prozess.

SSE lohnt sich erst, wenn Polling messbar zum Problem wird oder die Bridge ohnehin als dauerhafter Dienst betrieben wird.

## 7. Sicherheits-, Freigabe- und Zuverlässigkeitsregeln

### 7.1 Merge bleibt getrennt

„Mit AO umsetzen“ darf Folgendes autorisieren:

- lokale Änderungen im isolierten Worker-Worktree,
- Tests,
- Commit und Push,
- PR-Erstellung, wenn dies auf der Karte klar genannt ist,
- automatische Reviewer.

Es darf **nicht** automatisch den Merge autorisieren. Das entspricht sowohl den Agency-Approval-Regeln als auch den lokalen AO-Orchestrator-Regeln.

### 7.2 AO-Projekt-ID statt freiem Pfad

Die Dispatch-API darf keinen beliebigen Repository-Pfad aus Karten-HTML oder Agententext übernehmen. Sie akzeptiert ausschließlich eine in Agency aktivierte AO-Projekt-ID und löst den Pfad live über AO auf.

### 7.3 Idempotenz

Agency hat bereits einen eindeutigen `dedupeKey`, aber dieser dedupliziert Karten, nicht externe AO-Sessions. Deshalb braucht die Bridge zusätzlich eine eindeutige Zuordnung auf `idea_id` oder `(idea_id, job_id)`.

Regel:

> Ein Retry darf einen bestehenden Dispatch fortsetzen, aber niemals still einen zweiten Worker erzeugen.

Die Reihenfolge „Zuordnung auf `dispatching` schreiben → Mutation an AO senden“ verhindert den häufigsten Doppelklick-/Crash-Fall. Ein unklarer Ausgang wird anschließend durch AO-Lesezugriffe aufgeklärt, nicht durch blindes Wiederholen.

### 7.4 Prompt-Injection und Vertrauensgrenzen

Recherchematerial aus Issues, PRs, E-Mails oder Webseiten ist Datenmaterial, keine Anweisung. Der Task-Vertrag muss klar zwischen `objective`, `evidence`, `constraints` und `approvalScope` trennen. Inhalte aus Belegen dürfen weder Projektwahl noch Merge-Berechtigung oder externe Aktionen erweitern.

### 7.5 Loopback erzwingen

Die Bridge darf nur `http://127.0.0.1:<port>` oder `http://localhost:<port>` akzeptieren. Kein `0.0.0.0`, kein Tunnel, kein beliebiger `AO_URL`-Host. Beide Anwendungen besitzen auf Loopback bewusst keine normale Benutzerauthentifizierung.

### 7.6 Keine Geheimnisse in Karten oder Mapping

Agency-Karten, `agentContext`, Jobresultate und `ao_runs.error` dürfen keine Tokens, Cookies oder vollständigen privaten Threads enthalten. Zugangsdaten bleiben in den jeweiligen Runner-/AO-/GitHub-Credential-Stores.

## 8. Empfohlene Umsetzungsphasen

### Phase 0 — Lizenz und Betriebsbasis klären

Vor einem veröffentlichten oder gemeinsam verteilten Agency-Fork muss die Lizenz geklärt werden. Im untersuchten Agency-Commit ist keine `LICENSE`-/`COPYING`-Datei vorhanden und GitHub zeigt keine Lizenz an. GitHubs Nutzungsbedingungen erlauben das Anzeigen und Forken über die Plattform, ersetzen aber keine ausdrückliche Open-Source-Lizenz für beliebige Weiterverteilung oder ein abgeleitetes Produkt. Siehe [GitHub Terms, License Grant to Other Users](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#5-license-grant-to-other-users).

Praktische Konsequenz, keine Rechtsberatung:

- lokalen privaten Prototyp getrennt halten,
- keine öffentliche Agency-Derivatveröffentlichung, bevor Browser Use die Lizenz bestätigt oder ergänzt,
- alternativ die allgemeine Idee mit eigener Oberfläche/Bridge neu implementieren und keinen Agency-Code übernehmen.

Außerdem:

- AO-Desktop-App muss laufen,
- aktueller Daemon-Port muss bekannt sein,
- Projekte müssen in AO registriert und mit Standard-Setup versehen sein,
- Agency muss strikt lokal laufen.

### Phase 1 — Ein-Projekt-Nutzenbeweis ohne neue Architektur

Ziel: Validieren, ob die Vorschläge gut genug sind und der Freigabeprozess echten Nutzen bringt.

- genau ein aktives AO-Projekt,
- Quellen nur Code, Issues, offene PRs, CI und Tests,
- höchstens drei bis fünf fundierte Vorschläge pro Lauf,
- Kartenaktion „Mit AO umsetzen“,
- aktiver Agency-Koordinator sendet den strukturierten Auftrag an den vorhandenen AO-Orchestrator,
- genau ein Worker `ag-<cardId>`,
- vorhandener automatischer Reviewer,
- kein automatischer Merge,
- Statusprüfung zunächst über AO selbst und manuelle Rückmeldung an Agency.

Für diesen Pilot ist noch kein Projekt-Selector und keine neue AO-API nötig. Er prüft den riskantesten Teil: Qualität und Nutzen der automatisch gefundenen Arbeit.

**Abbruchkriterium:** Wenn die meisten Vorschläge abgelehnt, doppelt oder zu vage sind, lohnt sich die technische Vollintegration noch nicht. Dann zuerst Quellen, `me.md`, Projektziele und Kartenscope verbessern.

### Phase 2 — Kleine lokale Bridge

Ziel: Doppelte Dispatches verhindern und Status automatisch zurückführen.

Minimaler Umfang:

- `lib/ao-client.ts` oder ein kleines Node-Bridge-Skript nur mit Standardbibliothek,
- AO-Port aus `~/.ao/running.json` lesen oder einen expliziten Loopback-`AO_URL` verwenden,
- Jobtyp anhand strukturierten `agentContext` erkennen,
- `ao_runs` speichern,
- Orchestrator finden/starten und Nachricht senden,
- Worker `ag-<cardId>` erkennen,
- Session-/PR-Status pollen,
- Agency-Job heartbeat und terminalen Ausgang setzen,
- genau ein kleiner ausführbarer Test für Dedupe/Statusabbildung.

Noch nicht bauen:

- Multi-Worker-Graph,
- Message-Bus,
- Webhooks,
- eigene Workflow-Engine,
- eigene CI-/Review-Auswertung,
- Cloud-Bridge.

### Phase 3 — Projekt-Selector in Agency

Ziel: Mehrere lokale Projekte kontrolliert aktivieren.

Voraussichtlich betroffene Agency-Dateien:

- `db/schema.ts` plus neue Drizzle-Migration für `ao_projects` und `ao_runs`,
- neue API-Routen unter `app/api/ao/`,
- `app/settings/page.tsx` für die Projektauswahl,
- `app/agency.tsx` für Projektfilter und AO-Live-Status,
- `skills/agency/SKILL.md` für Auswahl-, Dispatch- und Rückflussregeln,
- `skills/agency/APPROVALS.md` für PR- und Merge-Scope.

Der Selector synchronisiert die Projektliste aus AO. Entfernte oder fehlende Projekte werden als nicht verfügbar markiert; sie werden nicht automatisch aus Agency gelöscht.

### Phase 4 — Robustes AO-Task-API für Multi-Worker

Erst wenn Agency-Aufträge regelmäßig in mehrere Worker zerlegt werden sollen, lohnt sich eine AO-Änderung.

Empfohlen ist ein neuer Vertrag statt einer semantischen Änderung des bestehenden `/orchestrators/delegate`:

```http
POST /api/v1/orchestrators/{orchestratorId}/tasks
```

Beispielrequest:

```json
{
  "source": "agency",
  "externalId": "idea-123",
  "dedupeKey": "biomined-auth-expired-token",
  "projectId": "biomined",
  "brief": "...",
  "approvalScope": {
    "pushAndPullRequest": true,
    "merge": false
  }
}
```

Beispielresponse:

```json
{
  "taskId": "aotask-456",
  "orchestratorId": "bio-1",
  "status": "accepted"
}
```

AO müsste anschließend Worker-Sessions explizit mit `taskId`/Parent-Task verknüpfen. Dadurch könnte Agency ohne Namensheuristik alle Kinder eines Auftrags lesen. Diese Erweiterung betrifft mindestens Domain, Storage-Migration/Queries, Service, Controller/DTO, OpenAPI-Generierung, Frontend-Typen und Tests. Sie ist für den Ein-Worker-MVP nicht gerechtfertigt.

## 9. Praktische Befunde aus Build und Tests

### 9.1 Agency unter Windows

Umgebung:

- Node `v24.20.0`
- npm `11.19.0`
- Git `2.53.0.windows.2`

Ergebnisse am unveränderten Agency-Commit:

| Check | Ergebnis |
|---|---|
| `npm ci` | erfolgreich |
| `npm run lint` | erfolgreich mit einer `react-hooks/exhaustive-deps`-Warnung in `app/agency.tsx:665` |
| `npm run build` | unter Windows fehlgeschlagen, weil das Script POSIX-Syntax `WRANGLER_LOG_PATH=...` verwendet |
| direkter Vinext-Build mit gesetzter PowerShell-Umgebung | erfolgreich, alle App- und API-Routen gebaut |
| `npm audit` | 23 bekannte Findings: 1 niedrig, 6 mittel, 16 hoch, 0 kritisch |

Die hohen Findings liegen überwiegend in Build-/Dev-Abhängigkeiten wie Cloudflare Vite Plugin, Miniflare, Wrangler, Vite/Vinext und deren transitiven Paketen. Trotzdem sollte der Lockfile-Stand vor produktiverem Einsatz aktualisiert und erneut geprüft werden. Der Loopback-only-Betrieb bleibt bis dahin zwingend.

Der Windows-Build braucht eine kleine Scriptkorrektur oder ein plattformneutrales Node-Wrapper-Skript. Das ist kein Quellcode-Buildfehler: der direkt gestartete Vinext-Build war grün.

### 9.2 AO-relevante Tests

Ausgeführt wurden:

```text
go test ./internal/cli ./internal/httpd/controllers ./internal/service/session
```

Ergebnis:

- `internal/service/session`: grün; dies umfasst auch den relevanten Delegation-Service.
- `internal/cli`: rot wegen eines Windows-Temp-Pfad-Zugriffs und eines Fork-Drift-Tests, der `ao session history` noch als Systemkommando klassifiziert.
- `internal/httpd/controllers`: rot wegen bekannter Windows-/Temp-/Pfadfälle, darunter Clone- und Preview-Tests.

Das passt zur vorhandenen Fork-Dokumentation, wonach die vollständige Suite unter Windows bereits auf unverändertem Upstream nicht vollständig grün ist. Für eine spätere Integration müssen dennoch gezielte neue Tests für Dispatch, Dedupe, Projektauflösung und Statusrückfluss grün sein.

### 9.3 Aktueller Laufzeitstand dieser Recherche

- `~/.ao/running.json` war nicht vorhanden; der AO-Daemon lief während der Prüfung nicht.
- `ao` war im aktuellen Node-24-PATH nicht verfügbar.
- Der Fork dokumentiert selbst, dass AO-Builds Node 22 brauchen, während globale `opencode`-/`codex`-Pakete auf diesem Rechner unter Node 24 liegen.

Die Bridge darf daher einen fehlenden Daemon oder ein fehlendes CLI nicht als fachlichen Taskfehler behandeln. Sie sollte einen klaren Blocker „AO Desktop starten“ anzeigen und den Agency-Job nicht doppelt dispatchen.

## 10. Risiken und Gegenmaßnahmen

| Risiko | Wirkung | Gegenmaßnahme |
|---|---|---|
| Agency ohne klare Lizenz | Veröffentlichung eines Forks rechtlich unklar | Lizenz vor öffentlicher/kommerzieller Nutzung klären; Prototyp getrennt halten |
| `/orchestrators/delegate` falsch interpretiert | Orchestrator plant nicht | echten Orchestrator per `/sessions/{id}/send` adressieren |
| fehlende Worker-Korrelation | Status kann falscher Session zugeordnet werden | Ein-Worker-MVP mit deterministischem Namen; später Task-ID im AO-Domainmodell |
| Doppelklick/Crash beim Dispatch | doppelte Worker/PRs | eindeutige `ao_runs`-Zuordnung vor AO-Mutation |
| AO-Port weicht von 3001 ab | Bridge wirkt offline | `running.json` lesen oder validierten expliziten Loopback-Port konfigurieren |
| Agency-Job-Lease läuft ab | zweiter Koordinator übernimmt | Heartbeat und genau ein Bridge-Prozess |
| Orchestrator wird nicht automatisch benachrichtigt | Fortschritt bleibt liegen | Bridge pollt AO-Fakten; nicht auf Agentenversprechen verlassen |
| freies Projektfeld | falsches Repository | nur aktivierte AO-Projekt-ID akzeptieren |
| automatische Merge-Ausweitung | unerwünschte Veröffentlichung | getrennte Merge-Karte und Live-Recheck |
| Agency-Abhängigkeitsstand | lokale Dev-Server-Risiken | Lockfile aktualisieren, Audit wiederholen, Loopback beibehalten |
| Windows-Scriptinkompatibilität | Setup schlägt trotz baubarem Code fehl | plattformneutrales Node-Skript statt Shell-Env-Zuweisung |
| zu frühe Vollautomatisierung | viel Technik vor Nutzenbeweis | zuerst Ein-Projekt-Pilot mit wenigen Vorschlägen |

## 11. Konkrete Entscheidungsempfehlung

### Jetzt tun

1. Lizenzstatus von Agency bei Browser Use klären.
2. Agency lokal als getrennten Prototyp aufsetzen; keine tiefe Änderung am AO-Fork.
3. Ein einziges bereits in AO konfiguriertes Projekt wählen.
4. Agency auf höchstens fünf gut recherchierte Coding-Vorschläge pro Lauf begrenzen.
5. Karten mit einem strukturierten `agentContext` und der Aktion „Mit AO umsetzen“ erzeugen.
6. Die Aktion zunächst an den echten Projekt-Orchestrator senden; genau einen Worker und keinen automatischen Merge verlangen.
7. Nach wenigen realen Durchläufen messen:
   - Annahmequote,
   - Duplikatquote,
   - Zeit bis zum entscheidungsreifen Vorschlag,
   - Zeit bis zum geprüften PR,
   - Anteil blockierter/fehlgeleiteter Worker,
   - menschlicher Reviewaufwand.

### Danach nur bei positivem Nutzennachweis

8. Kleine Bridge mit Idempotenz und Statuspolling bauen.
9. Projekt-Selector aus dem AO-Projektregister ergänzen.
10. Erst bei echtem Multi-Worker-Bedarf das korrelationsfähige AO-Task-API entwickeln.

## 12. Definition of Done für den ersten echten MVP

Der MVP ist fertig, wenn alle folgenden Punkte nachweisbar funktionieren:

- Agency liest mindestens ein aktiviertes Projekt aus AO.
- Der Agency-Agent erzeugt eine fundierte, deduplizierte Karte für dieses Projekt.
- Die Karte zeigt Ziel, Belege, Akzeptanzkriterien, Scope und die genaue Freigabewirkung.
- Ein Klick erzeugt genau einen Agency-Job und höchstens eine AO-Ausführung.
- Der richtige Projekt-Orchestrator erhält den Auftrag.
- Der Orchestrator startet genau einen zuordenbaren Worker.
- Der Worker arbeitet in einem AO-isolierten Worktree.
- Der Worker testet, pusht und öffnet entsprechend den Projektregeln einen PR.
- Der automatische Reviewer läuft für den aktuellen Head.
- CI-/Review-Probleme gehen an denselben Worker zurück.
- Agency zeigt PR, CI, Review und Blocker an.
- „Umsetzen“ führt nie automatisch zum Merge.
- Merge ist eine neue explizite Entscheidung mit Live-Recheck.
- Neustart, Doppelklick oder temporär fehlender AO-Daemon erzeugen keinen zweiten Worker.

## 13. Fazit

Die Produktidee ist stark, weil sie zwei heute getrennte Schleifen verbindet:

- **Agency beantwortet:** Was wäre als Nächstes wertvoll?
- **AO beantwortet:** Wer setzt es kontrolliert um, in welchem Workspace, mit welchem Review- und CI-Stand?

Technisch ist der Engpass nicht das Starten eines Workers; das kann AO bereits sehr gut. Der eigentliche Integrationswert liegt in vier Dingen:

1. verbindlicher Projektbezug,
2. idempotente Übergabe,
3. dauerhafte Korrelation zwischen Idee und AO-Arbeit,
4. sauberer Rückfluss zum nächsten menschlichen Entscheid.

Der beste Weg ist deshalb ein kleiner Ein-Projekt-Pilot vor jeder größeren UI- oder Backend-Erweiterung. Wenn die Vorschlagsqualität überzeugt, kann die Bridge schrittweise dauerhaft gemacht werden. Ein neues AO-Task-Domainmodell ist erst dann sinnvoll, wenn ein Agency-Vorschlag regelmäßig mehrere Worker benötigt.

---

## Quellenverzeichnis

### Primärquellen Agency

- [Offizielles Agency-Repository](https://github.com/browser-use/agency)
- [Agency README](https://github.com/browser-use/agency/blob/main/README.md)
- [Agency Skill](https://github.com/browser-use/agency/blob/main/skills/agency/SKILL.md)
- lokaler Recherche-Checkout des Commits `53651cecb61d5b71b208504c7790c1e0e94bb3ad`
- [`codex-session-2026-09-16-2148-agency.md`](codex-session-2026-09-16-2148-agency.md)

### Primärquellen Agent Orchestrator

- [Offizielles Agent-Orchestrator-Repository](https://github.com/Untrivial-ai/agent-orchestrator)
- [Apache-2.0-Lizenz](https://github.com/Untrivial-ai/agent-orchestrator/blob/main/LICENSE)
- [`../Agent_Orchestrator/README.md`](../Agent_Orchestrator/README.md)
- [`../Agent_Orchestrator/docs/architecture.md`](../Agent_Orchestrator/docs/architecture.md)
- [`../Agent_Orchestrator/docs/cli/README.md`](../Agent_Orchestrator/docs/cli/README.md)
- [`../Agent_Orchestrator/backend/internal/httpd/controllers/dto.go`](../Agent_Orchestrator/backend/internal/httpd/controllers/dto.go)
- [`../Agent_Orchestrator/backend/internal/httpd/controllers/sessions.go`](../Agent_Orchestrator/backend/internal/httpd/controllers/sessions.go)
- [`../Agent_Orchestrator/backend/internal/service/session/delegation.go`](../Agent_Orchestrator/backend/internal/service/session/delegation.go)
- [`../Agent_Orchestrator/backend/internal/session_manager/prompt.go`](../Agent_Orchestrator/backend/internal/session_manager/prompt.go)
- [`../Agent_Orchestrator/backend/internal/service/project/types.go`](../Agent_Orchestrator/backend/internal/service/project/types.go)
- [`../Agent_Orchestrator/ao-rules/orchestrator-rules.md`](../Agent_Orchestrator/ao-rules/orchestrator-rules.md)
- [`../Agent_Orchestrator/ao-rules/worker-rules.md`](../Agent_Orchestrator/ao-rules/worker-rules.md)
- [`../Agent_Orchestrator/FORK-CHANGES.md`](../Agent_Orchestrator/FORK-CHANGES.md)

### Lizenzhinweis

- [GitHub Terms of Service – License Grant to Other Users](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#5-license-grant-to-other-users)
