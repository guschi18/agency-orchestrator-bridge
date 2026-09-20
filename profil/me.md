# me.md

Gilt immer, für jeden Lauf. Was ein einzelnes Projekt angeht, steht in
`profil/projekte/<projektId>.md`; welche Projekte aktiv sind, steht in
`profil/pipeline.json`.

Die Kurzfassung dieser Datei steht als „Dream" in Agency (Settings → My dream).
Beides ist dieselbe Aussage — ändert sich eine Seite, zieht die andere nach.
**Nichts Projektspezifisches gehört hierher oder in den Dream**: beide gelten
für alle Projekte und wären beim nächsten Projekt falsch.

## Wer
Solo-Entwickler, Deutsch. Baut private Tools und Lern-Apps, meist Node und
Vanilla-Web. Arbeitet allein, ohne Team und ohne Deadline von außen.

## Sprache der Karten
Deutsch, kurze vollständige Sätze. Keine Anglizismen, wo ein deutsches Wort
passt. Keine Füllwörter, keine Werbesprache, keine Ausrufezeichen. Eine Karte
sagt zuerst, was zu entscheiden ist, dann warum.

## Wie ich entscheide
- Ich will Karten, die eine Entscheidung verlangen, keine Statusmeldungen.
- Belege aus dem Repo statt Vermutungen. Was du nicht prüfen konntest, sagst du.
- Lieber zwei gute Karten als drei, von denen eine schwach ist.
- Eine Karte muss in **einen** kleinen, testbaren PR passen.
- Unsicherheit gehört auf die Karte, nicht weggelassen.

## Ausführung
Code-Arbeit läuft **nie** direkt im Terminal, sondern immer über den Agent
Orchestrator (AO). Jede Coding-Karte setzt in `agentContext.ao`:

- `projectId`: exakt die ID aus `profil/ao-projects.json` — nie raten.
- `action`: `"implement"`
- `route`: `"orchestrator"`
- `task`: `{ objective, evidence[], acceptanceCriteria[], constraints[] }`,
  knapp, zusammen unter 2500 Zeichen.

`card.project` und `card.category` = dieselbe Projekt-ID.

Die Do-Aktion heißt „Mit AO umsetzen" und erklärt in einem Satz, was passiert:
AO plant, genau ein Worker setzt um, der Reviewer prüft, es entsteht ein PR —
**kein Merge**. Der Merge ist eine zweite, eigene Entscheidung auf einer eigenen
Karte.

## Grenzen
- Im Projektordner nur **lesen**. Keine Dateien ändern, nichts committen,
  nichts pushen. Das macht ausschließlich ein AO-Worker nach meiner Freigabe.
- Keine Secrets lesen oder in Karten schreiben. `.env` ist tabu.
- Keine externen Dienste aufrufen, keine Daten nach außen geben.
- Nur Projekte untersuchen, die in `pipeline.json` auf `analysieren: true`
  stehen.

## Karten-HTML
Kein `<a>`, `<script>`, `<svg>`, keine Event-Handler, keine externen Bilder.
Links nur als `<button data-radar-action="open" data-radar-url="…">`.
