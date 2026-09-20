# Agency → Agent Orchestrator

Agency ist der Entscheidungsstapel: Ein Runner untersucht ein Projekt und legt
Vorschläge als Karten vor. Klickst du „Mit AO umsetzen", übergibt die Bridge den
Auftrag an den Orchestrator des passenden AO-Projekts, der genau einen Worker
startet; danach prüft der Reviewer. Zurück kommt eine Karte mit dem geprüften
PR — der Merge ist eine zweite, eigene Entscheidung.

Der Bauplan steht in [`Aufbau-Pipeline.md`](Aufbau-Pipeline.md), der Durchstich
in [`Testlauf-Polnisch-2026-09-19.md`](Testlauf-Polnisch-2026-09-19.md).

## Alltag

```powershell
# morgens: AO-Desktop-App starten (von Hand), dann
pwsh -File D:\agency-orchestrator-bridge\scripts\start-pipeline.ps1

# bei Bedarf: einen Discovery-Lauf über ein Projekt vorbereiten
pwsh -File D:\agency-orchestrator-bridge\scripts\start-runner.ps1 -ProjectId polnisch

# abends
pwsh -File D:\agency-orchestrator-bridge\scripts\start-pipeline.ps1 -Stop
```

`-Status` zeigt, was läuft und welche Projekte freigeschaltet sind.

Der Runner wird bewusst von Hand gestartet: ein Lauf kostete im Test 2,71 $.
`start-runner.ps1` baut den Auftrag und legt ihn in die Zwischenablage — du
fügst ihn in eine AO-Session mit Claude/Opus ein.

## Neues Projekt aufnehmen

1. In AO registrieren:
   `pwsh -File D:\Tools\Agent_Orchestrator\ao-rules\apply-ao-project.ps1 -ProjectId <id> -RepoPath <pfad>`
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
| `laufzeit/` | `bridge.db`, Logs (nicht im Git) |

Agency selbst liegt unverändert in `D:\Tools\Agency\agency` — nur klonen und
`git pull`, kein Fork. Die Bridge spricht ausschließlich die lokale API.

## Die zwei Freigaben

`pipeline.json` ist die einzige Freigabequelle:

- `analysieren: true` → der Runner darf dort Karten suchen
- `umsetzen: true` → die Bridge darf Aufträge für dieses Projekt an AO geben

Neue Projekte stehen auf `false`. Verschwindet ein Projekt aus AO, bleibt sein
Eintrag stehen und bekommt `nichtMehrInAo` — gelöscht wird nie etwas.

## Schalter

Alles hat brauchbare Vorgaben; diese hier ändern das Verhalten wirklich:

| Variable | Vorgabe | Wirkung |
|---|---|---|
| `BRIDGE_ALLOW_MERGE` | an | `0` schaltet den Merge-Weg der Bridge ganz ab |
| `BRIDGE_REQUIRE_GREEN_CI` | aus | `1` verlangt einen **grünen** Check statt nur „nicht rot" — erst einschalten, wenn jedes freigeschaltete Projekt eine CI hat |
| `BRIDGE_SYNC_MS` | 300000 | Takt des Projektabgleichs |
| `BRIDGE_POLL_MS` | 15000 | Takt für Jobs und laufende Aufträge |
| `BRIDGE_WORKER_TIMEOUT_MIN` | 15 | ab wann ein Auftrag ohne Worker als blockiert gilt |
| `BRIDGE_MAX_REVIEW_CYCLES` | 3 | ab wie vielen Änderungsrunden abgebrochen wird |

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
cd D:\agency-orchestrator-bridge\bridge
npm test        # 68 Tests
```
