# polnisch

**Was das ist:** Szlak, eine Übungs-App für Polnisch. Node, Vanilla-Web,
Tests mit `node --test` (228 Stück, grün). Repo `guschi18/polnisch-app`,
Ordner `D:/Polnisch`, Default-Branch `main`.

## Ziel
**Ich will mit dieser App einfach und schnell Polnisch lernen.** Alles wird
daran gemessen, ob es mich schneller zum freien Sprechen bringt.

Daraus folgt die Reihenfolge, in der Befunde zählen:

1. **Verlässlicher Inhalt.** Ein falscher Satz lehrt mir etwas Falsches — das
   ist teurer als jede fehlende Funktion. Keine ungeprüften Sätze im Kurs.
2. **Kein Bruch im Lernablauf.** Was mich beim Üben aufhält oder rauswirft,
   kostet mich Wiederholungen und damit Tempo.
3. **Mehr Übung je Minute.** Was mich schneller vom Lesen zum Sprechen bringt.

## Wonach suchen
- Inhaltsfehler und ungeprüfte generierte Sätze
- Reibung im Lernablauf, die ich beim Üben merke
- Stellen, an denen ich viel Zeit für wenig Übung aufwende
- kaputte oder fehlende Tests, besonders rund um Inhalt und Fortschritt

## Wonach nicht suchen
- Design-Umbauten
- Refactorings ohne Anlass
- neue Abhängigkeiten
- Funktionen, die gut aussehen, mich aber nicht schneller sprechen lassen

## Quellen
Code, `test/`, `docs/`, `brainstorms/`, `.scratch/`, `lektionen.md`,
git log der letzten 4 Wochen.

Prüfbefehle, die ein Worker benutzen kann: `npm test` (228 Tests),
`npm run check-content`.

## Grenzen
- Keine Änderungen an Einheiten-JSON oder Audio ohne ausdrückliche Karte.
- `.env` ist nicht eingecheckt und fehlt in jedem Worker-Worktree. Alles, was
  Supabase braucht, kann ein Worker **nicht** prüfen — solche Karten müssen das
  benennen oder gar nicht erst entstehen. `npm test` und
  `npm run check-content` laufen ohne `.env`.
- `npm run test:browser` (Playwright) läuft im Worker-Worktree nicht
  verlässlich; nicht als Abnahmekriterium fordern.
- Es gibt einen alten Branch `origin/master`, 67 Commits hinter `main`.
  Er ist tot. Alles bezieht sich auf `main`.
