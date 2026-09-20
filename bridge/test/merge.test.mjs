import test from "node:test";
import assert from "node:assert/strict";
import { tick } from "../index.mjs";
import { mergeProblem } from "../lib/merge.mjs";
import { openStore } from "../lib/store.mjs";

const HEAD = "a".repeat(40);
const OTHER = "b".repeat(40);

function goodPr(over = {}) {
  return {
    number: 1, url: "https://github.com/guschi18/polnisch-app/pull/1", state: "open", headSha: HEAD,
    ci: { state: "passing", failingChecks: [] },
    mergeability: { state: "mergeable", reasons: [] },
    review: { decision: "approved", unresolvedThreadCount: 0, hasUnresolvedHumanComments: false },
    ...over,
  };
}

const approvedRun = { targetSha: HEAD, verdict: "approved", status: "complete", harness: "codex" };

function check(over = {}, opts = {}) {
  return mergeProblem({ pr: goodPr(over), reviewRuns: [approvedRun], expectedHeadSha: HEAD, ...opts });
}

// ---- Die eine Zusage: erfüllte Bedingungen ----------------------------------

test("alle Bedingungen erfüllt → kein Grund, den Merge zu verweigern", () => {
  assert.equal(check(), null);
});

test("CI unbekannt (Projekt ohne Action) blockiert nicht, solange requireGreenCi aus ist", () => {
  assert.equal(check({ ci: { state: "unknown", failingChecks: [] } }), null);
});

// ---- Jede abgelehnte Bedingung ----------------------------------------------

test("kein PR mehr da", () => {
  assert.match(mergeProblem({ pr: null, expectedHeadSha: HEAD }), /nicht mehr gefunden/);
});

test("PR bereits gemerged", () => {
  assert.match(check({ state: "merged" }), /bereits gemerged/);
});

test("PR geschlossen oder Entwurf", () => {
  assert.match(check({ state: "closed" }), /PR ist closed/);
  assert.match(check({ state: "draft" }), /PR ist draft/);
});

test("neue Commits seit dem Review", () => {
  assert.match(check({ headSha: OTHER }), /neue Commits/);
});

test("CI rot — mit Namen der roten Checks", () => {
  const reason = check({ ci: { state: "failing", failingChecks: [{ name: "tests" }] } });
  assert.match(reason, /CI ist rot/);
  assert.match(reason, /tests/);
});

test("CI läuft noch", () => {
  assert.match(check({ ci: { state: "pending", failingChecks: [] } }), /CI läuft noch/);
});

test("mit requireGreenCi reicht 'unknown' nicht mehr", () => {
  assert.match(check({ ci: { state: "unknown", failingChecks: [] } }, { requireGreenCi: true }), /nicht grün/);
  assert.equal(check({}, { requireGreenCi: true }), null);
});

test("PR nicht mergebar — mit AOs Begründung", () => {
  const reason = check({ mergeability: { state: "conflicting", reasons: ["merge conflict in test/x.mjs"] } });
  assert.match(reason, /nicht mergebar \(conflicting/);
  assert.match(reason, /test\/x\.mjs/);
});

test("offene Review-Threads", () => {
  assert.match(check({ review: { decision: "approved", unresolvedThreadCount: 2 } }), /2 offene Review-Threads/);
});

test("offene menschliche Kommentare", () => {
  assert.match(check({ review: { decision: "approved", unresolvedThreadCount: 0, hasUnresolvedHumanComments: true } }),
    /menschliche Review-Kommentare/);
});

test("GitHub-Review verlangt Änderungen", () => {
  assert.match(check({ review: { decision: "changes_requested", unresolvedThreadCount: 0 } }), /verlangt Änderungen/);
});

test("AO-Review fehlt, gilt einem anderen Head oder ist noch nicht fertig", () => {
  assert.match(mergeProblem({ pr: goodPr(), reviewRuns: [], expectedHeadSha: HEAD }), /kein abgeschlossenes AO-Review/);
  assert.match(mergeProblem({ pr: goodPr(), expectedHeadSha: HEAD,
    reviewRuns: [{ ...approvedRun, targetSha: OTHER }] }), /kein abgeschlossenes AO-Review/);
  assert.match(mergeProblem({ pr: goodPr(), expectedHeadSha: HEAD,
    reviewRuns: [{ ...approvedRun, status: "running" }] }), /kein abgeschlossenes AO-Review/);
  assert.match(mergeProblem({ pr: goodPr(), expectedHeadSha: HEAD,
    reviewRuns: [{ ...approvedRun, verdict: "changes_requested" }] }), /kein abgeschlossenes AO-Review/);
});

// ---- Der Weg durch die Bridge ------------------------------------------------

const pipeline = { polnisch: { analysieren: true, umsetzen: true } };
const config = { allowMerge: true, requireGreenCi: false, limits: {} };

function mergeJob(over = {}) {
  const ao = { projectId: "polnisch", action: "merge", prNumber: 1, prUrl: goodPr().url,
    headSha: HEAD, workerSessionId: "pol-2", sourceJobId: 1, ...over };
  return { id: 42, instruction: "", cardContext: JSON.stringify({
    idea: { id: 2, version: 3, dedupeKey: "polnisch:x", headline: "Merge: H", project: "polnisch",
      category: "polnisch", cardHtml: "x".repeat(90), agentContext: JSON.stringify({ ao }) },
  }) };
}

function mergeFakes({ prs, reviewRuns = [approvedRun] }) {
  const calls = { merges: [], updates: [], cards: [] };
  return { calls,
    agency: {
      jobs: async () => [mergeJob()],
      updateJob: async (...a) => { calls.updates.push(a); },
      pushCard: async (c) => { calls.cards.push(c); },
    },
    ao: {
      project: async () => ({ id: "polnisch" }),
      prs: async () => prs,
      reviews: async () => ({ runs: reviewRuns }),
      merge: async (n, body) => { calls.merges.push([n, body]); return { ok: true, prNumber: n }; },
    } };
}

test("Merge-Karte mit erfüllten Bedingungen: genau ein Merge mit prUrl und expectedHeadSha", async () => {
  const store = openStore(":memory:");
  const f = mergeFakes({ prs: [goodPr()] });
  await tick({ config, pipeline, agency: f.agency, ao: f.ao, store, now: 0 });
  assert.deepEqual(f.calls.merges, [[1, { prUrl: goodPr().url, expectedHeadSha: HEAD }]]);
  assert.equal(f.calls.updates.at(-1)[1], "done");
  assert.equal(store.get(42).state, "completed");
});

test("Merge-Karte mit gewanderten Commits: kein Merge, Job blockiert mit Grund", async () => {
  const store = openStore(":memory:");
  const f = mergeFakes({ prs: [goodPr({ headSha: OTHER })] });
  await tick({ config, pipeline, agency: f.agency, ao: f.ao, store, now: 0 });
  assert.deepEqual(f.calls.merges, []);
  assert.deepEqual(f.calls.updates.at(-1).slice(1, 2), ["failed"]);
  assert.match(f.calls.updates.at(-1)[2], /Merge abgebrochen: PR hat seit dem Review neue Commits/);
  assert.equal(store.get(42).state, "failed");
});

test("BRIDGE_ALLOW_MERGE=0 schaltet den Merge-Weg komplett ab", async () => {
  const store = openStore(":memory:");
  const f = mergeFakes({ prs: [goodPr()] });
  await tick({ config: { ...config, allowMerge: false }, pipeline, agency: f.agency, ao: f.ao, store, now: 0 });
  assert.deepEqual(f.calls.merges, []);
  assert.match(f.calls.updates.at(-1)[2], /abgeschaltet/);
});

test("nicht freigegebenes Projekt wird auch auf dem Merge-Weg blockiert", async () => {
  const store = openStore(":memory:");
  const f = mergeFakes({ prs: [goodPr()] });
  await tick({ config, pipeline: {}, agency: f.agency, ao: f.ao, store, now: 0 });
  assert.deepEqual(f.calls.merges, []);
  assert.match(f.calls.updates.at(-1)[2], /steht nicht in pipeline.json/);
});
