import test from "node:test";
import assert from "node:assert/strict";
import { tick } from "../index.mjs";
import { assertSafeCardHtml, unsafeCardHtml } from "../lib/cards.mjs";
import { MAX_PROMPT, buildRunnerPrompt, runnerCard, runnerDedupeKey, runnerPaths } from "../lib/runner.mjs";
import { openStore } from "../lib/store.mjs";

const config = {
  agencyUrl: "http://localhost:3100",
  agencyPath: "D:\\Tools\\Agency\\agency",
  profilDir: "D:\\repo\\profil",
  projectDocsDir: "D:\\repo\\profil\\projekte",
  projectsFile: "D:\\repo\\profil\\ao-projects.json",
  runnerHarness: "claude-code",
  runnerModel: "claude-opus-5",
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

test("die Karte bleibt unter einem echten Befund", () => {
  const { rise } = runnerCard({ projectId: "polnisch", projectPath: "D:\\P", docFile: "x.md" });
  const score = rise.reach + rise.impact + rise.strategicFit + rise.ease;
  assert.ok(score < 70, `Score ${score} wuerde echte Karten verdraengen`);
});

// ---- Der Weg durch die Bridge ------------------------------------------------

function discoverJob(id = 5) {
  const ao = { projectId: "polnisch", action: "discover" };
  return { id, instruction: "", cardContext: JSON.stringify({
    idea: { id: 9, version: 2, dedupeKey: "polnisch:runner", headline: "Neue Vorschläge für polnisch suchen",
      project: "polnisch", category: "polnisch", cardHtml: "x".repeat(90), agentContext: JSON.stringify(ao ? { ao } : {}) },
  }) };
}

function fakes({ sessions = [] } = {}) {
  const calls = { spawns: [], updates: [], cards: [], sends: 0 };
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
    } };
}

test("ein Klick startet genau eine Session mit Claude/Opus", async () => {
  const store = openStore(":memory:");
  const f = fakes();
  await tick({ config, pipeline, agency: f.agency, ao: f.ao, store, now: 0 });

  assert.equal(f.calls.spawns.length, 1);
  const spawn = f.calls.spawns[0];
  assert.equal(spawn.projectId, "polnisch");
  assert.equal(spawn.displayName, "ag-5");
  assert.equal(spawn.harness, "claude-code");
  assert.equal(spawn.model, "claude-opus-5");
  assert.match(spawn.prompt, /D:\\Polnisch/);
  assert.equal(f.calls.sends, 0, "der Runner geht nicht über den Orchestrator");
  assert.equal(store.get(5).state, "completed");
});

test("der Knopf liegt danach wieder da, mit dem Stand des Laufs", async () => {
  const store = openStore(":memory:");
  const f = fakes();
  await tick({ config, pipeline, agency: f.agency, ao: f.ao, store, now: Date.parse("2026-09-20T08:00:00Z") });
  const card = f.calls.cards.at(-1);
  assert.equal(card.dedupeKey, "polnisch:runner");
  assert.match(card.cardHtml, /2026-09-20 08:00/);
  assert.match(card.cardHtml, /pol-7/);
});

test("ein zweiter Klick bezahlt keinen zweiten Lauf", async () => {
  const store = openStore(":memory:");
  const f = fakes({ sessions: [{ id: "pol-7", kind: "worker", displayName: "ag-5", createdAt: "1" }] });
  await tick({ config, pipeline, agency: f.agency, ao: f.ao, store, now: 0 });
  assert.deepEqual(f.calls.spawns, []);
  assert.match(f.calls.updates.at(-1)[2], /läuft bereits/);
});

test("analysieren: false blockiert den Lauf, auch wenn umsetzen an ist", async () => {
  const store = openStore(":memory:");
  const f = fakes();
  await tick({ config, pipeline: { polnisch: { analysieren: false, umsetzen: true } }, agency: f.agency, ao: f.ao, store, now: 0 });
  assert.deepEqual(f.calls.spawns, []);
  assert.match(f.calls.updates.at(-1)[2], /nicht zur Analyse freigegeben/);
});

test("umsetzen: false verhindert einen Lauf nicht — er liest ja nur", async () => {
  const store = openStore(":memory:");
  const f = fakes();
  await tick({ config, pipeline: { polnisch: { analysieren: true, umsetzen: false } }, agency: f.agency, ao: f.ao, store, now: 0 });
  assert.equal(f.calls.spawns.length, 1);
});
