import test from "node:test";
import assert from "node:assert/strict";
import { decide } from "../lib/status.mjs";

const MIN = 60_000;
const limits = { workerTimeoutMs: 15 * MIN, maxReviewCycles: 3, stallMs: 240 * MIN };
const now = 1_000 * MIN;
const run = { worker_name: "ag-7", created_at: now - 5 * MIN, sent_at: now - 5 * MIN, last_progress_at: now - MIN };
const worker = { id: "pol-3", status: "working", displayStatus: "Working" };
const pr = { number: 4, url: "https://github.com/x/y/pull/4", state: "open", headSha: "abc1234", ci: { state: "unknown" } };
const approved = { prUrl: pr.url, targetSha: "abc1234", status: "delivered", verdict: "approved", harness: "codex", createdAt: "2026-09-19T21:00:00Z" };

const cases = [
  ["kein Worker, innerhalb Timeout", { worker: null }, "wait"],
  ["kein Worker, Timeout überschritten", { worker: null, run: { ...run, sent_at: now - 16 * MIN } }, "blocked"],
  ["Worker arbeitet, kein PR", {}, "running"],
  ["Worker wartet auf Eingabe", { worker: { ...worker, status: "needs_input" } }, "blocked"],
  ["Worker ohne PR beendet", { worker: { ...worker, status: "exited" } }, "blocked"],
  ["Worker terminiert ohne PR", { worker: { ...worker, isTerminated: true, status: "terminated" } }, "blocked"],
  ["Stillstand ohne PR", { run: { ...run, last_progress_at: now - 241 * MIN } }, "blocked"],
  ["PR offen, noch kein Review", { prs: [pr] }, "running"],
  // AO zeigt hier schon "Mergeable" – die Bridge wartet trotzdem auf den Review.
  ["PR mergeable laut AO, aber ungeprüft", { prs: [pr], worker: { ...worker, status: "mergeable", displayStatus: "Mergeable" } }, "running"],
  ["Review läuft", { prs: [pr], reviewRuns: [{ ...approved, status: "running", verdict: "" }] }, "running"],
  ["Review freigegeben, CI unbekannt", { prs: [pr], reviewRuns: [approved] }, "ready"],
  ["Review freigegeben, CI läuft", { prs: [{ ...pr, ci: { state: "pending" } }], reviewRuns: [approved] }, "running"],
  ["Review freigegeben, CI rot", { prs: [{ ...pr, ci: { state: "failing" } }], reviewRuns: [approved] }, "running"],
  ["Freigabe galt altem Stand", { prs: [{ ...pr, headSha: "def5678" }], reviewRuns: [approved] }, "running"],
  ["Draft-PR trotz Freigabe", { prs: [{ ...pr, state: "draft" }], reviewRuns: [approved] }, "running"],
  ["zu viele Review-Runden", { prs: [pr], reviewRuns: Array.from({ length: 4 }, (_, i) => ({ ...approved, verdict: "changes_requested", createdAt: `t${i}` })) }, "blocked"],
  ["PR gemerged", { prs: [{ ...pr, state: "merged" }] }, "completed"],
  ["PR ohne Merge geschlossen", { prs: [{ ...pr, state: "closed" }] }, "blocked"],
];

for (const [name, input, expected] of cases) {
  test(name, () => {
    const d = decide({ run, worker, prs: [], reviewRuns: [], now, limits, ...input });
    assert.equal(d.kind, expected, JSON.stringify(d));
  });
}

// A5: sobald jedes Projekt eine CI hat, reicht "nicht rot" nicht mehr.
const strict = { ...limits, requireGreenCi: true };

test("mit requireGreenCi macht CI 'unknown' keine Karte mehr fertig", () => {
  const d = decide({ run, worker, prs: [pr], reviewRuns: [approved], now, limits: strict });
  assert.equal(d.kind, "running", JSON.stringify(d));
});

test("mit requireGreenCi ist eine grüne CI der Weg zur Merge-Karte", () => {
  const green = { ...pr, ci: { state: "passing" } };
  const d = decide({ run, worker, prs: [green], reviewRuns: [approved], now, limits: strict });
  assert.equal(d.kind, "ready", JSON.stringify(d));
});

test("ohne requireGreenCi bleibt eine grüne CI genauso fertig", () => {
  const green = { ...pr, ci: { state: "passing" } };
  assert.equal(decide({ run, worker, prs: [green], reviewRuns: [approved], now, limits }).kind, "ready");
});
