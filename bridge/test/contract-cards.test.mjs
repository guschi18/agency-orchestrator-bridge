import test from "node:test";
import assert from "node:assert/strict";
import { buildOrchestratorBrief, MAX_MESSAGE } from "../lib/contract.mjs";
import { blockedCardHtml, mergeCardHtml, unsafeCardHtml } from "../lib/cards.mjs";
import { aoJobFromAgencyJob } from "../lib/agency-client.mjs";
import { loopbackUrl } from "../lib/config.mjs";

const job = {
  jobId: 12, ideaId: 3, dedupeKey: "polnisch:x", headline: "Titel", instruction: "",
  ao: { projectId: "polnisch", task: { objective: "Ziel", evidence: ["a"], acceptanceCriteria: ["b"], constraints: ["c"] } },
};

test("Auftrag nennt Worker-Namen und verbietet Merge", () => {
  const brief = buildOrchestratorBrief(job);
  assert.match(brief, /--name ag-12/);
  assert.match(brief, /Nicht mergen/);
  assert.ok(brief.length <= MAX_MESSAGE);
});

test("zu viele Belege werden gekürzt statt AO abzulehnen", () => {
  const big = { ...job, ao: { ...job.ao, task: { ...job.ao.task, evidence: Array.from({ length: 200 }, (_, i) => `Beleg ${i} `.repeat(5)) } } };
  assert.ok(buildOrchestratorBrief(big).length <= MAX_MESSAGE);
});

test("zu langes Ziel wird abgelehnt", () => {
  const big = { ...job, ao: { ...job.ao, task: { objective: "x".repeat(5000) } } };
  assert.throws(() => buildOrchestratorBrief(big), /4096/);
});

test("Sanitizer-Regeln wie in Agency", () => {
  assert.ok(unsafeCardHtml('<a href="x">'));
  assert.ok(unsafeCardHtml('<div onclick="x">'));
  assert.ok(unsafeCardHtml('<img src="https://x/y.png">'));
  assert.ok(!unsafeCardHtml('<button data-radar-action="open" data-radar-url="https://x">'));
});

test("erzeugte Karten bestehen den Sanitizer und escapen Inhalte", () => {
  const merge = mergeCardHtml({ headline: "<b>x</b>", projectId: "p", workerSessionId: "w", reviewSummary: "ok",
    pr: { number: 1, url: "https://github.com/a/b/pull/1", title: "t" } });
  const blocked = blockedCardHtml({ headline: "h", projectId: "p", reason: "<script>", workerSessionId: "w" });
  assert.ok(!unsafeCardHtml(merge));
  assert.ok(!unsafeCardHtml(blocked));
  assert.match(merge, /data-radar-action="do"/);
  assert.doesNotMatch(blocked, /data-radar-action="do"/);
  assert.match(blocked, /data-radar-state="blocked"/);
  assert.match(merge, /&lt;b&gt;/);
});

test("Merge-Karte zeigt Diff, Review-Verlauf und die Ursprungskarte", () => {
  const original = '<div><p>Warum das nützt</p><button data-radar-action="do" data-radar-prompt="Mit AO umsetzen">Mit AO umsetzen</button>'
    + '<button data-radar-action="open" data-radar-url="https://example.com/x">Quelle ↗</button></div>';
  const html = mergeCardHtml({
    headline: "Gegenlese-Bogen", projectId: "polnisch", workerSessionId: "polnisch-2", reviewSummary: "codex hat 2c39381 freigegeben",
    pr: { number: 1, url: "https://github.com/a/b/pull/1", title: "t", headSha: "2c393817", sourceBranch: "ao/x", targetBranch: "main", ciState: "unknown" },
    files: [{ path: "src/gegenlesebogen.mjs", status: "added", additions: 96, deletions: 0 },
            { path: "package.json", status: "modified", additions: 1, deletions: 0 }],
    commits: ["feat: Gegenlese-Bogen"],
    reviewRuns: [{ harness: "codex", verdict: "changes_requested", targetSha: "7557e6ec", body: "## Verdict\n\nDrei Befunde." },
                 { harness: "codex", verdict: "approved", targetSha: "2c393817", body: "## Verdict\n\nAlles behoben." }],
    originalCardHtml: original,
  });
  assert.ok(!unsafeCardHtml(html));
  assert.match(html, /src\/gegenlesebogen\.mjs/);
  assert.match(html, /\+96/);
  assert.match(html, /2c39381/);
  assert.match(html, /keine CI im Repo/);
  assert.match(html, /Änderungen verlangt/);
  assert.match(html, /Warum das nützt/);
  // Genau eine Do-Aktion: "Mergen". Die Ursprungskarte darf nicht erneut auslösen.
  assert.equal((html.match(/data-radar-action="do"/g) || []).length, 1);
  assert.doesNotMatch(html, /data-radar-prompt="Mit AO umsetzen"/);
  assert.match(html, /data-radar-url="https:\/\/example\.com\/x"/);
});

test("Merge-Karte ohne Worktree-Daten nutzt die PR-Summen", () => {
  const html = mergeCardHtml({ headline: "h", projectId: "p", workerSessionId: "w", reviewSummary: "ok",
    pr: { number: 2, url: "https://github.com/a/b/pull/2", changedFiles: 3, additions: 10, deletions: 4, ciState: "passing" } });
  assert.match(html, /3 Dateien, \+10 \/ −4/);
  assert.match(html, /grün/);
  assert.ok(!unsafeCardHtml(html));
});

test("nur Jobs mit agentContext.ao sind AO-Jobs", () => {
  const ctx = (agentContext) => JSON.stringify({ idea: { id: 1, version: 2, dedupeKey: "k", agentContext } });
  assert.equal(aoJobFromAgencyJob({ id: 5, cardContext: ctx("{}") }), null);
  assert.equal(aoJobFromAgencyJob({ id: 5, cardContext: "kaputt" }), null);
  const j = aoJobFromAgencyJob({ id: 5, cardContext: ctx(JSON.stringify({ ao: { projectId: "polnisch" } })) });
  assert.equal(j.ao.projectId, "polnisch");
  assert.equal(j.ideaVersion, 2);
});

test("nur Loopback-Ziele", () => {
  assert.equal(loopbackUrl("http://localhost:3100/x", "A"), "http://localhost:3100");
  assert.throws(() => loopbackUrl("http://192.168.1.5:3100", "A"));
  assert.throws(() => loopbackUrl("https://example.com", "A"));
});
