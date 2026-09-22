import test from "node:test";
import assert from "node:assert/strict";
import { tick } from "../index.mjs";
import { assertSafeCardHtml, unsafeCardHtml } from "../lib/cards.mjs";
import { MAX_PROMPT, buildRunnerPrompt, runnerCard, runnerDedupeKey, runnerPaths } from "../lib/runner.mjs";
import { openStore } from "../lib/store.mjs";

const config = {
  agencyUrl: "http://localhost:3100",
  agencyPath: "D:\\Tools\\Agency-AO\\Agency",
  profilDir: "D:\\repo\\profil",
  laufzeitDir: "D:\\repo\\laufzeit",
  projectDocsDir: "D:\\repo\\profil\\projekte",
  projectsFile: "D:\\repo\\profil\\ao-projects.json",
  runnerHarness: "claude-code",
  runnerModel: "claude-sonnet-5",
  runnerMode: "lokal",
  allowMerge: true,
  limits: {},
};
const pipeline = { polnisch: { analysieren: true, umsetzen: true, maxKarten: 3 } };

function prompt(over = {}) {
  return buildRunnerPrompt({
    projectId: "polnisch", projectPath: "D:\\Polnisch", maxKarten: 3,
    agencyUrl: config.agencyUrl, paths: runnerPaths(config, "polnisch"), ...over,
  });
}

// ---- Auftragstext ------------------------------------------------------------

test("der Auftrag nennt Pfad, Budget und Agency-URL wörtlich", () => {
  const text = prompt();
  assert.match(text, /D:\\Polnisch/);
  assert.match(text, /höchstens 3 Karten/);
  assert.match(text, /http:\/\/localhost:3100/);
  assert.match(text, /D:\\repo\\profil\\projekte\\polnisch\.md/);
});

test("der Auftrag verweist auf das Kartenbeispiel statt auf Agencys Quellcode", () => {
  const text = prompt();
  assert.match(text, /karten-beispiel\\card\.json/);
  assert.match(text, /nicht\*\* Agencys Quellcode/);
});

test("der Auftrag schickt den Runner zur Repo-Karte, nicht auf eigene Erkundung", () => {
  // Maßnahme 4: die Turns 8-13 gingen fuers Ueberblickverschaffen drauf. Jeder
  // davon liest das ganze Praefix mit - deshalb steht der Verweis vor der
  // Untersuchung, und das eigene Erkunden ist ausdruecklich untersagt.
  const text = prompt();
  assert.match(text, /D:\\repo\\laufzeit\\repo-map-polnisch\.md/);
  assert.match(text, /keinen\*\* eigenen Überblick/);
  assert.match(text, /git log/);
});

test("der Auftrag verbietet Schreiben und Secrets", () => {
  const text = prompt();
  assert.match(text, /nur lesend/);
  assert.match(text, /nichts committen/);
  assert.match(text, /\.env/);
});

test("der Auftrag warnt vor dem eigenen Arbeitsverzeichnis", () => {
  // Der Runner laeuft in einem AO-Worktree, nicht im Projektordner. Ohne
  // diesen Satz liest er den Worktree und sieht .scratch/ und Ungetracktes nie.
  assert.match(prompt(), /eigenen AO-Arbeitsverzeichnis/);
});

test("der Auftrag schuetzt seinen eigenen dedupeKey", () => {
  assert.match(prompt(), /nie.*"polnisch:runner"/s);
});

test("der Auftrag bleibt unter AOs Prompt-Grenze", () => {
  assert.ok(prompt().length <= MAX_PROMPT, `${prompt().length} Zeichen`);
});

test("ein absurd langer Pfad wird als Fehler gemeldet, nicht stillschweigend gekappt", () => {
  assert.throws(() => prompt({ projectPath: "D:\\" + "x".repeat(MAX_PROMPT) }), /AO erlaubt/);
});

// ---- Die Karte ---------------------------------------------------------------

test("die Runner-Karte haelt Agencys Sanitizer-Regeln ein", () => {
  const card = runnerCard({ projectId: "polnisch", projectPath: "D:\\Polnisch", maxKarten: 3, docFile: "x.md" });
  assert.doesNotThrow(() => assertSafeCardHtml(card.cardHtml));
  assert.equal(unsafeCardHtml(card.cardHtml), false);
});

test("die Karte traegt action discover und den Projektnamen in beiden Feldern", () => {
  const card = runnerCard({ projectId: "polnisch", projectPath: "D:\\Polnisch", docFile: "x.md" });
  assert.deepEqual(card.agentContext.ao, { projectId: "polnisch", action: "discover" });
  assert.equal(card.project, "polnisch");
  assert.equal(card.category, "polnisch");
  assert.equal(card.dedupeKey, runnerDedupeKey("polnisch"));
});

test("die Karte nennt die Kosten und den Maszstab", () => {
  const card = runnerCard({ projectId: "polnisch", projectPath: "D:\\Polnisch", docFile: "D:\\repo\\ziele.md" });
  assert.match(card.cardHtml, /2,71/);
  assert.match(card.cardHtml, /D:\/repo\/ziele\.md/);
  assert.match(card.cardHtml, /noch nie/);
});

test("die Karte steht am Ende des Stapels, nicht vor der angefangenen Arbeit", () => {
  // Agency sortiert nach RISE. Lag der Knopf bei 60, schob er sich vor eine
  // fertige Merge-Karte — man sah "neue Vorschlaege suchen", waehrend noch
  // geprueftes, ungemergtes Material offen war.
  const { rise } = runnerCard({ projectId: "polnisch", projectPath: "D:\\P", docFile: "x.md" });
  const score = rise.reach + rise.impact + rise.strategicFit + rise.ease;
  assert.ok(score <= 10, `Score ${score} wuerde sich vor echte Karten schieben`);
});

// ---- Der Weg durch die Bridge ------------------------------------------------

function discoverJob(id = 5) {
  const ao = { projectId: "polnisch", action: "discover" };
  return { id, instruction: "", cardContext: JSON.stringify({
    idea: { id: 9, version: 2, dedupeKey: "polnisch:runner", headline: "Neue Vorschläge für polnisch suchen",
      project: "polnisch", category: "polnisch", cardHtml: "x".repeat(90), agentContext: JSON.stringify(ao ? { ao } : {}) },
  }) };
}

function fakes({ sessions = [], alive = true } = {}) {
  const calls = { spawns: [], starts: [], maps: [], updates: [], cards: [], sends: 0 };
  return { calls,
    agency: {
      jobs: async () => [discoverJob()],
      updateJob: async (...a) => { calls.updates.push(a); },
      pushCard: async (c) => { calls.cards.push(c); },
    },
    ao: {
      project: async () => ({ id: "polnisch", path: "D:\\Polnisch" }),
      sessions: async () => sessions,
      spawn: async (body) => { calls.spawns.push(body); return { id: "pol-7" }; },
      send: async () => { calls.sends++; },
      prs: async () => [], reviews: async () => ({ runs: [] }),
    },
    // Kein Test startet je wirklich claude oder liest ein fremdes Repo.
    runner: {
      start: async (opts) => { calls.starts.push(opts); return { pid: 4711, logFile: opts.logFile }; },
      alive: () => alive,
      resolveBinary: () => "C:\\tools\\claude.exe",
      writeRepoMap: async (opts) => { calls.maps.push(opts); return { file: opts.outFile, chars: 900 }; },
    } };
}

async function run(f, over = {}) {
  const store = openStore(":memory:");
  await tick({ config, pipeline, agency: f.agency, ao: f.ao, runner: f.runner, store, now: 0, ...over });
  return store;
}

test("ein Klick startet claude selbst und hält die Karte auf Working", async () => {
  const f = fakes();
  const store = await run(f);

  assert.deepEqual(f.calls.spawns, [], "nicht über AO: dort ginge die Kommandozeile verloren");
  assert.equal(f.calls.starts.length, 1);
  const start = f.calls.starts[0];
  assert.equal(start.binary, "C:\\tools\\claude.exe");
  assert.equal(start.model, "claude-sonnet-5");
  assert.match(start.prompt, /D:\\Polnisch/);
  assert.deepEqual(start.addDirs, [
    "D:\\Polnisch", "D:\\repo\\profil", "D:\\Tools\\Agency-AO\\Agency\\skills\\agency",
    "D:\\Tools\\Agency-AO\\Agency\\scripts", "D:\\Tools\\Agency-AO\\Agency\\agent-work\\discovery-polnisch",
  ]);
  assert.equal(start.writeDir, "D:\\Tools\\Agency-AO\\Agency\\agent-work\\discovery-polnisch");
  assert.equal(f.calls.sends, 0, "der Runner geht nicht über den Orchestrator");
  assert.equal(store.get(5).state, "running");
  assert.equal(store.get(5).agency_job_open, 1);
  assert.equal(store.get(5).worker_session_id, "lokal:4711");
  assert.match(f.calls.updates.at(-1)[2], /Discovery-Run.*läuft/);
});

test("die Repo-Karte wird vor dem Start erhoben, nicht vom Runner selbst", async () => {
  const f = fakes();
  await run(f);
  assert.equal(f.calls.maps.length, 1);
  assert.equal(f.calls.maps[0].projectPath, "D:\\Polnisch");
  assert.match(f.calls.maps[0].outFile, /repo-map-polnisch\.md$/);
});

test("scheitert die Repo-Karte, läuft der Runner trotzdem", async () => {
  // Sie spart Turns, sie ist keine Bedingung. Ein Projekt ohne git waere sonst
  // gar nicht mehr zu untersuchen.
  const f = fakes();
  f.runner.writeRepoMap = async () => { throw new Error("kein git"); };
  await run(f);
  assert.equal(f.calls.starts.length, 1);
});

test("BRIDGE_RUNNER_MODE=ao geht weiter über eine AO-Session", async () => {
  const f = fakes();
  await run(f, { config: { ...config, runnerMode: "ao" } });
  assert.deepEqual(f.calls.starts, []);
  assert.equal(f.calls.spawns.length, 1);
  assert.equal(f.calls.spawns[0].model, "claude-sonnet-5");
  assert.equal(f.calls.spawns[0].harness, "claude-code");
  assert.equal(f.calls.spawns[0].displayName, "ag-5");
});

test("erst nach Prozessende liegt der Knopf wieder da", async () => {
  const f = fakes();
  const store = await run(f, { now: Date.parse("2026-09-20T08:00:00Z") });
  assert.equal(f.calls.cards.length, 0);
  f.agency.jobs = async () => [];
  f.runner.alive = () => false;
  await tick({ config, pipeline, agency: f.agency, ao: f.ao, runner: f.runner, store,
    now: Date.parse("2026-09-20T08:02:00Z") });
  const card = f.calls.cards.at(-1);
  assert.equal(card.dedupeKey, "polnisch:runner");
  assert.match(card.cardHtml, /2026-09-20 08:02/);
  assert.match(card.cardHtml, /beendet \(Prozess 4711\)/);
  assert.equal(store.get(5).state, "completed");
  assert.equal(f.calls.updates.at(-1)[1], "done");
});

test("ein zweiter Klick bezahlt keinen zweiten Lauf", async () => {
  const f = fakes({ alive: true });
  const store = openStore(":memory:");
  // Ein Lauf steht schon im Gedaechtnis und sein Prozess lebt noch.
  store.insert({ jobId: 4, ideaId: 9, ideaVersion: 1, dedupeKey: "polnisch:runner", headline: "x",
    action: "discover", projectId: "polnisch", workerName: "ag-4", now: 0, card: {} });
  store.update(4, { worker_session_id: "lokal:4711" });

  await tick({ config, pipeline, agency: f.agency, ao: f.ao, runner: f.runner, store, now: 0 });
  assert.deepEqual(f.calls.starts, []);
  assert.match(f.calls.updates.at(-1)[2], /läuft bereits/);
});

test("im AO-Modus fragt der Doppelklick-Schutz AO, nicht den Prozess", async () => {
  const f = fakes({ sessions: [{ id: "pol-7", kind: "worker", displayName: "ag-5", createdAt: "1" }] });
  await run(f, { config: { ...config, runnerMode: "ao" } });
  assert.deepEqual(f.calls.spawns, []);
  assert.match(f.calls.updates.at(-1)[2], /läuft bereits \(Session pol-7\)/);
});

test("analysieren: false blockiert den Lauf, auch wenn umsetzen an ist", async () => {
  const f = fakes();
  await run(f, { pipeline: { polnisch: { analysieren: false, umsetzen: true } } });
  assert.deepEqual(f.calls.starts, []);
  assert.match(f.calls.updates.at(-1)[2], /nicht zur Analyse freigegeben/);
});

test("umsetzen: false verhindert einen Lauf nicht — er liest ja nur", async () => {
  const f = fakes();
  await run(f, { pipeline: { polnisch: { analysieren: true, umsetzen: false } } });
  assert.equal(f.calls.starts.length, 1);
});
