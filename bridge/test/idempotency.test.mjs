import test from "node:test";
import assert from "node:assert/strict";
import { tick } from "../index.mjs";
import { openStore } from "../lib/store.mjs";
import { AoUnavailable } from "../lib/ao-client.mjs";

const MIN = 60_000;
const config = {
  allowedProjects: ["polnisch"],
  allowMerge: false,
  limits: { workerTimeoutMs: 15 * MIN, maxReviewCycles: 3, stallMs: 240 * MIN, leaseRefreshMs: 30 * MIN },
};

function agencyJob(id, reclaimed = false) {
  const agentContext = JSON.stringify({ ao: { projectId: "polnisch", task: { objective: "Ziel" } } });
  return { id, reclaimed, instruction: "", cardContext: JSON.stringify({
    idea: { id: 1, version: 1, dedupeKey: "polnisch:x", headline: "H", project: "polnisch", category: "polnisch",
      riseReach: 10, riseImpact: 10, riseStrategicFit: 10, riseEase: 10, agentContext },
  }) };
}

function fakes({ jobs = [], sessions = [] } = {}) {
  const calls = { send: 0, updates: [] };
  const agency = {
    jobs: async () => jobs,
    updateJob: async (...args) => { calls.updates.push(args); },
    pushCard: async () => {},
  };
  const ao = {
    project: async () => ({ id: "polnisch" }),
    orchestrators: async () => [{ id: "pol-orch", projectId: "polnisch", createdAt: "1" }],
    spawnOrchestrator: async () => ({ id: "new-orch" }),
    sessions: async () => sessions,
    session: async (id) => sessions.find((s) => s.id === id),
    prs: async () => [],
    reviews: async () => ({ runs: [] }),
    send: async () => { calls.send++; },
  };
  return { agency, ao, calls };
}

test("ein Job wird genau einmal gesendet, auch über mehrere Durchläufe", async () => {
  const store = openStore(":memory:");
  const { agency, ao, calls } = fakes({ jobs: [agencyJob(7)] });
  await tick({ config, agency, ao, store, now: 0 });
  await tick({ config, agency, ao, store, now: MIN });
  assert.equal(calls.send, 1);
  assert.equal(store.get(7).state, "running");
});

test("abgelaufene Lease (reclaimed) startet nichts neu", async () => {
  const store = openStore(":memory:");
  const f = fakes({ jobs: [agencyJob(7)] });
  await tick({ config, ...f, store, now: 0 });
  const g = fakes({ jobs: [agencyJob(7, true)] });
  await tick({ config, agency: g.agency, ao: g.ao, store, now: 7 * 60 * MIN });
  assert.equal(g.calls.send, 0);
  assert.equal(g.calls.updates[0][1], "running");
});

test("AO fällt beim Senden aus → später genau einmal nachgeholt", async () => {
  const store = openStore(":memory:");
  const f = fakes({ jobs: [agencyJob(7)] });
  f.ao.send = async () => { throw new AoUnavailable("weg"); };
  await assert.rejects(tick({ config, ...f, store, now: 0 }));
  assert.equal(store.get(7).sent_at, null);

  const g = fakes({ jobs: [] });
  await tick({ config, agency: g.agency, ao: g.ao, store, now: MIN });
  await tick({ config, agency: g.agency, ao: g.ao, store, now: 2 * MIN });
  assert.equal(g.calls.send, 1);
});

test("Absturz nach dem Senden: vorhandener Worker verhindert zweiten Auftrag", async () => {
  const store = openStore(":memory:");
  const f = fakes({ jobs: [agencyJob(7)] });
  f.ao.send = async () => { throw new Error("Prozess stirbt nach dem Senden"); };
  await assert.rejects(tick({ config, ...f, store, now: 0 }));

  const g = fakes({ sessions: [{ id: "pol-5", kind: "worker", displayName: "ag-7", status: "working", createdAt: "2" }] });
  await tick({ config, agency: g.agency, ao: g.ao, store, now: MIN });
  assert.equal(g.calls.send, 0);
  assert.equal(store.get(7).worker_session_id, "pol-5");
});

test("nicht freigegebenes Projekt wird blockiert, nicht gesendet", async () => {
  const store = openStore(":memory:");
  const f = fakes({ jobs: [agencyJob(7)] });
  await tick({ config: { ...config, allowedProjects: [] }, ...f, store, now: 0 });
  assert.equal(f.calls.send, 0);
  assert.deepEqual(f.calls.updates.at(-1).slice(1), [
    "failed", 'Projekt "polnisch" ist für die Bridge nicht freigegeben', "blocked",
  ]);
});

test("Jobs ohne agentContext.ao fasst die Bridge nicht an", async () => {
  const store = openStore(":memory:");
  const plain = { id: 9, instruction: "", cardContext: JSON.stringify({ idea: { id: 2, version: 1, agentContext: "{}" } }) };
  const f = fakes({ jobs: [plain] });
  await tick({ config, ...f, store, now: 0 });
  assert.equal(f.calls.updates.length, 0);
  assert.equal(store.get(9), null);
});
