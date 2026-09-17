# Agency × Agent Orchestrator — Recherche und Umsetzungskonzept

**Stand:** 2026-09-17 · **Autor:** Claude Opus 5 (Recherche im Quellcode beider Systeme)
**Anlass:** Codex-Session vom 16.09.2026, 21:48 (`codex-session-2026-09-16-2148-agency.md`)
**Hinweis:** Im selben Ordner liegt `Agency-Agent-Orchestrator-Integrationsrecherche.md` — eine parallel entstandene, ausführlichere Untersuchung derselben Frage. Beide kommen unabhängig zum gleichen Kernbefund (§0, Punkt 2). Dieses Dokument ist der zweite Blickwinkel; es geht stärker auf die harten Validierungsregeln der Agency-API ein (§1.6, §8).

**Untersucht:**

| System | Quelle | Stand der Recherche |
|---|---|---|
| Agency | `github.com/browser-use/agency` (Clone vom 17.09.2026, 77 Dateien, 76 Commits, 391 Stars) | vollständig gelesen: API-Routen, DB-Schema, Job-Lebenszyklus, Skill, README |
| Agent Orchestrator (AO) | `D:\Tools\Agent_Orchestrator` (dein Fork von `Untrivial-ai/agent-orchestrator`) | Router, Controller-DTOs, Projekt-/Session-Domäne, Delegations-Service, Docs, lokaler Datenbestand |

---

## 0. Kurzfassung

Die Idee aus der Session trägt — aber nicht ganz so, wie sie dort beschrieben wurde. Drei Korrekturen vorab:

1. **AO hat bereits eine vollwertige Projektverwaltung** (`projects`-Tabelle, REST-API, `ao project add/ls`). Agency hat *keine*. Die Richtung „AO ist die Projekt-Registry, Agency liest sie" ist damit richtig — und sie ist billiger umzusetzen als gedacht, weil Agency das Projekt nur als **freies Textfeld** `card.project` kennt. Es genügt, dort die AO-Projekt-ID hineinzuschreiben. Keine Schema-Änderung nötig.
2. **`POST /api/v1/orchestrators/delegate` ist trotz des Namens kein Orchestrator-Aufruf.** Der Handler spawnt direkt einen Worker (`backend/internal/service/session/delegation.go:65`); nur der Kartentitel wird im Hintergrund von einem Modell nachgeschärft. Wer echte Planung will (Orchestrator zerlegt die Aufgabe, spawnt mehrere Worker, kennt deine `orchestratorRules`), muss den Orchestrator per **`POST /api/v1/sessions/{id}/send`** ansprechen. Das ist der entscheidende Unterschied für die Pipeline-Architektur.
3. **Agency hat keinen Hintergrund-Worker und keinen Scheduler.** Der „Runner" ist immer eine laufende Coding-Agent-Session. Genau diese Rolle kann AO übernehmen — als Standalone-Session, die dauerhaft läuft. Das ist der natürlichste Kopplungspunkt, nicht ein neuer Dienst.

**Empfohlene Zielarchitektur (Hybrid):**

```
                    ┌──────────────────────────────────────────┐
                    │  AO-Daemon  127.0.0.1:3001 (loopback)    │
   Projekt-Registry │  projects · sessions · PR/CI/Review · SSE │
                    └───────▲──────────────────────┬───────────┘
                            │ ao CLI / REST        │ Status, PR, CI
             spawnt Worker  │                      ▼
   ┌────────────────────────┴───────┐     ┌────────────────────┐
   │ AO-Orchestrator (claude-code)  │     │  ao-agency-bridge  │
   │  plant, zerlegt, delegiert     │     │  (Node, deterministisch)
   └────────────────────────────────┘     └────┬──────────┬────┘
              ▲                                │          │
              │ Brief (send)                   │ Jobs     │ Karten-Update
   ┌──────────┴─────────────────┐       ┌──────▼──────────▼────┐
   │ Agency-Runner-Session      │ push  │  Agency-App :3100    │
   │ (Discovery, Kartenbau)     │──────▶│  /api/ideas /agent-jobs
   └────────────────────────────┘       └──────────────────────┘
```

- **Agency** bleibt das, was es ist: Entdeckungs- und Entscheidungsoberfläche („Was ist überhaupt zu tun?" → Karte → dein Klick).
- **AO** bleibt das, was es ist: Ausführungs- und Aufsichtssystem („Wer macht es, in welchem Worktree, mit welchem PR, wer reviewt?").
- Dazwischen: **eine schmale Brücke**, die Agency-Jobs nach AO überträgt und AO-Zustände als Karten-Updates zurückspielt.

Aufwandsschätzung für einen funktionierenden Durchstich: **Phase 1 + 2 ≈ 1–2 Abende** (siehe §7).

---

## 1. Agency — was es tatsächlich ist

### 1.1 Kernidee

Ein einzelner Nutzer, ein lokaler Kartenstapel. Ein Coding-Agent (Codex oder Claude Code) recherchiert *vorher*, bereitet die Arbeit *privat* fertig an und legt dem Nutzer nur noch eine **fertige Entscheidung** vor — als eigenständige HTML-Karte mit Problem, Ergebnis und Knopf. Klickt der Nutzer, entsteht ein **Job**, den derselbe (oder ein anderer) Agent abarbeitet und explizit abschließt.

Das Produkt ist also **die Entscheidung**, nicht die Ausführung. Ausführung ist bei Agency eine formlose „mach mal" an den Agenten.

### 1.2 Technischer Aufbau

| Aspekt | Fakt |
|---|---|
| Stack | TypeScript, React 19, `vinext` (Next-App-Router auf Vite), Cloudflare-Workers-Runtime lokal via Wrangler |
| Datenbank | D1/SQLite, initialisiert unter `.wrangler/` — pro Checkout eigene DB |
| Start | `npm ci && npm run dev -- --hostname localhost --port 3100` |
| Node | ≥ 22.13 |
| Erreichbarkeit | **nur Loopback**, ausdrücklich: „trusted single-user app with unauthenticated routes" |
| Migrationen | `db/index.ts` → `ensureDatabase()` legt Tabellen idempotent an, max. 1×/Minute, ~1,5 s |
| Skill-Installation | `node scripts/install-skill.mjs --codex\|--claude` → kopiert nach `~/.codex/skills/agency` bzw. `~/.claude/skills/agency`; **überschreibt nie** eine bestehende Installation |

### 1.3 Datenmodell (`db/schema.ts`)

| Tabelle | Bedeutung |
|---|---|
| `ideas` | die Karten. Felder u. a. `project`, `category`, `headline`, `card_html`, `agent_context` (privater JSON-Kontext ≤ 100 000 Zeichen), `rise_*`, `score`, `decision_estimate_ms`, `version`, `dedupe_key` (**UNIQUE**), `status` ∈ `new\|working\|done\|rejected` |
| `agent_jobs` | ein Job je Klick. `idea_id`, `action` (`do\|change\|no\|task`), `button_label`, `instruction`, `user_feedback`, `card_context` (JSON-Schnappschuss der Karte + Klick), `status` ∈ `queued\|running\|done\|failed`, `result` (≤ 20 000 Zeichen), `ticket_outcome` ∈ `completed\|review\|blocked` |
| `feedback` | jede Entscheidung mit Notiz |
| `card_attention`, `card_interactions` | Aufmerksamkeitsmessung: aktive Millisekunden, Wanduhrzeit, Klickpfad — die Basis für die Effort-Kalibrierung |
| `contexts` | der „Dream"/Brief aus der Oberfläche |
| `topics` | Lanes/Kategorien (nur in `db/index.ts` angelegt, fehlt im Drizzle-Schema) |

### 1.4 API

Authentifizierung ist bewusst minimal (`app/api/agent-jobs/route.ts:6-13`, identisch in `ideas`):

```js
// erlaubt, wenn:
//   Origin-Header == eigener Origin            (Browser)
//   ODER Loopback-Host + x-radar-local-agent:1 (lokaler Agent/Brücke)
//   ODER x-radar-agent-key == env.RADAR_AGENT_KEY
```

> **Für die Brücke wichtig:** `POST /api/ideas/action` prüft nur `if (origin && origin !== eigener Origin) → 403`. Ein serverseitiger `fetch` ohne `Origin`-Header kommt also durch. Eine Brücke *kann* damit Karten programmatisch „klicken" — das ist kein Loch, das man ausnutzen muss, aber es eröffnet Auto-Approve-Regeln (§8, Risiko R7).

| Route | Methode | Zweck |
|---|---|---|
| `/api/agent-jobs` | GET | offene Jobs holen (inkl. `history` je Karte, Ergebnisse auf 600 Zeichen gekürzt) |
| `/api/agent-jobs` | POST | `{id, status, result?, ticketOutcome?}` — Job beanspruchen/abschließen |
| `/api/ideas` | POST | Karte anlegen/aktualisieren (Upsert über `dedupeKey`) |
| `/api/ideas/action` | POST | Entscheidung („Do"/„Change"/„No") → erzeugt Job |
| `/api/ideas/attention` | POST | Sicht-/Aktivzeit-Telemetrie |
| `/api/state` | GET | Feed-Projektion: Kontext, Karten einer Lane, Jobstatus, Entscheidungsmetriken |
| `/api/tasks` | POST | „New Task": erzeugt sofort Karte (`status=working`) **und** Job (`action=task`) |
| `/api/topics` | GET/POST/DELETE | Lanes verwalten |
| `/api/stats`, `/api/context` | GET | Auswertung, aktueller Brief |

### 1.5 Job-Lebenszyklus (`lib/job-lifecycle.ts`)

- `JOB_LEASE_MS = 6 h`, `MAX_CONCURRENT_JOBS = 10`.
- **Kein exklusiver Claim.** `POST {status:"running"}` erneuert nur die Lease; GET liefert abgelaufene Running-Jobs erneut mit `reclaimed: true`. Koordination ist Sache der Agenten. → *Die Brücke muss selbst idempotent sein.*
- Zulässige Endzustände und ihre Wirkung auf die Karte (`ideaStatusForOutcome`):

| `status` | `ticketOutcome` | Karte landet in | Bedeutung |
|---|---|---|---|
| `done` | `completed` | **Done** | zugesagtes Ergebnis verifiziert |
| `done` | `review` | **New** | Arbeit vorbereitet, Entscheidung offen |
| `failed` | `blocked` | **New**, sichtbar blockiert | präziser Blocker |

  Fehlendes Outcome ⇒ `review`. `failed` erzwingt `blocked`. Terminalzustände sind nicht wiederbelebbar.

### 1.6 Kartenregeln (harte Validierung, `app/api/ideas/route.ts`)

- Pflicht: `project`, `category`, `headline`, `dedupeKey`, `cardHtml` **80–250 000 Zeichen**, vollständiges `rise` (4 × 0–25).
- **HTML-Sanitizer verbietet**: `script`, `iframe`, `object`, `embed`, `form`, `meta`, `base`, `link`, `svg`, `math` — **und `<a>`**. Ebenso `on*=`-Handler, `javascript:`, `@import`, `url(http…)`, remote `src/poster/srcset`. Links laufen ausschließlich über `data-radar-action="open"` + `data-radar-url`.
- Interaktion: `data-radar-action="do"` + `data-radar-prompt="…"` erzeugt beim Klick den Job mit genau diesem Prompt. `Change`, `Improve`, `Skip` gehören dem Host, nicht der Karte.
- **Upsert-Semantik:** gleicher `dedupeKey` ⇒ `version + 1`, `status = 'new'`, neuer Zeitstempel. Eine kosmetische Aktualisierung reißt also eine erledigte Karte zurück in den Stapel.
- **Blockierte Ersetzung** (Ausnahme, zustandserhaltend): erst Job `failed/blocked` abschließen, dann Karte mit `blockedJobId`, `expectedVersion`, sichtbarem `data-radar-state="blocked"` und **ohne** Do-Action pushen. Bei `409` neu lesen, nicht raten.

### 1.7 Bewertung: RISE (`lib/rise.ts`)

`reach`, `impact`, `strategicFit`, `ease` je 0–25, gespeicherter `score` = Summe (0–100). **Angezeigt** wird nur `Score = round(riseImpact / 2.5)` (0–10). Dazu `effortSeconds` = geschätzte **Entscheidungssekunden des Menschen** (nicht Rechenzeit) plus `effortReason`. Sortierung: angezeigter Score → Gesamtsumme → ID.

### 1.8 Was Agency ausdrücklich *nicht* hat

- keinen Projekt-Selector, keine Repo-Registrierung, keine Pfadverwaltung
- keinen Hintergrund-Worker, keinen Scheduler, keine automatische Thread-Injektion
- keinen Connector-Assistenten
- keine Zwei-Wege-Synchronisation mit Linear (`skills/agency/LINEAR.md`: „no bridge, polling service or automatic two-way sync")
- keine Ausführungsisolation: kein Worktree, kein Branch, kein PR-Bezug, kein CI-Wissen

**Genau diese Lücke füllt AO.** Umgekehrt hat AO keine Ideenfindung und keine Entscheidungsoberfläche. Die beiden Systeme überschneiden sich fast nicht — das ist der Grund, warum die Kopplung überhaupt sinnvoll ist.

---

## 2. Agent Orchestrator — was du bereits hast

### 2.1 Architektur

Go-Daemon, der parallele Agenten-Sessions beaufsichtigt. Mentales Modell (`docs/architecture.md`): **OBSERVE → UPDATE → DERIVE**. Dauerhaft gespeichert werden nur harte Fakten (`activity_state`, `is_terminated`, Modus, PR/CI/Review-Fakten); die Kanban-Spalten (`working`, `needs_input`, `ci_failed`, `mergeable`) werden **beim Lesen berechnet**, nie gespeichert.

- Jede Worker-Session bekommt eigenen **Branch + Git-Worktree** (`ao/<session-id>/root`), Standalone-Sessions ein AO-verwaltetes Verzeichnis.
- Zwei Oberflächenmodi je Session: **Chat** (strukturierter Controller) oder **TUI** (natives Terminal des Agenten); durchgängiger Handoff zwischen beiden.
- 27 unterstützte Harnesses.
- **SCM-Observer** verfolgt PR, CI-Checks, Review-Entscheidungen, Mergebarkeit und spiegelt sie in die Session.

### 2.2 Erreichbarkeit

| Punkt | Wert |
|---|---|
| Loopback-Listener | `127.0.0.1:3001` (Default, `AO_PORT` überschreibbar), **ohne Authentifizierung** |
| Handshake-Datei | `~/.ao/running.json` → `{pid, port, startedAt, owner, …}` |
| LAN-Listener | opt-in, `0.0.0.0:3011`, Bearer-Passwort, für Mobile |
| Binary | `C:\Users\phili\AppData\Local\Programs\agent-orchestrator\resources\daemon\ao.exe` (nicht im PATH) |
| SSE | `GET /api/v1/events` — CDC-Strom, `Last-Event-ID`/`X-AO-Event-After` für lückenlosen Wiedereinstieg, Heartbeat 10 s |
| OpenAPI | `GET /api/v1/openapi.yaml` (generiert aus den Go-DTOs, `backend/internal/httpd/apispec/`) |

> Zum Zeitpunkt der Recherche: `ao status --json` meldete `"state": "stopped"` — der Daemon läuft nur, solange die Desktop-App offen ist oder `ao start` gelaufen ist. Für eine Dauerbrücke relevant (§8, R1).

### 2.3 Die Routen, die für die Integration zählen

| Route | Bedeutung für uns |
|---|---|
| `GET /api/v1/projects` | **die Projektliste**, die Agency fehlt → `{id, name, path, kind, sessionPrefix, orchestratorAgent, folderMissing}` |
| `POST /api/v1/projects` | `{path, projectId?, name?, config?}` — Projekt registrieren |
| `PUT /api/v1/projects/{id}/config` | Rollen, Regeln, Reviewer, Auto-Review setzen |
| `POST /api/v1/sessions` | Worker/Orchestrator spawnen (`projectId`, `kind`, `harness`, `model`, `mode`, `prompt`, `branch`, `displayName` ≤ 20 Zeichen, `attachments`) |
| `POST /api/v1/orchestrators` | Orchestrator-Session für ein Projekt anlegen |
| `POST /api/v1/orchestrators/delegate` | `{projectId, brief, agent?, model?, effort?, mode?, approvalMode?}` → **202**, `{workerId}`. **Spawnt direkt einen Worker** |
| `POST /api/v1/sessions/{id}/send` | Nachricht an eine laufende Session — **der echte Weg zum Orchestrator** |
| `GET /api/v1/sessions` | alle Sessions inkl. `prs[]` (State, CI, Review, Mergebarkeit) |
| `GET /api/v1/sessions/{id}/pr` | ausführliche PR-Zusammenfassung: fehlgeschlagene Checks mit Namen und URL, ungelöste Review-Threads, Additions/Deletions |
| `GET /api/v1/sessions/{id}/conversation` | Verlauf (für Ergebnisberichte in der Karte) |
| `POST /api/v1/sessions/{id}/kill` · `/restore` · `/cleanup` | Aufräumen |
| `POST /api/v1/prs/{id}/merge` | Merge (bewusst hinter deiner Freigabe halten) |

### 2.4 Projektkonfiguration (`backend/internal/domain/projectconfig.go`)

Pro Projekt konfigurierbar — und für die Pipeline genau das richtige Werkzeug:

- `worker` / `orchestrator` Rollen-Overrides (Harness + Modell + Effort), `reviewers[]`
- `agentRules` (stehende Anweisungen für Worker) und `orchestratorRules`
- `env`, `symlinks`, `postCreate` je Session-Workspace
- `autoReview` — neue Worker starten mit automatischem PR-Review
- `trackerIntake` — **GitHub/GitLab-Issues spawnen automatisch Worker** (opt-in, lesend gegenüber dem Tracker). Ein vorhandener, alternativer Einspeisungsweg (§4, Option C).

### 2.5 Dein konkreter lokaler Stand

Aus `~/.ao/data/ao.db` gelesen:

- Ein Projekt: **`testao`** → `D:\Test_AO`, Origin `github.com/guschi18/Test_AO`, am 17.09. **archiviert**. 7 Sessions insgesamt.
- Rollenbelegung dieses Projekts (genau die Orchestrator/Worker/Reviewer-Pipeline aus der Codex-Session):

| Rolle | Harness | Modell |
|---|---|---|
| Orchestrator | `claude-code` | `claude-opus-5` |
| Worker | `opencode` | `opencode-go/glm-5.3-flash`, Effort `high` |
| Reviewer | `codex` | `gpt-5.6-sol`, Effort `high` |

  `autoReview: true`. Dazu ausführliche deutsche `agentRules`/`orchestratorRules` (Branch-Namensschema `ao/<session-id>/<thema>` mit Schrägstrich, PR-Pflicht, `gh pr create --body-file`, Merge nur auf ausdrückliche Bitte, „du wirst über Worker nicht benachrichtigt — sieh selbst nach").
- Dein Fork ergänzt: Standard-Setup-Knopf, editierbare Standing Instructions in den Projekteinstellungen (`ao-standard-setup.ts`), eigener Update-Weg, „Frühere Orchestratoren" (Neustart mit leerem Kontext + Leseansicht) und `ao session history <id>`.

**Folgerung:** Die AO-Seite der Pipeline ist fertig und eingefahren. Es fehlt nur die Einspeisung — und die soll Agency liefern.

---

## 3. Begriffsabgleich

| Agency | AO | Passt? |
|---|---|---|
| Karte (`idea`) | — (kein Gegenstück; am ehesten „geplante Aufgabe" im Orchestrator-Kopf) | Agency ergänzt AO |
| `card.project` (Freitext) | `projectId` (Registry-Schlüssel) | **direkt abbildbar** — Konvention: identisch |
| Job (`do`-Klick) | Worker-Session / Orchestrator-Auftrag | Kern der Brücke |
| `instruction` / `data-radar-prompt` | `prompt` bzw. `brief` | 1:1, beide ≤ 16 KiB (AO) / 5 000 (Klick-Prompt) |
| `agentContext` (≤ 100 KB, privat) | Spawn-Prompt + Attachments | Kontexttransport |
| `status = working` | Session aktiv / PR offen | abgeleitet |
| `done/completed` | PR gemerged **oder** verifiziert „nur lokal" | Entscheidungsregel nötig (§5.3) |
| `done/review` | PR offen, Review ausstehend/`changes_requested` | direkt |
| `failed/blocked` | `activity_state = blocked`, `exited` ohne Ergebnis, CI rot | direkt |
| `dedupeKey` | kein Gegenstück | **Mapping-Datei nötig** |
| RISE-Score / Effort | kein Gegenstück | bleibt bei Agency |
| — | Branch, Worktree, PR, CI, Reviewer | bleibt bei AO |

Die einzige echte Lücke ist die **Identitätszuordnung** `dedupeKey ⇄ sessionId`. Dafür braucht die Brücke eigenen Speicher (eine kleine SQLite-Datei oder JSON).

---

## 4. Drei Integrationsoptionen

### Option A — Deterministische Brücke (Node-Dienst)

Ein kleiner Prozess pollt `GET /api/agent-jobs`, mappt jeden Job auf einen AO-Aufruf, pollt AO-Zustände und schließt Jobs ab.

- **Pro:** vorhersagbar, testbar, kostet keine Modell-Tokens, läuft als Dienst durch, klare Fehlermeldungen.
- **Contra:** kann keine Karten *erfinden*. Übersetzt nur.
- **Passt für:** Ausführung und Statusrückmeldung.

### Option B — Agent-Brücke (Agency-Runner als AO-Session)

Eine dauerhafte AO-Standalone-Session mit installiertem Agency-Skill übernimmt die Runner-Rolle: Discovery, Kartenbau, Job-Abarbeitung — und benutzt für echte Code-Arbeit die `ao`-CLI (`ao spawn`, `ao send`, `ao session ls`).

- **Pro:** das ist genau der von Agency vorgesehene Betriebsmodus. Kartenerstellung ist ohne Modell nicht machbar. AO liefert dabei Aufsicht, Logs, Neustart, Verlauf (`ao session history`).
- **Contra:** nichtdeterministisch; Ausführungsbuchhaltung (Job-Abschluss, PR-Verfolgung) ist bei einem Modell schlecht aufgehoben — es vergisst, schätzt, halluziniert Zustände.
- **Passt für:** Entdeckung und Kartenbau.

### Option C — Fork-Erweiterung in AO

Eine „Agency"-Sektion im AO-Frontend (Kartenliste, Freigabe-Knopf) oder `trackerIntake` als Transportweg (Karte → GitHub-Issue → AO spawnt automatisch).

- **Pro:** eine Oberfläche; `trackerIntake` existiert bereits fertig.
- **Contra:** deutlich mehr Fork-Oberfläche = mehr Upstream-Konflikte (siehe `FORK-CHANGES.md`: `ProjectSettingsForm.tsx` ist schon jetzt die konfliktträchtigste Datei). Der Issue-Umweg macht private Karteninhalte auf GitHub öffentlich — Agency schreibt ausdrücklich „never push private data".
- **Passt für:** später, optional.

### Empfehlung

**B für Ideen, A für Ausführung, C zurückstellen.**

Begründung: Die zwei Aufgaben haben unterschiedliche Fehlermodi. Kartenbau darf kreativ und unscharf sein; die Job-Buchhaltung muss exakt sein, weil ein falsch gemeldetes `done/completed` eine Karte aus deinem Stapel entfernt, ohne dass Arbeit passiert ist. Deshalb gehört die Buchhaltung in deterministischen Code.

---

## 5. Zielarchitektur im Detail

### 5.1 Komponenten

| Komponente | Wo | Aufgabe |
|---|---|---|
| Agency-App | `D:\Tools\Agency\agency`, Port 3100 | Kartenstapel, Entscheidungen, Job-Queue |
| AO-Daemon | `127.0.0.1:3001` | Projekte, Worker, Worktrees, PR/CI/Review |
| **`ao-agency-bridge`** | neu, `D:\Tools\Agency\bridge` | Jobs → AO, AO-Zustände → Karten |
| Agency-Runner | AO-Standalone-Session, Claude Code oder Codex | Discovery, Kartenbau, `me.md`-Pflege |
| AO-Orchestrator je Projekt | AO-Session | Planung und Zerlegung großer Briefs |

### 5.2 Zwei Ausführungswege — bewusst getrennt

Die Karte selbst entscheidet, welcher Weg genommen wird, über ein Feld in `agentContext`:

```json
{
  "ao": {
    "projectId": "testao",
    "route": "worker",
    "harness": "opencode",
    "model": "opencode-go/glm-5.3-flash",
    "branchHint": "fix-session-leak",
    "localOnly": false
  }
}
```

| `route` | Brücke ruft | Wann |
|---|---|---|
| `"worker"` | `POST /api/v1/orchestrators/delegate` (bzw. `POST /api/v1/sessions`) | Aufgabe ist eindeutig, eine Datei/ein PR, Karte enthält bereits den exakten Fix |
| `"orchestrator"` | `POST /api/v1/sessions/{orchId}/send` mit dem Brief | Aufgabe ist mehrteilig, unklar zerlegt, oder braucht Architekturentscheidungen |

Für `route: "orchestrator"` muss die Brücke den Orchestrator des Projekts finden (`GET /api/v1/orchestrators`, nach `projectId` filtern) und notfalls per `POST /api/v1/orchestrators` einen anlegen.

> Deine bestehenden `orchestratorRules` greifen dabei automatisch — inklusive der Regel „Ein Ziel je Spawn" und „`ao spawn --name` ist Pflicht, max. 20 Zeichen". Das ist ein Argument für den Orchestrator-Weg als Standard bei allem, was größer ist als ein Einzeiler.

### 5.3 Zustandsabbildung (die Kernlogik der Brücke)

Pro gemapptem Job pollt die Brücke `GET /api/v1/sessions/{id}` + `GET /api/v1/sessions/{id}/pr` und entscheidet:

| AO-Beobachtung | Agency-Meldung | Karteneffekt |
|---|---|---|
| Session lebt, PR noch nicht offen | `{status:"running"}` (Lease erneuern, ≤ alle 30 min) | bleibt **Working** |
| PR offen, CI läuft/grün, Review ausstehend | `{status:"done", ticketOutcome:"review"}` + Karten-Update mit PR-Link | **New**, „bereit zur Freigabe" |
| PR `merged` | `{status:"done", ticketOutcome:"completed"}` | **Done** |
| `localOnly: true` und Session `exited` mit Ergebnis | `{status:"done", ticketOutcome:"review"}` | **New** |
| CI rot / `changes_requested` / Session `blocked` / `exited` ohne PR | `{status:"failed", ticketOutcome:"blocked"}` **danach** blockierte Ersatzkarte | **New**, sichtbar blockiert |
| Session länger als *n* Stunden ohne Signal | `failed/blocked` mit „Session ohne Fortschritt" | **New**, blockiert |

**Wichtig:** Bei `blocked` zuerst den Job als `failed/blocked` abschließen, **dann** die Ersatzkarte mit `blockedJobId` + `expectedVersion` + `data-radar-state="blocked"` und **ohne** Do-Action pushen. Andere Reihenfolge ⇒ `409`.

Der `merge`-Schritt bleibt bewusst **außerhalb** der Brücke: `POST /api/v1/prs/{id}/merge` wird nur ausgelöst, wenn du in Agency eine Karte mit ausdrücklicher Merge-Aktion klickst — konsistent zu deiner AO-Regel „von dir aus mergst du nie".

### 5.4 Karteninhalt für AO-Aufgaben

Weil `<a>` verboten ist, sieht der Fuß einer AO-Karte so aus:

```html
<div class="ao-meta">
  <span>Projekt: testao</span><span>Worker: opencode · glm-5.3-flash</span>
  <span>Branch: ao/testao-12/root</span>
</div>
<button data-radar-action="do"
        data-radar-prompt="Diesen Fix in testao umsetzen: … . Branch ao/testao-12/fix-leak, PR gegen main öffnen.">
  An AO übergeben
</button>
<button data-radar-action="open" data-radar-url="https://github.com/guschi18/Test_AO/pull/12">
  Pull Request ansehen ↗
</button>
```

Kein `localhost`-Link in Karten, die je geteilt werden könnten (Agency-Skill weist ausdrücklich darauf hin). AO-interne Links (`ao://`) funktionieren nicht — die Session-ID gehört als Text auf die Karte.

### 5.5 Projektauswahl — die Antwort auf deine Frage aus der Session

Kein neues Feature nötig. Die Konvention reicht:

1. `GET http://127.0.0.1:3001/api/v1/projects` liefert die maßgebliche Liste.
2. Die Brücke schreibt sie regelmäßig nach `agency/agent-work/ao-projects.json` und in eine **Agency-Topic je Projekt** (`POST /api/topics {label:"testao", hint:"D:\\Test_AO · single_repo"}`).
3. Der Agency-Runner setzt `card.project` **immer** auf die AO-Projekt-ID und `card.category` auf das Topic.
4. Auswahl im Alltag: über die Topic-Lanes in Agency filtern; Steuerung, *welche* Projekte überhaupt untersucht werden, über eine kurze Liste in `me.md` (aktiv/pausiert/Priorität) — genau wie in der Codex-Session skizziert, aber mit AO-IDs statt handgepflegter Pfade.

Damit gibt es **eine** Wahrheit über Projekte (AO) und **eine** über Prioritäten (`me.md`).

---

## 6. Datenfluss, vollständig

```
①  Agency-Runner (AO-Session, Agency-Skill)
    liest me.md + ao-projects.json
    untersucht Repos (rg/git log/gh issue list/CI)
    → POST /api/ideas   {project:"testao", dedupeKey:"testao:leak:session-manager", rise:…, cardHtml:…,
                          agentContext:{ao:{route:"worker",…}}}

②  Du klickst „An AO übergeben"
    → POST /api/ideas/action  → job {id, action:"do", instruction:<data-radar-prompt>, cardContext}

③  Brücke pollt GET /api/agent-jobs
    erkennt Job als AO-Job (agentContext.ao vorhanden)
    → POST /api/agent-jobs {id, status:"running"}
    → POST /api/v1/orchestrators/delegate {projectId, brief, agent, model}   → 202 {workerId}
    speichert  dedupeKey ⇄ jobId ⇄ workerId  in bridge.db

④  AO arbeitet: Worktree, Branch, Worker-Agent, PR, Codex-Review, CI

⑤  Brücke pollt GET /api/v1/sessions?…  bzw. hört auf GET /api/v1/events (SSE)
    PR offen → Karte aktualisieren (gleicher dedupeKey, PR-Status sichtbar)
             → POST /api/agent-jobs {id, status:"done", ticketOutcome:"review"}
    PR merged→ POST /api/agent-jobs {id, status:"done", ticketOutcome:"completed"}
    blockiert→ POST /api/agent-jobs {id, status:"failed", ticketOutcome:"blocked"}
             → danach blockierte Ersatzkarte (blockedJobId, expectedVersion)

⑥  Du siehst in Agency: Done / zur Freigabe / blockiert — mit PR-Link und Begründung
```

---

## 7. Umsetzungsplan

### Phase 0 — Grundlage (≈ 30 min)

```powershell
cd D:\Tools\Agency
git clone https://github.com/browser-use/agency.git agency
cd agency
npm ci
npm run dev -- --hostname localhost --port 3100
```

Danach in einer zweiten Konsole:

```powershell
node scripts/install-skill.mjs --claude     # oder --codex
# AO-Daemon sicherstellen:
& "$env:LOCALAPPDATA\Programs\agent-orchestrator\resources\daemon\ao.exe" start
& "$env:LOCALAPPDATA\Programs\agent-orchestrator\resources\daemon\ao.exe" status --json
```

**Akzeptanz:** `http://localhost:3100` zeigt den leeren Feed; `ao status --json` meldet `running` mit Port.

### Phase 1 — Projektspiegel (≈ 1 h)

`bridge/sync-projects.mjs`: liest `~/.ao/running.json` → Port → `GET /api/v1/projects` → schreibt `agent-work/ao-projects.json` und legt je Projekt ein Agency-Topic an.

**Akzeptanz:** Agency zeigt für jedes registrierte AO-Projekt eine Lane; `ao-projects.json` enthält ID, Name, Pfad, Kind, Orchestrator-Harness.

### Phase 2 — Ausführungsbrücke (≈ 3–4 h, der eigentliche Kern)

`bridge/index.mjs`, ein Prozess, 15-Sekunden-Takt:

```
loop:
  jobs = GET /api/agent-jobs           (x-radar-local-agent: 1)
  für jeden Job mit agentContext.ao und ohne Eintrag in bridge.db:
      claim → running
      route == "orchestrator" ? send(orchId, brief) : delegate(projectId, brief)
      persistiere mapping
  für jedes offene Mapping:
      session = GET /api/v1/sessions/{id};  pr = GET /api/v1/sessions/{id}/pr
      wende Tabelle §5.3 an
      bei Terminalzustand: Karte aktualisieren, Job abschließen, Mapping schließen
```

Eigener Speicher: `bridge/bridge.db` (SQLite) mit `mappings(jobId PK, ideaId, dedupeKey, projectId, sessionId, route, state, lastPollAt, lastRunningPingAt)`.

**Akzeptanz (Durchstich):** Karte manuell per `npm run card:push` anlegen → in Agency klicken → AO-Kanban zeigt binnen 30 s einen neuen Worker → nach PR-Öffnung wird die Karte zu „review" mit PR-Knopf → nach Merge auf Done.

### Phase 3 — Runner-Session (≈ 1–2 h)

AO-Standalone-Session mit Claude Code, Dauerauftrag, plus eine Ergänzung in `me.md`:

```markdown
## Ausführung
Code-Arbeit geht nie direkt an ein Terminal, sondern immer über Agent Orchestrator.
Jede Coding-Karte setzt in agentContext.ao: projectId (aus agent-work/ao-projects.json),
route ("worker" bei eindeutigem Einzelfix, sonst "orchestrator"), optional harness/model.
Projekte und ihren Zustand nur aus agent-work/ao-projects.json lesen, nie raten.

## Projekte
### testao — Priorität hoch, aktiv — Ziel: <…>
### <weiteres> — Priorität mittel, pausiert
```

**Akzeptanz:** „Untersuche heute nur testao, maximal drei fundierte Vorschläge" erzeugt drei Karten mit korrekter `projectId` und plausiblem RISE.

### Phase 4 — Ausbau (optional)

- SSE (`GET /api/v1/events`) statt Polling für AO-Zustände
- Merge-Karte: eigener Kartentyp, dessen Do-Action `POST /api/v1/prs/{id}/merge` auslöst — erst nach `approved` und grünem CI
- CI-Fehler-Karte: `pr.ci.failingChecks[]` (Name + URL) direkt als blockierte Karte
- Vier-Stunden-Kadenz für den Runner (AO-Session per Scheduler/`/loop` anstoßen)
- Erst danach über eine „Projects"-Seite im AO-Fork nachdenken

---

## 8. Risiken und Fallstricke

| # | Risiko | Wirkung | Gegenmaßnahme |
|---|---|---|---|
| R1 | **AO-Daemon läuft nicht** (er hängt an der Desktop-App) | Brücke kann nichts übergeben | `AO_KEEP_DAEMON` / `ao start` als persistenter Daemon; Brücke liest Port stets frisch aus `running.json` und meldet Ausfall als `blocked`-Karte statt still zu scheitern |
| R2 | **Kein exklusiver Job-Claim** in Agency; abgelaufene Leases werden erneut ausgegeben | Doppelte Worker für dieselbe Aufgabe | Mapping-Tabelle der Brücke ist die Wahrheit; vor jedem Delegate gegen `dedupeKey` prüfen; `running`-Ping alle ≤ 30 min |
| R3 | **`dedupeKey`-Upsert setzt Karten auf `new` zurück** und erhöht `version` | Erledigte Karten tauchen wieder auf; `expectedVersion` veraltet | Statusmeldungen nur über den blockierten Pfad oder mit frisch gelesener Version; nie kosmetische Updates pushen |
| R4 | **HTML-Sanitizer verbietet `<a>` und alles Externe** | 400 beim Push, Karte kommt nie an | Karten-Template mit `data-radar-action="open"`; Sanitizer-Regex aus `app/api/ideas/route.ts` in einen lokalen Vorab-Check kopieren |
| R5 | **`delegate` ≠ Orchestrator** | „Planung" findet nicht statt, Worker bekommt einen zu großen Brief | `route`-Feld konsequent setzen; große Briefs über `/sessions/{orchId}/send` |
| R6 | Agency-`instruction` max. 5 000, AO-Brief max. 16 KiB | Abschneiden | Langen Kontext in `agentContext` legen und im Brief als Datei-/Pfadverweis nennen, nicht inline |
| R7 | **`/api/ideas/action` ist ohne Origin-Header offen** | Eine Brücke könnte Karten selbst „klicken" = Freigabe ohne dich | In der Brücke hart verbieten; nur lesen und melden. Wenn Auto-Approve je gewünscht ist, dann als ausdrückliche Allowlist je Projekt und nur für `localOnly`-Karten |
| R8 | Beide Apps haben **unauthentifizierte Loopback-Routen** | Jede lokale Software kann Karten anlegen und Worker spawnen | Nie `0.0.0.0`, keine Tunnel; AO-LAN-Listener aus lassen; `RADAR_AGENT_KEY` setzen, sobald etwas außerhalb des Loopbacks anfassen könnte |
| R9 | Worker-Modell (`glm-5.3-flash`) ist schwächer als der Planer | Halbfertige PRs, die als „review" durchgehen | Deine `orchestratorRules` decken das bereits ab („Ein Ziel je Spawn", Prompt mit Dateien + Verifikationsbefehl); Brücke sollte `review` nie zu `completed` aufwerten |
| R10 | **Upstream-Merges deines AO-Forks** | Integration bricht, wenn sie in geänderte Fork-Dateien wandert | Brücke strikt **außerhalb** des AO-Repos halten (`D:\Tools\Agency\bridge`), nur über die stabile REST-API sprechen — nie über `ao.db` direkt |
| R11 | Agency-DB liegt unter `.wrangler/`, pro Checkout | Verlust bei `git clean`, kein Backup | Eigenes Backup-Skript; `agent-work/`, `me.md`, `bridge.db` mitsichern |
| R12 | Windows-Pfade in JSON (`D:\Test_AO`) | Escaping-Fehler in Karten und Prompts | Immer über `JSON.stringify`, nie String-Konkatenation; in Karten Vorwärts-Schrägstriche anzeigen |

---

## 9. Offene Entscheidungen für dich

1. **Wer darf mergen?** Vorschlag: niemand automatisch. Merge bleibt eine eigene Karte mit ausdrücklicher Aktion — konsistent zu deiner AO-Regel.
2. **Standardroute** für Coding-Karten: `worker` (schnell, günstig) oder `orchestrator` (nutzt deine `orchestratorRules`, teurer)? Vorschlag: `orchestrator` als Default, `worker` nur wenn die Karte den exakten Diff bereits zeigt.
3. **Runner-Modell:** Claude Code (Opus 5) für den Agency-Runner oder Codex? Die Kartenqualität hängt fast vollständig daran.
4. **Kadenz:** die von Agency vorgeschlagenen vier Stunden, oder manuell starten, bis die Kartenqualität stimmt? Vorschlag: erst manuell, Kadenz ab Phase 4.
5. **`localOnly`-Projekte:** Soll es Projekte geben, in denen nie ein PR geöffnet wird (dann endet die Karte bei `review` statt `completed`)?
6. **Zweites Projekt:** `testao` ist archiviert. Welches reale Repo wird das erste Pipeline-Projekt? Davon hängt ab, ob `trackerIntake` (GitHub-Issues) als zusätzlicher Einspeisungsweg überhaupt interessant ist.

---

## 10. Quellenverzeichnis

**Agency** (Clone vom 17.09.2026, `main`)

| Datei | Belegt |
|---|---|
| `README.md` | Setup, Agent-API, Job-Outcomes, Karten-Regeln, Score/Effort, Topics |
| `skills/agency/SKILL.md` | Betriebsmodell: Discovery, Vorbereitung, Kartenlayout, Handeln nach Freigabe |
| `skills/agency/APPROVALS.md` | Freigabe-Defaults, was eine Freigabe abdeckt, Abbruchgründe |
| `skills/agency/LINEAR.md` | ausdrücklich kein Sync-Dienst — Vorbild für unsere Brückenphilosophie |
| `db/schema.ts`, `db/index.ts` | Tabellen, Migrationen, Status-Reconcile |
| `app/api/ideas/route.ts` | Ingest-Auth, Sanitizer, Upsert, blockierter Pfad |
| `app/api/agent-jobs/route.ts` | Lease-Abfrage, Claim, Terminalregeln |
| `app/api/ideas/action/route.ts` | Klick → Job, Aufmerksamkeitsmessung |
| `app/api/tasks/route.ts`, `app/api/topics/route.ts`, `app/api/state/route.ts` | New Task, Lanes, Feed-Projektion |
| `lib/job-lifecycle.ts`, `lib/rise.ts`, `lib/blocked-card.ts` | Lease 6 h, 10 Slots, Outcome-Mapping, RISE, blockierte Ersetzung |
| `scripts/{push-card,install-skill,sync-me}.mjs` | Push-Format, Skill-Installation, Profil-Sync |

**Agent Orchestrator** (`D:\Tools\Agent_Orchestrator`)

| Datei | Belegt |
|---|---|
| `docs/architecture.md` | OBSERVE/UPDATE/DERIVE, HTTP-Layer, Loopback + LAN, Request-Flow |
| `docs/cli/README.md` | vollständige CLI→Route-Abbildung |
| `backend/internal/httpd/api.go`, `controllers/*.go` | Routenregistrierung (u. a. `sessions.go:212-216`) |
| `backend/internal/httpd/controllers/dto.go` | `SpawnSessionRequest`, `DelegateTaskRequest:861`, `SessionView:252`, PR-Zusammenfassungen |
| `backend/internal/service/session/delegation.go:49-91` | **delegate spawnt direkt einen Worker** |
| `backend/internal/domain/projectconfig.go` | Rollen, Regeln, Reviewer, `autoReview`, `trackerIntake` |
| `backend/internal/domain/tracker.go:102` | `TrackerIntakeConfig` |
| `backend/internal/httpd/events.go:39` | SSE `/api/v1/events` |
| `backend/internal/config/config.go:28,225` | Port 3001, `AO_PORT` |
| `backend/internal/runfile/runfile.go:20` | `running.json` (pid, port, owner) |
| `FORK-CHANGES.md`, `~/.ao/data/ao.db`, `~/.ao/data/skills/using-ao/` | dein Fork, Projekt `testao`, CLI-Skill für Agenten in Sessions |
