import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analysisAllowed, dispatchProblem, ensureProjectDoc, mergePipeline, readPipeline, syncProjects,
} from "../lib/pipeline.mjs";

const NOW = Date.parse("2026-09-20T06:00:00.000Z");
const ISO = new Date(NOW).toISOString();

async function tempConfig() {
  const dir = await mkdtemp(join(tmpdir(), "bridge-pipeline-"));
  return {
    dir,
    config: {
      pipelineFile: join(dir, "pipeline.json"),
      projectsFile: join(dir, "ao-projects.json"),
      projectDocsDir: join(dir, "projekte"),
    },
  };
}

function fakes(projects) {
  const topics = [];
  return {
    ao: { projects: async () => projects },
    agency: { upsertTopic: async (label, hint) => { topics.push([label, hint]); } },
    topics,
  };
}

// ---- mergePipeline ----------------------------------------------------------

test("ein neues AO-Projekt kommt auf false in die pipeline.json", () => {
  const { pipeline, added } = mergePipeline({}, [{ id: "neues-repo" }], ISO);
  assert.deepEqual(added, ["neues-repo"]);
  assert.deepEqual(pipeline["neues-repo"], { analysieren: false, umsetzen: false, prioritaet: 50, maxKarten: 3 });
});

test("bestehende Freigaben überlebt der Abgleich unverändert", () => {
  const before = { polnisch: { analysieren: true, umsetzen: true, prioritaet: 90, maxKarten: 5 } };
  const { pipeline, added } = mergePipeline(before, [{ id: "polnisch" }], ISO);
  assert.deepEqual(added, []);
  assert.deepEqual(pipeline.polnisch, before.polnisch);
});

test("verschwundenes Projekt wird markiert, nicht gelöscht", () => {
  const before = { alt: { analysieren: true, umsetzen: true } };
  const { pipeline, vanished } = mergePipeline(before, [], ISO);
  assert.deepEqual(vanished, ["alt"]);
  assert.equal(pipeline.alt.nichtMehrInAo, ISO);
  assert.equal(pipeline.alt.analysieren, true, "die Freigabe bleibt erhalten");
});

test("die Markierung verschwindet wieder, wenn das Projekt zurückkehrt", () => {
  const before = { alt: { analysieren: true, umsetzen: true, nichtMehrInAo: ISO } };
  const { pipeline, returned } = mergePipeline(before, [{ id: "alt" }], ISO);
  assert.deepEqual(returned, ["alt"]);
  assert.ok(!("nichtMehrInAo" in pipeline.alt));
});

test("eine zweite Markierung überschreibt das ursprüngliche Datum nicht", () => {
  const before = { alt: { nichtMehrInAo: "2026-01-01T00:00:00.000Z" } };
  const { pipeline, vanished } = mergePipeline(before, [], ISO);
  assert.deepEqual(vanished, []);
  assert.equal(pipeline.alt.nichtMehrInAo, "2026-01-01T00:00:00.000Z");
});

// ---- Freigaben --------------------------------------------------------------

test("dispatchProblem nennt bei jeder Ablehnung einen Grund", () => {
  assert.match(dispatchProblem({}, "x"), /steht nicht in pipeline.json/);
  assert.match(dispatchProblem({ x: { umsetzen: false } }, "x"), /nicht zur Umsetzung freigegeben/);
  assert.match(dispatchProblem({ x: { umsetzen: true, nichtMehrInAo: ISO } }, "x"), /nicht mehr registriert/);
  assert.equal(dispatchProblem({ x: { umsetzen: true } }, "x"), null);
});

test('umsetzen muss genau true sein, nicht nur "wahrheitswertig"', () => {
  assert.ok(dispatchProblem({ x: { umsetzen: "ja" } }, "x"));
  assert.ok(dispatchProblem({ x: { umsetzen: 1 } }, "x"));
});

test("analysieren ist unabhängig von umsetzen", () => {
  assert.equal(analysisAllowed({ x: { analysieren: true, umsetzen: false } }, "x"), true);
  assert.equal(analysisAllowed({ x: { analysieren: false, umsetzen: true } }, "x"), false);
  assert.equal(analysisAllowed({ x: { analysieren: true, nichtMehrInAo: ISO } }, "x"), false);
});

// ---- Dateien ----------------------------------------------------------------

test("fehlende pipeline.json ist kein Fehler, kaputte schon", async () => {
  const { dir } = await tempConfig();
  assert.deepEqual(await readPipeline(join(dir, "gibtsnicht.json")), {});
  const broken = join(dir, "kaputt.json");
  await writeFile(broken, "{nicht json");
  await assert.rejects(readPipeline(broken), /kein gültiges JSON/);
});

test("eine gefüllte Projektdatei wird nie überschrieben", async () => {
  const { dir } = await tempConfig();
  const docs = join(dir, "projekte");
  const first = await ensureProjectDoc(docs, "polnisch", { path: "D:\\Polnisch" });
  assert.equal(first.created, true);
  await writeFile(first.file, "# meine Ziele\n");
  const second = await ensureProjectDoc(docs, "polnisch", {});
  assert.equal(second.created, false);
  assert.equal(await readFile(first.file, "utf8"), "# meine Ziele\n");
});

// ---- syncProjects ------------------------------------------------------------

test("syncProjects schreibt alle drei Artefakte und eine Lane je Projekt", async () => {
  const { config } = await tempConfig();
  await writeFile(config.pipelineFile, JSON.stringify({ polnisch: { analysieren: true, umsetzen: true } }));
  const { ao, agency, topics } = fakes([
    { id: "polnisch", name: "polnisch", path: "D:\\Polnisch", kind: "single_repo" },
    { id: "neues-repo", name: "neu", path: "D:\\Neu", kind: "single_repo" },
  ]);
  const result = await syncProjects({ ao, agency, config, now: NOW });

  assert.deepEqual(result.added, ["neues-repo"]);
  assert.deepEqual(result.docsCreated, ["polnisch"], "nur freigeschaltete Projekte bekommen eine Vorlage");
  assert.deepEqual(topics.map(([l]) => l).sort(), ["neues-repo", "polnisch"]);

  const pipeline = JSON.parse(await readFile(config.pipelineFile, "utf8"));
  assert.equal(pipeline["neues-repo"].analysieren, false);
  assert.equal(pipeline.polnisch.umsetzen, true);

  const mirror = JSON.parse(await readFile(config.projectsFile, "utf8"));
  assert.equal(mirror.syncedAt, ISO);
  const pol = mirror.projects.find((p) => p.id === "polnisch");
  assert.equal(pol.path, "D:\\Polnisch", "der Runner soll den Pfad nie raten müssen");
  assert.equal(pol.bridgeDispatch, true);
  assert.equal(mirror.projects.find((p) => p.id === "neues-repo").bridgeDispatch, false);
});

test("eine unerreichbare Agency bricht den Abgleich nicht ab", async () => {
  const { config } = await tempConfig();
  const { ao } = fakes([{ id: "polnisch", path: "D:\\Polnisch" }]);
  const agency = { upsertTopic: async () => { throw new Error("ECONNREFUSED"); } };
  const events = [];
  const result = await syncProjects({ ao, agency, config, now: NOW, log: (e, f) => events.push([e, f]) });
  assert.equal(result.count, 1);
  assert.ok(JSON.parse(await readFile(config.projectsFile, "utf8")).projects.length === 1);
  assert.ok(events.some(([e]) => e === "sync.topics-failed"));
});
