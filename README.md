# Agency → Agent Orchestrator

Agency ist der Entscheidungsstapel: Ein Runner untersucht ein Projekt und legt
Vorschläge als Karten vor. Klickst du „Mit AO umsetzen", übergibt die Bridge den
Auftrag an den Orchestrator des passenden AO-Projekts, der genau einen Worker
startet; danach prüft der Reviewer. Zurück kommt eine Karte mit dem geprüften
PR — der Merge ist eine zweite, eigene Entscheidung.

```
Agency-Karte ──[Freigabe]──▶ Bridge ──▶ AO-Orchestrator (plant)
    ──▶ Worker (implementiert, eigener Branch) ──▶ Reviewer (prüft)
    ──▶ PR-Karte ──[Merge-Freigabe + Live-Recheck]──▶ Squash-Merge
```

Der Bauplan steht in [`docs/Aufbau-Pipeline.md`](docs/Aufbau-Pipeline.md), der
Durchstich in [`docs/Testlauf-Polnisch-2026-09-19.md`](docs/Testlauf-Polnisch-2026-09-19.md).

## Alltag

```powershell
# morgens: AO-Desktop-App starten (von Hand), dann
pwsh -File D:\Tools\Agency-AO\agency-orchestrator-bridge\scripts\start-pipeline.ps1

# abends
pwsh -File D:\Tools\Agency-AO\agency-orchestrator-bridge\scripts\start-pipeline.ps1 -Stop
```

`-Status` zeigt, was läuft und welche Projekte freigeschaltet sind.

## Einen Discovery-Lauf starten

Für jedes Projekt mit `analysieren: true` liegt im Feed eine Karte
**„Neue Vorschläge für &lt;projekt&gt; suchen"**. Ein Klick auf „Runner starten"
genügt: Die Bridge erhebt zuerst die Repo-Karte (ohne Modell) und startet dann
genau einen Runner (Claude/Sonnet), der das Projekt nur lesend untersucht und
seine Karten in dieselbe Lane pusht.

Der Lauf bleibt damit deine Entscheidung — ein Klick, kein Zeitplan. Der erste
gemessene Lauf kostete 2,71 $; seit Sonnet, Repo-Karte und schlankem Präfix
liegt die Hochrechnung bei rund 0,45 $. Die Karte nennt beides. Ein zweiter
Klick auf dieselbe Karte startet keinen zweiten Lauf.

Den Knopf abschalten: `analysieren: false` in `pipeline.json`. Dann verschwindet
die Karte beim nächsten Abgleich.

Ohne Browser geht es weiter per Skript — derselbe Auftragstext, nur zum
Selbsteinfügen in eine AO-Session:

```powershell
pwsh -File D:\Tools\Agency-AO\agency-orchestrator-bridge\scripts\start-runner.ps1 -ProjectId polnisch
```

## Neues Projekt aufnehmen

1. In AO registrieren:
   `pwsh -File D:\Tools\Agency-AO\Agent_Orchestrator\ao-rules\apply-ao-project.ps1 -ProjectId <id> -RepoPath <pfad>`
   Danach in AO prüfen, dass `defaultBranch` stimmt — AO rät hier manchmal
   falsch, wenn im Remote noch ein alter `master` liegt.
2. Warten (höchstens 5 Minuten) oder `-Stop`/Start. Das Projekt steht dann in
   `profil/pipeline.json` — auf `false`, absichtlich.
3. `analysieren` und `umsetzen` auf `true` setzen.
4. `profil/projekte/<id>.md` füllen. Der Abgleich legt die Vorlage an.
5. Eine CI-Action ins Projekt legen (siehe `Aufbau-Pipeline.md` §5 Schritt 5),
   sonst prüft niemand außer dem Worker selbst, ob die Tests grün sind.

## Ordner

| Pfad | Was |
|---|---|
| `bridge/` | die Bridge (Node, ohne Abhängigkeiten) |
| `profil/me.md` | gilt immer: wer du bist, Sprache, Ausführungsregel, Grenzen |
| `profil/projekte/<id>.md` | Ziele, Quellen und Grenzen je Projekt |
| `profil/pipeline.json` | je Projekt: `analysieren`, `umsetzen`, `prioritaet`, `maxKarten` |
| `profil/ao-projects.json` | Spiegel des AO-Registers (erzeugt, nicht von Hand pflegen) |
| `scripts/` | `start-pipeline.ps1`, `start-runner.ps1` |
| `profil/karten-beispiel/` | fertige Beispielkarte — erspart dem Runner das Lesen von Agencys Quellcode |
| `laufzeit/` | `bridge.db`, Repo-Karten, Runner-Protokolle, Logs (nicht im Git) |

Agency selbst liegt unverändert in `D:\Tools\Agency-AO\Agency` — nur klonen und
`git pull`, kein Fork. Die Bridge spricht ausschließlich die lokale API.

## Die Freigaben je Projekt

`pipeline.json` ist die einzige Freigabequelle:

- `analysieren: true` → der Runner darf dort Karten suchen
- `umsetzen: true` → die Bridge darf Aufträge für dieses Projekt an AO geben
- `ciGruenVerlangen: true` → eine Karte wird erst fertig und ein Merge erst
  erlaubt, wenn die CI **grün** ist, statt nur „nicht rot". Nur einschalten,
  wenn das Projekt eine GitHub-Action hat: ohne Action meldet AO dauerhaft
  `unknown`, und nichts käme mehr durch

Neue Projekte stehen auf `false`. Verschwindet ein Projekt aus AO, bleibt sein
Eintrag stehen und bekommt `nichtMehrInAo` — gelöscht wird nie etwas.

## Schalter

Alles hat brauchbare Vorgaben; diese hier ändern das Verhalten wirklich:

| Variable | Vorgabe | Wirkung |
|---|---|---|
| `BRIDGE_ALLOW_MERGE` | an | `0` schaltet den Merge-Weg der Bridge ganz ab |
| `BRIDGE_FOREIGN_PR_CARDS` | an | `0` schaltet die Hinweiskarten für PRs ohne AO-Auftrag ab |
| `BRIDGE_SYNC_MS` | 300000 | Takt des Projektabgleichs |
| `BRIDGE_POLL_MS` | 15000 | Takt für Jobs und laufende Aufträge |
| `BRIDGE_WORKER_TIMEOUT_MIN` | 15 | ab wann ein Auftrag ohne Worker als blockiert gilt |
| `BRIDGE_MAX_REVIEW_CYCLES` | 3 | ab wie vielen Änderungsrunden abgebrochen wird |
| `BRIDGE_RUNNER_MODEL` | `claude-sonnet-5` | Modell des Discovery-Runners |
| `BRIDGE_RUNNER_MODE` | `lokal` | `ao` startet den Runner wieder als AO-Session (siehe unten) |
| `BRIDGE_CLAUDE_BIN` | aus `PATH` | Pfad zu `claude`, falls die Suche danebengreift |
| `AGENCY_PATH` | `D:\Tools\Agency-AO\Agency` | Agency-Klon, auf dessen Skill der Runner-Auftrag zeigt |

## Die drei Karten-Aktionen

Jede Karte trägt in `agentContext.ao.action`, was ein Klick auslöst. Mehr als
diese drei kennt die Bridge nicht:

| `action` | Knopf | Was passiert | Freigabe |
|---|---|---|---|
| `discover` | Runner starten | ein Runner liest das Projekt und legt Karten vor | `analysieren` |
| `implement` | Mit AO umsetzen | Orchestrator plant, **ein** Worker setzt um, Reviewer prüft, PR entsteht | `umsetzen` |
| `merge` | Mergen | Live-Recheck aller Bedingungen, dann Squash-Merge | `umsetzen` |
| `acknowledge` | Gesehen | hakt eine Hinweiskarte ab, löst nichts aus | — |

`discover` verlangt nur `analysieren`: der Lauf liest, er verändert nichts.
Eine Aktion, die hier nicht steht, wird sichtbar blockiert statt still ausgeführt.

## PRs, die nicht aus einer Karte stammen

Legst du (oder sonst jemand) einen Pull Request von Hand an, weiß der Stapel
nichts davon. Deshalb fragt der Abgleich je freigeschaltetem Projekt die offenen
PRs ab und legt für jeden, der **nicht** aus einem AO-Auftrag stammt, genau
einmal eine Hinweiskarte: Titel, Branch, Umfang, CI-Stand, Link.

Woran die Bridge „fremd" erkennt: der Branch liegt nicht im `ao/`-Namensraum
**und** die Bridge kennt den PR nicht aus einem eigenen Lauf.

Diese Karten haben **keinen Merge-Knopf**. Der Merge-Weg verlangt ein AO-Review
für genau diesen Commit, und das gibt es ohne AO-Auftrag nicht — du entscheidest
auf GitHub und hakst die Karte mit „Gesehen" ab. Abgehakt heißt endgültig: die
Karte wird nie erneut gelegt.

Quelle ist die `gh`-CLI als Unterprozess, nicht die GitHub-API: `gh` ist schon
angemeldet, die Bridge braucht also **kein Token** und speichert keines. Fehlt
`gh`, wird das geloggt und der Abgleich läuft weiter. Abschalten mit
`BRIDGE_FOREIGN_PR_CARDS=0`.

## Warum der Runner nicht über AO läuft

Ein Discovery-Lauf kostete im Testlauf 2,1 Millionen Token. Zwei Drittel davon
waren Ballast: ein Präfix aus Skill-Liste, MCP-Instruktionen und Subagent-Liste,
das 27-mal mitgelesen wurde, und sechs Turns, in denen der Runner sich einen
Überblick über das Repo verschaffte (`docs/Token-Analyse-Testlauf-2026-09-19.md`).

Dagegen hilft nur die Kommandozeile von `claude` — und an die kommt man über AO
nicht heran. `POST /sessions` nimmt `projectId`, `kind`, `harness`, `model`,
`prompt` und `displayName`, mehr nicht; `LaunchConfig.DisallowedTools` setzt in
AO ausschließlich der Reviewer-Adapter, und ein Env-Feld hat `LaunchConfig` gar
nicht. Deshalb startet die Bridge den Runner selbst:

| Was | Wofür |
|---|---|
| `--disable-slash-commands` | keine Skill-Liste im Präfix (im Testlauf 7.222 Token) |
| `--strict-mcp-config` | kein MCP-Server (1.173 Token) und kein Cache-Abriss, wenn einer sich nachträglich verbindet |
| `--disallowed-tools` | der Runner kann nicht schreiben, nicht committen, nicht löschen |
| `--allowed-tools` | `--print` kann nicht nachfragen; was er braucht, steht ausdrücklich da |
| Repo-Karte | `laufzeit\repo-map-<projekt>.md`, von der Bridge ohne Modell erhoben: Dateibaum, Zeilenzahlen, Tests, Commits, Ungetracktes |

Gemessen an einem Probelauf: Präfix 13.227 statt 31.487 Token.

Der Runner braucht von AO nichts — keinen Branch, keinen PR, keinen
Orchestrator. Er läuft in `laufzeit\runner-cwd\<projekt>`, liest das Projekt
über `--add-dir` und schreibt sein Protokoll nach `laufzeit\runner-<projekt>.log`.
Ein zweiter Klick prüft, ob der vermerkte Prozess noch lebt.

**`BRIDGE_RUNNER_MODE=ao`** schaltet auf den alten Weg zurück: eine AO-Session,
in der App sichtbar und in AOs Verbrauchszahlen erfasst — aber ohne die
Kommandozeile und damit mit dem vollen Präfix. Nebenwirkung dort: AO legt für
die Session einen Branch `ao/<session-id>/root` im Projekt an; der Worktree
liegt in `~/.ao/data/worktrees/`, im Repo bleibt nur der Branch-Eintrag.

## Was die Bridge nie tut

- `/api/ideas/action` aufrufen. Freigaben kommen ausschließlich von dir.
- Einen zweiten Worker für denselben Auftrag starten (`ag-<jobId>`, vorher geprüft).
- Mergen, ohne unmittelbar davor jede Bedingung erneut gegen den echten Stand
  zu prüfen: gleicher Head wie beim Review, CI nicht rot, keine offenen
  Review-Threads, PR mergebar, AO-Review `approved` für genau diesen Head.
  Scheitert eine, wird der Job blockiert und die Karte sagt warum.
- Etwas anderes als `127.0.0.1`/`localhost` ansprechen.
- In AOs oder Agencys Datenbank schreiben.

## Tests

```powershell
cd D:\Tools\Agency-AO\agency-orchestrator-bridge\bridge
npm test        # 135 Tests
```
