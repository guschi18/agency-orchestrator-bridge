import { setTimeout as sleep } from "node:timers/promises";
import { loadConfig } from "./lib/config.mjs";
import { AoUnavailable, createAoClient, ensureOrchestrator, findWorker } from "./lib/ao-client.mjs";
import { aoJobFromAgencyJob, createAgencyClient } from "./lib/agency-client.mjs";
import { blockedCardHtml, mergeCardHtml } from "./lib/cards.mjs";
import { buildOrchestratorBrief, workerNameFor } from "./lib/contract.mjs";
import { decide, progressed } from "./lib/status.mjs";
import { openStore } from "./lib/store.mjs";

export function log(event, fields = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));
}

export async function tick({ config, agency, ao, store, now = Date.now() }) {
  await dispatchNew({ config, agency, ao, store, now });
  await syncOpen({ config, agency, ao, store, now });
}

// ---- Neue Jobs übernehmen ----------------------------------------------------

async function dispatchNew({ config, agency, ao, store, now }) {
  for (const raw of await agency.jobs()) {
    const job = aoJobFromAgencyJob(raw);
    if (!job) continue; // kein AO-Job: bleibt beim Agency-Runner

    const existing = store.get(job.jobId);
    if (existing) {
      // Abgelaufene Lease: Agency gibt den Job erneut aus. Nicht neu starten, nur Lease erneuern.
      if (existing.agency_job_open) {
        await agency.updateJob(job.jobId, "running", existing.last_summary ?? "An AO übergeben");
        store.update(job.jobId, { last_lease_at: now });
      }
      log("job.reclaimed", { jobId: job.jobId });
      continue;
    }

    const action = job.ao.action ?? "implement";
    store.insert({
      jobId: job.jobId, ideaId: job.ideaId, ideaVersion: job.ideaVersion, dedupeKey: job.dedupeKey,
      headline: job.headline, action, projectId: job.ao.projectId, workerName: workerNameFor(job.jobId), now,
      card: { project: job.project, category: job.category, rise: job.rise, ao: job.ao, cardHtml: job.cardHtml },
    });
    await agency.updateJob(job.jobId, "running", "An Agent Orchestrator übergeben");
    store.update(job.jobId, { last_lease_at: now });
    log("job.claimed", { jobId: job.jobId, action, projectId: job.ao.projectId });

    const problem = await projectProblem(config, ao, job.ao.projectId);
    if (problem) {
      // Nie an AO übergeben: abschließen, nicht weiter beobachten.
      await block({ agency, store, run: store.get(job.jobId), reason: problem, now, final: true });
      continue;
    }
    if (action === "merge") await handleMerge({ config, agency, ao, store, run: store.get(job.jobId), job, now });
    else await sendBrief({ ao, store, run: store.get(job.jobId), job, now });
  }
}

async function projectProblem(config, ao, projectId) {
  if (!config.allowedProjects.includes(projectId)) return `Projekt "${projectId}" ist für die Bridge nicht freigegeben`;
  try {
    const project = await ao.project(projectId);
    if (project.folderMissing) return `Projektordner von "${projectId}" fehlt`;
  } catch (err) {
    if (err instanceof AoUnavailable) throw err;
    return `AO kennt Projekt "${projectId}" nicht`;
  }
  return null;
}

// Idempotent: existiert der Worker schon, wird nichts erneut gesendet.
async function sendBrief({ ao, store, run, job, now }) {
  const { worker } = await findWorker(ao, run.ao_project_id, run.worker_name);
  if (worker) {
    store.update(run.job_id, { state: "running", worker_session_id: worker.id, sent_at: run.sent_at ?? now, last_progress_at: now });
    log("dispatch.skipped", { jobId: run.job_id, reason: "Worker existiert bereits", worker: worker.id });
    return;
  }
  const orch = await ensureOrchestrator(ao, run.ao_project_id);
  store.update(run.job_id, { orchestrator_session_id: orch.id });
  const brief = buildOrchestratorBrief(job);
  await ao.send(orch.id, brief);
  store.update(run.job_id, { state: "running", sent_at: now, last_progress_at: now });
  log("dispatch.sent", { jobId: run.job_id, orchestrator: orch.id, orchestratorCreated: orch.created, chars: brief.length });
}

// ---- Laufende Aufträge nachführen -------------------------------------------

async function syncOpen({ config, agency, ao, store, now }) {
  for (const run of store.open()) {
    try {
      if (run.action === "merge") continue;
      if (run.state === "dispatching" && run.sent_at == null) {
        // Absturz oder AO-Ausfall zwischen Anlegen und Senden: fortsetzen.
        const card = JSON.parse(run.card_json);
        await sendBrief({ ao, store, run, now, job: {
          jobId: run.job_id, ideaId: run.idea_id, dedupeKey: run.dedupe_key, headline: run.headline, instruction: "", ao: card.ao,
        } });
        continue;
      }
      await syncRun({ config, agency, ao, store, run, now });
    } catch (err) {
      if (err instanceof AoUnavailable) {
        log("ao.unavailable", { jobId: run.job_id, error: err.message });
        return;
      }
      log("sync.error", { jobId: run.job_id, error: err.message });
      store.update(run.job_id, { error: err.message.slice(0, 500) });
    }
  }
}

async function syncRun({ config, agency, ao, store, run, now }) {
  let worker = null;
  if (run.worker_session_id) worker = await ao.session(run.worker_session_id);
  else {
    const found = await findWorker(ao, run.ao_project_id, run.worker_name);
    worker = found.worker;
    if (found.duplicates) log("finding.duplicate-worker", { jobId: run.job_id, count: found.duplicates + 1 });
    if (worker) {
      store.update(run.job_id, { worker_session_id: worker.id });
      log("worker.found", { jobId: run.job_id, worker: worker.id, afterMs: now - run.sent_at });
    }
  }
  const prs = worker ? await ao.prs(worker.id) : [];
  const reviewRuns = worker ? (await ao.reviews(worker.id))?.runs ?? [] : [];
  const decision = decide({ run, worker, prs, reviewRuns, now, limits: config.limits });

  const fields = { last_synced_at: now, review_cycles: decision.reviewCycles ?? run.review_cycles };
  if (decision.pr?.url) fields.pr_url = decision.pr.url;
  if (progressed(run, decision)) {
    fields.last_summary = decision.summary;
    fields.last_progress_at = now;
    log("run.progress", { jobId: run.job_id, summary: decision.summary });
  }
  store.update(run.job_id, fields);
  const current = { ...run, ...fields };

  switch (decision.kind) {
    case "wait":
    case "running":
      if (current.agency_job_open && current.state !== "blocked"
          && (fields.last_progress_at === now || now - (run.last_lease_at ?? 0) > config.limits.leaseRefreshMs)) {
        // Live-Status: running + result zeigt Agency auf der Working-Karte, ohne Upsert.
        await agency.updateJob(run.job_id, "running", decision.summary);
        store.update(run.job_id, { last_lease_at: now });
      }
      return;
    case "ready":
      return ready({ agency, ao, store, run: current, decision, now });
    case "blocked":
      if (current.agency_job_open) await block({ agency, store, run: current, reason: decision.reason, now, prUrl: decision.pr?.url });
      return;
    case "completed":
      if (current.agency_job_open) await agency.updateJob(run.job_id, "done", decision.summary, "completed");
      store.update(run.job_id, { state: "completed", agency_job_open: 0 });
      log("run.completed", { jobId: run.job_id });
  }
}

async function ready({ agency, ao, store, run, decision, now }) {
  const card = JSON.parse(run.card_json);
  const pr = decision.pr;
  if (run.agency_job_open) {
    await agency.updateJob(run.job_id, "done", `Geprüfter PR bereit: ${pr.url} — ${decision.reviewSummary}`, "review");
  }
  // Diff-Übersicht für die Merge-Entscheidung: Agencys Layout-Regeln verlangen
  // sie auf der Karte, AO kennt sie nur über den Worker-Worktree.
  let files = [];
  let commits = [];
  try {
    const ws = await ao.workspaceFiles(run.worker_session_id);
    files = (ws.files ?? []).filter((f) => f.status && f.status !== "unmodified");
    commits = (ws.commits ?? []).map((c) => c.subject ?? c.message ?? c.sha).filter(Boolean);
  } catch (err) {
    log("workspace-files.failed", { jobId: run.job_id, error: err.message });
  }
  const cardHtml = mergeCardHtml({
    headline: run.headline, projectId: run.ao_project_id, workerSessionId: run.worker_session_id,
    reviewSummary: decision.reviewSummary, files, commits,
    reviewRuns: decision.reviewRuns ?? [],
    originalCardHtml: card.cardHtml,
    pr: { ...pr, ciState: pr.ci?.state },
  });
  await agency.pushCard({
    project: card.project, category: card.category, headline: `Merge: ${run.headline}`.slice(0, 200),
    dedupeKey: run.dedupe_key, rise: card.rise, cardHtml,
    effortSeconds: 60, effortReason: "PR-Link und Review-Ergebnis prüfen, dann mergen oder nicht",
    agentName: "ao-agency-bridge",
    agentContext: { ao: { projectId: run.ao_project_id, action: "merge", prNumber: pr.number, prUrl: pr.url,
      headSha: pr.headSha, workerSessionId: run.worker_session_id, sourceJobId: run.job_id } },
  });
  store.update(run.job_id, { state: "ready", agency_job_open: 0 });
  log("run.ready", { jobId: run.job_id, pr: pr.url, afterMs: now - run.created_at });
}

// Reihenfolge ist Pflicht: erst Job failed/blocked, dann Ersatzkarte (sonst 409).
// final: nichts mehr zu beobachten (z. B. nie an AO übergeben).
async function block({ agency, store, run, reason, now, prUrl, final = false }) {
  await agency.updateJob(run.job_id, "failed", reason, "blocked");
  store.update(run.job_id, { state: final ? "failed" : "blocked", agency_job_open: 0, error: reason });
  log("run.blocked", { jobId: run.job_id, reason });
  try {
    await agency.pushCard({
      dedupeKey: run.dedupe_key, project: JSON.parse(run.card_json).project, category: JSON.parse(run.card_json).category,
      headline: run.headline, blockedJobId: run.job_id, expectedVersion: run.idea_version,
      cardHtml: blockedCardHtml({ headline: run.headline, projectId: run.ao_project_id, reason, workerSessionId: run.worker_session_id, prUrl }),
      rise: JSON.parse(run.card_json).rise,
    });
  } catch (err) {
    // 409 = Karte hat sich geändert; der Job-Abschluss mit Grund ist trotzdem sichtbar.
    log("blocked-card.failed", { jobId: run.job_id, error: err.message });
  }
}

async function handleMerge({ config, agency, ao, store, run, job, now }) {
  if (!config.allowMerge) {
    return block({ agency, store, run, reason: "Merge über die Bridge ist in diesem Setup deaktiviert (BRIDGE_ALLOW_MERGE)", now, final: true });
  }
  const { workerSessionId, headSha, prNumber } = job.ao;
  const pr = (await ao.prs(workerSessionId)).find((p) => p.number === prNumber);
  const runs = (await ao.reviews(workerSessionId))?.runs ?? [];
  const approved = runs.some((r) => r.targetSha === pr?.headSha && r.verdict === "approved");
  const problem = !pr ? "PR nicht mehr gefunden"
    : pr.state !== "open" ? `PR ist ${pr.state}`
    : pr.headSha !== headSha ? "PR hat seit dem Review neue Commits"
    : pr.ci?.state === "failing" ? "CI ist rot"
    : pr.mergeability?.state !== "mergeable" ? `PR nicht mergebar (${pr.mergeability?.state})`
    : (pr.review?.unresolvedThreadCount ?? 0) > 0 ? "offene Review-Threads"
    : !approved ? "kein AO-Review für den aktuellen Stand" : null;
  if (problem) return block({ agency, store, run, reason: `Merge abgebrochen: ${problem}`, now, final: true });
  await ao.merge(prNumber);
  await agency.updateJob(run.job_id, "done", `PR #${prNumber} gemerged`, "completed");
  store.update(run.job_id, { state: "completed", agency_job_open: 0 });
  log("merge.done", { jobId: run.job_id, pr: prNumber });
}

// ---- Start ------------------------------------------------------------------

async function main() {
  const config = loadConfig();
  const agency = createAgencyClient(config.agencyUrl);
  const ao = createAoClient(config.aoRunFile);
  const store = openStore(config.dbPath);
  const once = process.argv.includes("--once");
  log("bridge.start", { agency: config.agencyUrl, aoRunFile: config.aoRunFile, allowed: config.allowedProjects, once });
  let backoff = config.pollMs;
  for (;;) {
    try {
      await tick({ config, agency, ao, store });
      backoff = config.pollMs;
    } catch (err) {
      log(err instanceof AoUnavailable ? "ao.unavailable" : "tick.error", { error: err.message });
      backoff = Math.min(backoff * 2, 5 * 60_000);
    }
    if (once) break;
    await sleep(backoff);
  }
  store.close();
}

if (process.argv[1]?.endsWith("index.mjs")) {
  await main();
}
