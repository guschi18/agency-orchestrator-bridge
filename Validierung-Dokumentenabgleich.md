# Validierung: Abgleich der drei Dokumente

**Stand:** 2026-09-18 · **Prüfer:** Claude Opus 5
**Geprüfte Dateien:**

| Kürzel | Datei | Charakter |
|---|---|---|
| **A** | `Recherche-Claude-Agency-AO.md` | Recherche + Umsetzungskonzept, Stand 17.09.2026 |
| **B** | `Agency-Agent-Orchestrator-Integrationsrecherche.md` | Integrationsrecherche, Stand 17.09.2026 |
| **C** | `codex-session-2026-09-16-2148-agency.md` | Rohprotokoll der Ursprungs-Session, 16.09.2026 |

**Prüfmethode:** Alle Aussagen über Agency wurden gegen den Quellcode geprüft.
Dazu wurde `github.com/browser-use/agency` frisch geklont; HEAD ist
`53651cecb61d5b71b208504c7790c1e0e94bb3ad` vom 11.09.2026 — exakt der Commit, den B
zitiert. Aussagen über den Agent Orchestrator (lokaler Fork `D:\Tools\Agent_Orchestrator`,
`~/.ao/data/ao.db`) waren **nicht** prüfbar; sie sind unten als *unbelegt* markiert und
nur auf Widerspruchsfreiheit zwischen A und B untersucht.

---

## 1. Kernbefund

Die drei Dokumente widersprechen sich **nicht in der Architektur**, sondern in
Zahlen, in der Korrelationsstrategie und im Ausbaugrad. Alle drei kommen zum
gleichen Zielbild (Agency entdeckt → Mensch entscheidet → AO führt aus → Status
zurück), und A und B kommen unabhängig zum gleichen wichtigsten Einzelbefund:

> `POST /api/v1/orchestrators/delegate` spawnt direkt einen Worker und ist kein
> Orchestrator-Aufruf.

C kennt diesen Befund noch nicht — C ist der älteste Stand und wird von A und B
an drei Stellen sachlich korrigiert (§4).

**Kurzurteil:** A ist auf der Agency-Seite belegbar korrekt und direkt umsetzbar.
B ist auf der Prozess- und Risikoseite gründlicher und hat zwei Befunde, die A
komplett fehlen (Lizenz, Worker-Korrelation). B hat dafür einen konkreten
Abbildungsfehler gegenüber der echten Agency-Semantik. Die beiden Dokumente sind
komplementär, nicht konkurrierend.

---

## 2. Was am Quellcode verifiziert wurde

Alle folgenden Angaben stammen aus A §1 und wurden **bestätigt**:

| Aussage | Beleg | Ergebnis |
|---|---|---|
| `JOB_LEASE_MS` = 6 h, `MAX_CONCURRENT_JOBS` = 10 | `lib/job-lifecycle.ts:1-2` | ✅ |
| Kein exklusiver Claim; abgelaufene Running-Jobs kommen mit `reclaimed` zurück | `app/api/agent-jobs/route.ts:42` | ✅ |
| `done/completed`→Done, `done/review`→New, `failed`→erzwingt `blocked`→New | `lib/job-lifecycle.ts` (`resolveTicketOutcome`, `ideaStatusForOutcome`) | ✅ |
| Fehlendes Outcome ⇒ `review` | `resolveTicketOutcome` | ✅ |
| `cardHtml` 80–250 000 Zeichen | `app/api/ideas/route.ts:27,56` | ✅ |
| `agentContext` ≤ 100 000 Zeichen | `app/api/ideas/route.ts:65` | ✅ |
| `result` ≤ 20 000 Zeichen | `app/api/agent-jobs/route.ts:82` | ✅ |
| Klick-`instruction` ≤ 5 000 Zeichen | `app/api/ideas/action/route.ts:20` | ✅ |
| Sanitizer verbietet `script, iframe, object, embed, form, meta, base, link, svg, math` **und `a`**, dazu `on*=`, `javascript:`, `@import`, `url(http…)`, remote `src/poster/srcset` | `app/api/ideas/route.ts:39-45` | ✅ wortgleich |
| Upsert über `dedupeKey` ⇒ `version+1`, `status='new'`, neuer Zeitstempel | `app/api/ideas/route.ts` (ON CONFLICT) | ✅ |
| Blockierte Ersetzung braucht `blockedJobId` + `expectedVersion` + `data-radar-state="blocked"` + **keine** Do-Action; sonst 409 | `lib/blocked-card.ts` | ✅ |
| RISE 4 × 0–25, `score` = Summe, angezeigt `round(impact/2.5)` 0–10, Sortierung Impact→Summe→ID | `lib/rise.ts` | ✅ |
| Auth: Origin **oder** Loopback + `x-radar-local-agent:1` **oder** `x-radar-agent-key` | `app/api/ideas/route.ts:29-36`, identisch in `agent-jobs` | ✅ |
| **`/api/ideas/action` prüft nur `if (origin && origin !== eigener Origin) → 403`** — ein serverseitiger `fetch` ohne Origin kommt durch | `app/api/ideas/action/route.ts:15-16` | ✅ **Risiko R7 ist real** |
| `topics` nur in `db/index.ts`, fehlt im Drizzle-Schema | `db/index.ts:39` vs. `db/schema.ts` | ✅ |
| `ensureDatabase()` idempotent, max. 1×/Minute, „~1,5 s" | `db/index.ts:8-11` (Kommentar wortgleich) | ✅ |
| `install-skill.mjs` überschreibt nie | `scripts/install-skill.mjs:15-22` | ✅ |
| Node ≥ 22.13 | `package.json:6` | ✅ |
| 77 Dateien im Repo | `git ls-files` = 77 | ✅ |
| `/api/tasks` erzeugt Karte `status='working'` **und** Job `action='task'` | `app/api/tasks/route.ts:49-59` | ✅ |
| LINEAR: „no bridge, polling service or automatic two-way sync" | `skills/agency/LINEAR.md:6` | ✅ wortgleich |
| **Keine `LICENSE`-Datei im Repo** (B §8 Phase 0) | Verzeichnislisting | ✅ **B hat recht** |
| `private: true`, Version `0.1.0` | `package.json` | ✅ |
| Build-Script nutzt POSIX-Syntax `WRANGLER_LOG_PATH=… vinext build` (B §9.1: Windows-Fehler) | `package.json:10` | ✅ strukturell bestätigt |

### Zwei kleine Fehler in A

1. **A §1.4** listet „`/api/stats`, `/api/context` | GET". `/api/context` exportiert
   **nur** `POST` (`app/api/context/route.ts:9`). Der aktuelle Brief kommt über
   `/api/state`, nicht über ein `GET /api/context`.
2. **A §5.4** schreibt: „Kein `localhost`-Link in Karten … (Agency-Skill weist
   ausdrücklich darauf hin)". Die Zeichenkette `localhost` kommt in `skills/`
   **nirgends** vor. Der Rat ist richtig, die Quellenangabe ist es nicht.

Beides ändert nichts an der Umsetzbarkeit.

---

## 3. Die echten Unterschiede zwischen A und B

### 3.1 Harte Zahlenwidersprüche (beide unbelegt, AO-Seite)

| # | Gegenstand | A sagt | B sagt | Bewertung |
|---|---|---|---|---|
| D1 | **AO-Nachrichtenlimit** | Brief ≤ **16 KiB** (A §3) | „unter AOs Nachrichtenlimit von **4096 Zeichen**" (B §6.2) | **Faktor 4 auseinander. Der folgenreichste offene Punkt** — er entscheidet, ob der Task-Vertrag inline passt oder als Dateiverweis gehen muss. Vor dem Bau am laufenden Daemon messen. |
| D2 | **Reviewer-Konfiguration** | `codex` / `gpt-5.6-sol`, Effort `high` (aus `~/.ao/data/ao.db`, Projekt `testao`) | Codex / `gpt-5.4`, Effort `xhigh` (aus `ao-standard-setup.ts`) | Wahrscheinlich **kein** Widerspruch, sondern zwei verschiedene Dinge: A liest die **tatsächliche Projektkonfiguration**, B die **Vorlage des Fork-Standard-Setups**. Für die Brücke zählt A. |
| D3 | **Daemon-Zustand bei der Recherche** | `ao status --json` meldete `"state":"stopped"` | `~/.ao/running.json` fehlte, `ao` war nicht im PATH | Vereinbar (gestoppter Daemon schreibt keine `running.json`). Kein Konflikt. |
| D4 | **AO-Port** | `3001`, über `AO_PORT` überschreibbar | zusätzlich: weicht bei Belegung auf einen **ephemeren Port** aus, echter Port steht in `running.json` | B ist vollständiger. A deckt es in Risiko R1 ab („Port stets frisch aus `running.json` lesen"). Nehmen: **B**. |

### 3.2 Architekturunterschiede (beide vertretbar, aber unvereinbar)

| # | Frage | A | B |
|---|---|---|---|
| D5 | **Wer wird angesprochen?** | Pro Karte ein Feld `agentContext.ao.route`: `"worker"` → `delegate`, `"orchestrator"` → `sessions/{id}/send` | **Immer** der echte Orchestrator, bewusst begrenzt auf genau einen Worker je Karte |
| D6 | **Wie findet die Brücke den Worker wieder?** | **Nicht beantwortet.** §5.3 pollt `sessions/{id}`, aber auf dem `orchestrator`-Weg liefert `send` keine Worker-ID zurück | Deterministischer Name `ag-<cardId>`, den der Orchestrator per Auftrag vergeben muss; später echte Task-ID im AO-Domainmodell |
| D7 | **Wo liegt die Zuordnung?** | Eigene `bridge/bridge.db` (SQLite) **außerhalb** beider Repos, Agency bleibt unangetastet | Zwei neue Agency-Tabellen `ao_projects` + `ao_runs`, Drizzle-Migration, neue Routen unter `app/api/ao/`, Settings-Seite |
| D8 | **Projektauswahl** | Konvention genügt: `card.project` = AO-Projekt-ID, ein Agency-Topic je Projekt, Prioritäten in `me.md`. Kein Feature nötig | Echter Projekt-Selector in Agency mit `enabled`, Priorität, Budget, Scan-Bereichen |
| D9 | **Reihenfolge** | Phase 1 Projektspiegel → Phase 2 Brücke → Phase 3 Runner. Durchstich in „1–2 Abenden" | Phase 1 **Pilot ganz ohne Brücke** (Status manuell zurückmelden) mit ausdrücklichem **Abbruchkriterium**, Brücke erst in Phase 2 |
| D10 | **Lizenz** | nicht erwähnt | Phase 0: keine `LICENSE` in Agency, kein öffentlicher Fork vor Klärung |

**Bewertung der Architekturunterschiede:**

- **D6 ist die wichtigste Lücke in A.** A empfiehlt in §9 den `orchestrator`-Weg als
  Default, beschreibt die Zustandsabbildung in §5.3 aber so, als kenne die Brücke
  die Session-ID. Auf dem `delegate`-Weg stimmt das (202 liefert `workerId`), auf dem
  `send`-Weg nicht. B erkennt genau das und liefert mit `ag-<cardId>` eine Antwort —
  samt ehrlicher Obergrenze („reicht für einen Worker, nicht für mehrteilige Pläne").
  **B schließen, A übernehmen.**
- **D7/D10 zusammen sind ein Argument für A.** B empfiehlt in Phase 3 Schema- und
  UI-Änderungen an Agency und warnt im selben Dokument (Phase 0) vor einem
  Agency-Derivat ohne geklärte Lizenz. Für den privaten lokalen Gebrauch ist das
  kein Widerspruch, aber A's Ansatz — Brücke strikt außerhalb beider Repos, nur über
  stabile REST-APIs — umgeht das Problem vollständig und überlebt außerdem
  Upstream-Merges (A, Risiko R10).
- **D9:** B's Reihenfolge ist disziplinierter (erst Nutzenbeweis, dann Technik),
  A's ist schneller am funktionierenden Durchstich. Das ist eine reine
  Temperamentsfrage, kein sachlicher Konflikt.

### 3.3 Ein belegbarer Fehler in B

**B §6.6 (Statusabbildung) ist mit Agency's echter Semantik unvereinbar:**

> | `needs_input`, `no_signal` | `blocked` | Working mit „In AO öffnen"; nicht als erledigt markieren |

In Agency zieht `ticketOutcome: "blocked"` die Karte zwingend nach **New**, nicht
nach Working (`ideaStatusForOutcome`: `blocked → "new"`), und `status: "failed"`
erzwingt seinerseits immer `blocked` (`resolveTicketOutcome`). Eine „Working-Karte
mit Blocker-Anzeige" gibt es nur, solange der Job `running` bleibt und die Karte
gar nicht angefasst wird. Dieselbe Verwechslung steckt in der Zeile darüber
(`pr_open`/`review_pending` → „review" → Working): auch `review` setzt die Karte
auf **New**.

B vermischt hier die eigenen internen `ao_runs.state`-Namen mit Agency's
`ticketOutcome`. **A §5.3 ist an dieser Stelle die korrekte, direkt
implementierbare Tabelle** — einschließlich der Reihenfolge-Regel „erst Job
`failed/blocked` abschließen, **dann** Ersatzkarte pushen, sonst 409", die sich
eins zu eins aus `BLOCKED_CARD_UPDATE_SQL` ergibt.

### 3.4 Was jeweils nur in einem Dokument steht

**Nur in A (und relevant):**
- Sanitizer-Verbot von `<a>` und das Ersatzmuster `data-radar-action="open"` + `data-radar-url` — B erwähnt die HTML-Prüfung nur pauschal. Ohne dieses Wissen scheitert jeder Kartenpush mit 400.
- 80-Zeichen-**Mindestlänge** für `cardHtml`.
- Das Protokoll für blockierte Ersatzkarten inkl. 409-Verhalten.
- Risiko R7 (offener `/api/ideas/action`-Pfad) — verifiziert, und in der Brücke hart zu verbieten.
- Risiko R3 (kosmetische Upserts reißen erledigte Karten zurück in den Stapel).

**Nur in B (und relevant):**
- Lizenzlage von Agency (verifiziert: keine `LICENSE`-Datei).
- Worker-Korrelation als benanntes Kernproblem + Lösungsvorschlag.
- `ao project ls --json` verwirft Pfad und neuere Felder → für den Selector die HTTP-Route nehmen, nicht die CLI-Ausgabe.
- Korrigierte CLI-Syntax (`ao project add --path …`, `ao send --session … --message …`).
- Konkrete Build-/Test-Befunde (Windows-Buildfehler, `npm audit`: 23 Findings, Go-Testlage).
- Prompt-Injection-Grenze: Belege sind Daten, keine Anweisungen.
- Explizites Abbruchkriterium für den Piloten.

---

## 4. Was A und B gemeinsam an C (Codex-Session) korrigieren

| C behauptet | Korrektur | Status |
|---|---|---|
| `ao project add D:\Projects\biomined`, `ao send <id> "<text>"` | Richtig ist `ao project add --path …` bzw. `ao send --session … --message …` (B §4.4) | unbelegt, aber unwidersprochen |
| Statustabelle führt **„Review"** als Agency-Status | Agency-Kartenstatus sind nur `new\|working\|done\|rejected`; `review` ist ein **Job-Outcome**, das die Karte nach New zieht | ✅ verifiziert |
| „Agency sollte die Liste über `ao project ls --json` einlesen" | Die CLI-Projektion verwirft Pfad und neuere Felder; besser direkt `GET /api/v1/projects` (B §4.2, A §5.5) | unbelegt, A und B einig |
| implizit: Auftrag an den Orchestrator ⇒ Orchestrator plant | Gilt nur über `sessions/{id}/send`. Der naheliegende Endpoint `orchestrators/delegate` spawnt direkt einen Worker | A und B unabhängig einig |
| „Eine direkte Änderung am Agent Orchestrator wäre für die erste Version nicht erforderlich" | Bestätigt von beiden | einig |

C's Grundidee, Rollenteilung und Freigabelogik (Merge getrennt, `dedupeKey` als
Idempotenzschlüssel) werden von A und B vollständig getragen. C ist damit als
Ideenquelle intakt, als technische Anleitung überholt.

---

## 5. Empfohlene Zusammenführung

Keines der beiden Dokumente allein reicht. Die tragfähige Kombination:

1. **Agency-Seite: A übernehmen.** §1.6 (Kartenregeln), §5.3 (Zustandsabbildung),
   §5.4 (Kartenfuß ohne `<a>`) sind am Quellcode verifiziert. B's §6.6 nicht verwenden.
2. **Korrelation: B übernehmen.** Genau ein Worker je Karte, deterministischer Name
   `ag-<cardId>`, Erkennung über die Session-API. Das ist die Antwort auf die
   offene Stelle in A §5.2.
3. **Ablage: A übernehmen.** Eigene `bridge.db` außerhalb beider Repos. Vermeidet
   Agency-Schemaänderungen (Lizenz) und Fork-Konflikte (Upstream).
4. **Projektauswahl: A übernehmen, B als Ausbaustufe.** Konvention `card.project` =
   AO-Projekt-ID + Topic je Projekt reicht für den Anfang; B's Selector wird erst
   bei mehreren aktiven Projekten nötig.
5. **Reihenfolge: B übernehmen.** Erst Pilot mit Abbruchkriterium, dann Brücke.
   A's Phasen 1+2 sind dann der Bauplan für B's Phase 2.
6. **Lizenz: B übernehmen.** Vor jeder Veröffentlichung klären; lokal privat halten.

### Vor dem ersten Codezeile zu klären

| # | Frage | Warum blockierend |
|---|---|---|
| 1 | **Nachrichtenlimit von AO: 4096 Zeichen oder 16 KiB?** (D1) | Entscheidet über das Format des Task-Vertrags |
| 2 | Reviewer-Modell: `gpt-5.6-sol/high` oder `gpt-5.4/xhigh`? (D2) | Nur Kosmetik für die Karte, aber die Doku sollte eine Wahrheit haben |
| 3 | Läuft der AO-Daemon dauerhaft (`ao start`) oder nur mit der Desktop-App? | Bestimmt, ob die Brücke als Dienst laufen kann |
| 4 | `testao` ist archiviert — welches reale Repo wird Pilotprojekt? | Ohne das ist kein Durchstich testbar |

Punkte 1–3 lassen sich in wenigen Minuten am laufenden Daemon beantworten
(`GET /api/v1/openapi.yaml`, `GET /api/v1/projects/{id}`).
