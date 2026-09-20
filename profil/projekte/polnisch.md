# polnisch

**Was das ist:** Szlak, eine Übungs-App für Polnisch. Node, Vanilla-Web,
Tests mit `node --test` (228 Stück, grün). Repo `guschi18/polnisch-app`,
Ordner `D:/Polnisch`, Default-Branch `main`.

## Ziel in diesem Quartal
Verlässlicher Inhalt: keine ungeprüften Sätze mehr im Kurs.

## Wonach suchen
- Inhaltsfehler und ungeprüfte generierte Sätze
- kaputte oder fehlende Tests
- Reibung im Lernablauf, die Nutzer merken

## Wonach nicht suchen
- Design-Umbauten
- Refactorings ohne Anlass
- neue Abhängigkeiten

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
