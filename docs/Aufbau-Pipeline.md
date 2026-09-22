# Aufbau der Pipeline Agency → Agent Orchestrator

**Stand:** 2026-09-20 · **Grundlage:** `Arbeitsdokument-Agency-AO-Bridge.md` (Entwurf) und `Testlauf-Polnisch-2026-09-19.md` (bestandener Durchstich)
**Erstes Projekt:** `polnisch` → `D:\Polnisch` (Repo `guschi18/polnisch-app`)
**Alle Entscheidungen sind getroffen** (§8). Dieses Dokument ist als Bauauftrag gedacht; der Arbeitsauftrag für einen neuen Agenten steht in §9.

Dieses Dokument beschreibt, wie wir vom erfolgreichen Sandbox-Test zum Alltagsbetrieb kommen: welche Teile wo liegen, wie neu registrierte AO-Projekte automatisch in Agency auftauchen, und wie die Ziele je Projekt beschrieben werden.

---

## 1. Das Bild in drei Sätzen

Agency ist dein Entscheidungsstapel: Ein Agent untersucht deine Projekte und legt dir fertige Vorschläge als Karten vor. Klickst du „Mit AO umsetzen", übergibt die Bridge den Auftrag an den Orchestrator des passenden AO-Projekts, der genau einen Worker startet; danach prüft der Reviewer. Zurück kommt eine Karte mit dem geprüften PR — der Merge bleibt eine zweite, eigene Entscheidung.

**Kein Fork von Agency.** Agency hat bis heute keine Lizenz, und es ist auch nicht nötig: Die Bridge spricht nur die lokale API, und `me.md`, `agent-work/` sowie die Datenbank stehen bereits in Agencys `.gitignore`. Ein einfacher Klon reicht, Updates holst du mit `git pull`.

---

## 2. Ordnerstruktur

```
D:\Tools\Agency-AO\Agency\            Agency-Klon (unverändert, nur git pull)
D:\Tools\Agency-AO\agency-orchestrator-bridge\     unser Repo
  bridge\                          die Bridge (fertig, 33 Tests grün)
  profil\                          dein Profil für den Runner
    me.md                          wer du bist, Regeln, Sprache, Ausführung
    projekte\<projektId>.md        Ziele und Quellen je Projekt
    ao-projects.json               Spiegel des AO-Registers (erzeugt, nicht von Hand pflegen)
    pipeline.json                  je Projekt: analysieren? umsetzen dürfen?
  scripts\
    start-pipeline.ps1             startet alles
    sync-projects.ps1              nur den Projektabgleich (wird auch automatisch aufgerufen)
  laufzeit\                        bridge.db, Logs (nicht im Git)
```

AO selbst bleibt unangetastet, bis auf den bereits umgesetzten Kanban-Fix in deinem Fork (`FORK-CHANGES.md`).

---

## 3. Der Projekt-Abgleich (dein Hauptanliegen)

**Problem:** Du registrierst laufend neue Projekte in AO. Agency kennt keine Projekte, sondern nur ein freies Textfeld und „Lanes". Niemand soll das doppelt pflegen.

**Lösung: AO ist die einzige Wahrheit, der Abgleich läuft automatisch.**

Die Bridge fragt alle 5 Minuten `GET /api/v1/projects` bei AO ab und schreibt drei Dinge fort:

1. **`profil\ao-projects.json`** — die Liste, aus der der Runner Projekt-ID, Pfad und Typ liest. Er rät nie einen Pfad.
2. **Eine Agency-Lane je Projekt** (`POST /api/topics`), damit du in Agency nach Projekt filtern kannst.
3. **`profil\pipeline.json`** — bekommt für jedes neue AO-Projekt automatisch einen Eintrag:

```json
{
  "polnisch":   { "analysieren": true,  "umsetzen": true,  "prioritaet": 90, "maxKarten": 3 },
  "neues-repo": { "analysieren": false, "umsetzen": false, "prioritaet": 50, "maxKarten": 3 }
}
```

**Neue Projekte stehen absichtlich auf `false`.** Sonst würde ein frisch registriertes Repo sofort untersucht und könnte Aufträge bekommen — ein Tippfehler bei der Registrierung hätte dann echte Folgen. Du schaltest ein Projekt mit zwei Werten frei:

- `analysieren: true` → der Runner darf dort Karten suchen
- `umsetzen: true` → die Bridge darf Aufträge für dieses Projekt an AO geben

Verschwindet ein Projekt aus AO, bleibt sein Eintrag stehen und wird als „nicht mehr in AO" markiert; gelöscht wird nichts automatisch.

**Was das für dich heißt:** neues Projekt in AO registrieren (wie gewohnt mit `apply-ao-project.ps1`), einmal `pipeline.json` öffnen, zwei Werte auf `true` setzen, Ziele in `profil\projekte\<id>.md` eintragen. Alles andere passiert von selbst.

---

## 4. Die `me.md`-Frage: eine globale Datei plus eine je Projekt

Agencys Skill liest **eine** Profildatei. Alles in eine Datei zu packen wird bei mehreren Projekten unübersichtlich, und der Runner bekäme bei jedem Lauf Ziele zu lesen, die ihn gerade nichts angehen.

**Aufteilung:**

**`profil\me.md`** — gilt immer, bleibt kurz:
- wer du bist, Sprache der Karten (Deutsch), wie du Entscheidungen triffst
- die Ausführungsregel: Code-Arbeit läuft nie direkt im Terminal, sondern immer über AO; jede Coding-Karte setzt `agentContext.ao`
- was verboten ist: keine Secrets lesen, im Projektordner nur lesen, nichts committen
- Verweis: „Ziele und Quellen je Projekt stehen in `profil/projekte/<projektId>.md`; welche Projekte aktiv sind, steht in `pipeline.json`."

**`profil\projekte\<projektId>.md`** — je Projekt, das Interessante:

```markdown
# polnisch

**Was das ist:** Szlak, eine Übungs-App für Polnisch (Node, Vanilla-Web, `node --test`).

## Ziel in diesem Quartal
Verlässlicher Inhalt: keine ungeprüften Sätze mehr im Kurs.

## Wonach suchen
- Inhaltsfehler und ungeprüfte generierte Sätze
- kaputte oder fehlende Tests
- Reibung im Lernablauf, die Nutzer merken

## Wonach nicht suchen
- Design-Umbauten, Refactorings ohne Anlass, neue Abhängigkeiten

## Quellen
Code, `test/`, `docs/`, `brainstorms/`, `.scratch/`, git log der letzten 4 Wochen

## Grenzen
Keine Änderungen an Einheiten-JSON oder Audio ohne ausdrückliche Karte.
```

Der Sync legt für jedes freigeschaltete Projekt automatisch eine solche Datei mit diesen Überschriften an, wenn sie fehlt — du füllst nur die Inhalte. Der Runner bekommt beim Start gesagt, welche Projektdateien er lesen soll.

**Runner je Projekt, nicht für alle auf einmal.** Ein Lauf untersucht ein Projekt, mit dessen Projektdatei und dessen Kartenbudget. Das hält die Karten scharf und die Kosten übersichtlich (im Test: 2,71 $ für einen Lauf über ein Projekt).

---

## 5. Die Schritte

### Schritt 1 — Agency dauerhaft installieren (ca. 10 Min)

```powershell
cd D:\Tools\Agency-AO
git clone https://github.com/browser-use/agency.git Agency
cd Agency; npm ci
```

Nicht `npm run dev` benutzen: Das Skript nutzt POSIX-Syntax und scheitert unter Windows. Das Startskript aus Schritt 3 setzt die Umgebungsvariable selbst.

**Fertig, wenn:** `http://localhost:3100` den leeren Feed zeigt.

### Schritt 2 — Profil und Bridge-Konfiguration anlegen (ca. 15 Min)

- `profil\me.md` aus der Vorlage schreiben (Abschnitt 4).
- `sync-projects` einmal laufen lassen → `ao-projects.json`, `pipeline.json` und Lanes entstehen.
- In `pipeline.json` die ersten Projekte freischalten.

**Fertig, wenn:** in Agency für jedes AO-Projekt eine Lane existiert und `pipeline.json` deine Auswahl enthält.

### Schritt 3 — Startskript (ca. 30 Min, baue ich)

`scripts\start-pipeline.ps1` erledigt der Reihe nach:

1. prüft, ob die AO-Desktop-App läuft (`~/.ao/running.json` und Prozess); wenn nicht, klare Meldung — die App startest du selbst
2. startet Agency auf Port 3100, wartet, bis die API antwortet
3. führt den Projektabgleich aus
4. startet die Bridge mit `profil\pipeline.json` und Logs nach `laufzeit\`
5. öffnet `http://localhost:3100` im Browser
6. `-Stop` beendet Agency und Bridge wieder sauber

Die Bridge macht den Projektabgleich danach selbst alle 5 Minuten — du musst nach dem Registrieren eines Projekts nichts neu starten.

**Fertig, wenn:** ein Aufruf reicht, um den ganzen Stapel hochzufahren, und `-Stop` nichts Laufendes zurücklässt.

### Schritt 4 — Erstes Projekt: `polnisch` (`D:\Polnisch`)

```powershell
pwsh -File D:\Tools\Agency-AO\Agent_Orchestrator\ao-rules\apply-ao-project.ps1 -ProjectId polnisch -RepoPath D:\Polnisch
```

Das setzt gleich dein Standard-Setup: Claude/Opus als Orchestrator, OpenCode/GLM als Worker, Codex als Reviewer, Auto-Review an.

**Drei Dinge, die du vorher wissen musst:**

1. **Das Skript ändert dein echtes Repo.** Es schreibt `.claude/settings.json` und `opencode.json` (Effort-Einstellungen, die AO selbst nicht setzen kann), committet genau diese zwei Dateien und pusht sie nach `origin/main`. Das ist nötig, weil AO die Worker-Worktrees aus `origin/<Default-Branch>` baut. Mit `-DryRun` siehst du es vorher, mit `-SkipAgentConfig` lässt du es weg (dann läuft der Worker aber auf der niedrigsten Effort-Stufe).
2. **Worker öffnen echte PRs in `guschi18/polnisch-app`.** Branches heißen `ao/<session-id>/<thema>`. Gemergt wird nur, was du in Agency freigibst.
3. **`.env` bleibt außen vor.** Sie ist nicht eingecheckt, fehlt also in jedem Worker-Worktree. `npm test` (228 Tests) und `npm run check-content` laufen ohne sie; alles, was Supabase braucht, kann ein Worker nicht prüfen. Das gehört in die Projektdatei unter „Grenzen".

Danach in `pipeline.json` freischalten (`analysieren: true`, `umsetzen: true`) und `profil\projekte\polnisch.md` füllen — Vorlage siehe §4, die Inhalte aus dem Testlauf (Ziel: verlässlicher Inhalt, Quellen: Code, `test/`, `docs/`, `brainstorms/`, `.scratch/`, git log) passen bereits.

**Bei Kopien eines Repos immer `git remote -v` prüfen.** Ein Klon eines lokalen Ordners zeigt auf das Original — der Worker würde dorthin pushen.

### Schritt 5 — Tests automatisch laufen lassen (ca. 10 Min je Projekt)

Der AO-Reviewer darf laut seinem Prompt keine Tests ausführen. Ohne CI behauptet also nur der Worker selbst, dass alles grün ist. Deshalb je Projekt eine kleine GitHub-Action:

```yaml
name: tests
on: pull_request
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npm test
```

Danach stellen wir die Bridge scharf: Sie gibt eine Karte erst frei, wenn CI **grün** ist, statt nur „nicht rot".

**Fertig, wenn:** ein PR im Projekt einen grünen Check zeigt und AO `ci: passing` meldet.

### Schritt 6 — AO-Desktop neu bauen (ca. 20 Min, dein Fork-Update-Weg)

Damit der Kanban-Fix greift: „Ready/Mergeable" erscheint erst, wenn der Auto-Review freigegeben hat. Ohne Neubau zeigt die App weiter zu früh „Mergeable" — die Bridge ist davon nicht betroffen, sie liest ohnehin die Review-Urteile.

### Schritt 7 — Erster echter Lauf (Projekt `polnisch`)

1. Runner für das Projekt starten (als AO-Standalone-Session, Claude/Opus) — manuell, siehe §8.
2. Karten **nur ansehen**. Taugen sie nichts, zuerst die Projektdatei schärfen — nicht die Technik ändern.
3. Eine Karte freigeben, Ablauf beobachten (im Test: 19 Minuten bis zum geprüften PR).
4. Merge selbst entscheiden.

**Abbruchkriterium:** Sind die meisten Karten unbrauchbar oder doppelt, bauen wir nichts weiter aus, sondern verbessern Ziele und Quellen.

---

## 6. Alltag, wenn alles steht

| Wann | Was |
|---|---|
| morgens | AO-App starten, `start-pipeline.ps1` aufrufen |
| bei Bedarf | Runner für ein Projekt starten („untersuche polnisch, höchstens 3 Karten") |
| laufend | Karten ansehen, freigeben oder ablehnen; die Bridge macht den Rest |
| nach dem Review | Merge-Karte prüfen: Dateien, Review-Verlauf, dann mergen oder ablehnen |
| neues Projekt | in AO registrieren, in `pipeline.json` freischalten, Projektdatei füllen |

---

## 7. Was noch zu bauen ist

| # | Aufgabe | Aufwand |
|---|---|---|
| A1 | Projektabgleich erweitern: `pipeline.json` pflegen, Projektdateien anlegen, alle 5 Minuten in der Bridge laufen | 1 h |
| A2 | Bridge liest Freigaben aus `pipeline.json` statt aus einer Umgebungsvariablen | 30 Min |
| A3 | `start-pipeline.ps1` inklusive `-Stop` | 45 Min |
| A4 | Runner-Start als kleines Skript mit Projektdatei und Kartenbudget | 30 Min |
| A5 | CI-Regel in der Bridge verschärfen, sobald die Action steht: `ci = passing` verlangen statt „nicht rot" | 20 Min |
| A6 | Merge-Weg der Bridge scharfstellen (heute per `BRIDGE_ALLOW_MERGE` aus), mit Live-Recheck vor dem Merge | 30 Min |

---

## 8. Getroffene Entscheidungen

| # | Frage | Entscheidung |
|---|---|---|
| 1 | Erstes Projekt | **`polnisch` → `D:\Polnisch`** (Repo `guschi18/polnisch-app`) |
| 2 | Merge über Agency | **Erlaubt**, aber nur nach Live-Recheck: gleicher Head wie beim Review, CI grün, keine offenen Review-Threads, PR mergebar, AO-Review mit `approved` für genau diesen Head. Scheitert eine Bedingung, wird der Job blockiert und die Karte sagt warum. Merge passiert **nie** ohne deinen Klick auf die Merge-Karte |
| 3 | Runner-Takt | **Manuell** je Projekt starten. Kein Zeitplan, solange die Kartenqualität nicht bewiesen ist (ein Lauf kostete im Test 2,71 $). Automatik ist später eine Konfigurationsfrage, kein Umbau |
| 4 | Sandbox | **Behalten** (`D:\Sandbox_Agency_AO`, Repo `guschi18/polnisch-sandbox` mit offenem PR #1) — Übungsumgebung für Änderungen an der Bridge, ohne echte Projekte zu berühren |
| 5 | Commits | **Beide Repos committen, ohne Push**: `agency-orchestrator-bridge` (Bridge + Dokumente), AO-Fork (`kanban.go`, `kanban_test.go`, `FORK-CHANGES.md`) |

---

## 9. Auftrag an den bauenden Agenten

**Ziel:** A1 bis A6 aus §7 umsetzen, danach Schritt 1 bis 4 ausführen, sodass der Nutzer nur noch den Runner startet.

**Vorgaben, die nicht zur Diskussion stehen:**

- Agency wird **nicht** geändert und **nicht** geforkt; nur klonen und per API ansprechen. Kein Schreiben in Agencys Datenbank.
- Der AO-Fork wird nur dort angefasst, wo `FORK-CHANGES.md` es beschreibt. Nie direkt in `~/.ao/data/ao.db` schreiben — ausschließlich REST-API.
- Beide Dienste sind unauthentifiziert auf Loopback. Die Bridge darf nur `127.0.0.1`/`localhost` ansprechen, nie `0.0.0.0`, keine Tunnel.
- Die Bridge ruft **niemals** `/api/ideas/action` auf. Freigaben kommen ausschließlich vom Menschen.
- Ein Auftrag erzeugt genau einen Worker mit Namen `ag-<jobId>`. Vor jedem Versand prüfen, ob dieser Worker schon existiert.
- Reihenfolge bei Blockern: erst den Agency-Job `failed/blocked` abschließen, dann die Ersatzkarte mit `blockedJobId` und frisch gelesener `expectedVersion` pushen — sonst `409`.
- Karten-HTML: kein `<a>`, `<script>`, `<svg>`, keine Event-Handler, keine externen Bilder. Links nur als `data-radar-action="open"`.
- Eine Karten-Aktualisierung mit gleichem `dedupeKey` setzt die Karte zurück auf „New" und erhöht `version`. Keine kosmetischen Updates.
- Keine Secrets in Karten, Jobtexten, Logs oder `bridge.db`.
- Jede neue Logik bekommt einen Test in `bridge/test/`. `node --test "test/*.test.mjs"` muss grün bleiben (aktuell 33 Tests).

**Reihenfolge der Arbeit:**

1. A2 + A1: `pipeline.json` als Freigabequelle, Projektabgleich in der Bridge-Schleife (alle 5 Min), Projektdateien anlegen.
2. A3: `start-pipeline.ps1` mit `-Stop`.
3. A6: Merge-Weg scharfstellen (Entscheidung 2), mit Tests für jede abgelehnte Bedingung.
4. Schritt 1–4 ausführen: Agency installieren, Profil anlegen, `polnisch` registrieren, freischalten.
5. A4: Runner-Startskript.
6. A5 erst, wenn die GitHub-Action (Schritt 5) in `polnisch-app` läuft.

**Testumgebung:** Änderungen an der Bridge zuerst in der Sandbox prüfen (`D:\Sandbox_Agency_AO`, AO-Daemon mit `ao daemon` und eigenem `AO_DATA_DIR`/`AO_RUN_FILE`/`AO_PORT=3201`, Repo `polnisch-sandbox`). Erst danach gegen die echte AO-App laufen lassen.

**Abnahme:**

- `start-pipeline.ps1` fährt Agency und Bridge hoch, `-Stop` lässt nichts laufen.
- Ein neu in AO registriertes Projekt taucht binnen 5 Minuten in `ao-projects.json` und als Agency-Lane auf, steht aber auf `analysieren: false`.
- Ein Runner-Lauf über `polnisch` erzeugt Karten mit korrekter `projectId`.
- Eine Freigabe erzeugt genau einen Worker, einen PR und am Ende eine Merge-Karte mit Dateiliste.
- Ein Klick auf „Mergen" merged nur bei erfüllten Bedingungen, sonst blockiert er mit klarem Grund.
- Bridge-Tests grün; `D:\Polnisch` enthält außer den Agent-Einstellungsdateien keine Änderungen, die nicht aus einem freigegebenen PR stammen.
