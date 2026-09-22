import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { loadConfig } from "./lib/config.mjs";
import { AoUnavailable, createAoClient, ensureOrchestrator, findWorker } from "./lib/ao-client.mjs";
import { aoJobFromAgencyJob, createAgencyClient } from "./lib/agency-client.mjs";
import { blockedCardHtml, mergeCardHtml } from "./lib/cards.mjs";
import { buildOrchestratorBrief, workerNameFor } from "./lib/contract.mjs";
import { mergeProblem } from "./lib/merge.mjs";
import { analysisAllowed, dispatchProblem, readPipeline, requiresGreenCi, syncProjects } from "./lib/pipeline.mjs";
import { buildRunnerPrompt, runnerCard, runnerPaths } from "./lib/runner.mjs";
import { localRunnerAlive, resolveClaudeBinary, startLocalRunner } from "./lib/runner-launch.mjs";
import { writeRepoMap } from "./lib/repo-map.mjs";
import { decide, progressed } from "./lib/status.mjs";
import { openStore } from "./lib/store.mjs";

export function log(event, fields = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));
}

// Der Start des Runners und das Erheben der Repo-Karte fassen echte Prozesse
// und das Dateisystem an. Als Bündel hereingereicht bleiben sie im Test
// ersetzbar, ohne dass ein Test wirklich claude startet.
export const realRunner = {
  start: startLocalRunner,
  alive: localRunnerAlive,
  resolveBinary: () => resolveClaudeBinary(),
  writeRepoMap,
};

export async function tick({ config, agency, ao, store, pipeline = {}, now = Date.now(), runner = realRunner }) {
  await dispatchNew({ config, agency, ao, store, pipeline, now, runner });
  await syncOpen({ config, agency, ao, store, pipeline, now, runner });
}

// ---- Neue Jobs übernehmen ----------------------------------------------------

async function dispatchNew({ config, agency, ao, store, pipeline, now, runner }) {
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

    const problem = await projectProblem(ao, pipeline, job.ao.projectId, action);
    if (problem) {
      // Nie an AO übergeben: abschließen, nicht weiter beobachten.
      await block({ agency, store, run: store.get(job.jobId), reason: problem, now, final: true });
      continue;
    }
    if (action === "merge") await handleMerge({ config, agency, ao, store, run: store.get(job.jobId), job, pipeline, now });
    else if (action === "discover") await handleDiscover({ config, agency, ao, store, run: store.get(job.jobId), pipeline, now, runner });
    else if (action === "implement") await sendBrief({ ao, store, run: store.get(job.jobId), job, now });
    else if (action === "acknowledge") {
      // "Gesehen": kein Auftrag, nur das Abhaken. Die Karte ist damit erledigt
      // und wird nicht erneut gelegt (pushed_cards).
      await agency.updateJob(job.jobId, "done", "Zur Kenntnis genommen", "completed");
      store.update(job.jobId, { state: "completed", agency_job_open: 0 });
      log("acknowledged", { jobId: job.jobId, projectId: job.ao.projectId, pr: job.ao.prNumber ?? null });
    } else {
      // Unbekannte Aktion: lieber sichtbar blockieren als still etwas tun,
      // das niemand gemeint hat.
      await block({ agency, store, run: store.get(job.jobId), now, final: true,
        reason: `Die Bridge kennt keine Aktion "${action}" — nur implement, merge, discover und acknowledge` });
    }
  }
}

// Die beiden Freigaben gelten für verschiedene Aktionen: ein Discovery-Lauf
// liest nur (analysieren), ein Auftrag verändert das Repo (umsetzen).
async function projectProblem(ao, pipeline, projectId, action) {
  const notAllowed = action === "discover"
    ? (analysisAllowed(pipeline, projectId) ? null
      : `Projekt "${projectId}" ist in pipeline.json nicht zur Analyse freigegeben (analysieren: false)`)
    : dispatchProblem(pipeline, projectId);
  if (notAllowed) return notAllowed;
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

async function syncOpen({ config, agency, ao, store, pipeline, now, runner }) {
  for (const run of store.open()) {
    try {
      if (run.action === "merge") continue;
      if (run.action === "discover") {
        await syncDiscover({ config, agency, ao, store, run, pipeline, now, runner });
        continue;
      }
      if (run.state === "dispatching" && run.sent_at == null) {
        // Absturz oder AO-Ausfall zwischen Anlegen und Senden: fortsetzen.
        const card = JSON.parse(run.card_json);
        await sendBrief({ ao, store, run, now, job: {
          jobId: run.job_id, ideaId: run.idea_id, dedupeKey: run.dedupe_key, headline: run.headline, instruction: "", ao: card.ao,
        } });
        continue;
      }
      await syncRun({ config, agency, ao, store, run, pipeline, now });
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

async function syncDiscover({ config, agency, ao, store, run, pipeline, now, runner }) {
  // AO-Sessions werden wie bisher beim Start abgeschlossen. Nur der lokale
  // Prozess kann hier ohne teuren API-Aufruf exakt beobachtet werden.
  if (!String(run.worker_session_id ?? "").startsWith("lokal:")) return;
  if (runner.alive(run.worker_session_id)) return;

  const project = await ao.project(run.ao_project_id);
  const entry = pipeline[run.ao_project_id] ?? {};
  const paths = runnerPaths(config, run.ao_project_id);
  const pid = String(run.worker_session_id).replace("lokal:", "");
  await agency.updateJob(run.job_id, "done", "Discovery-Run beendet; neue Vorschläge stehen im Feed", "completed");
  store.update(run.job_id, { state: "completed", agency_job_open: 0, last_summary: "Discovery-Run beendet" });
  await pushRunnerCard({
    agency, projectId: run.ao_project_id, projectPath: project.path,
    maxKarten: entry.maxKarten ?? 3, docFile: paths.docFile, now,
    note: `beendet (Prozess ${pid})`,
  });
  log("discover.completed", { jobId: run.job_id, projectId: run.ao_project_id, session: run.worker_session_id });
}

async function syncRun({ config, agency, ao, store, run, pipeline, now }) {
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
  const limits = { ...config.limits, requireGreenCi: requiresGreenCi(pipeline, run.ao_project_id) };
  const decision = decide({ run, worker, prs, reviewRuns, now, limits });

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

// Läuft für dieses Projekt schon ein Lauf? Im AO-Modus fragt das AO, im
// lokalen Modus der zuletzt vermerkte Prozess. Beides beantwortet dieselbe
// Frage: einen zweiten Lauf nicht noch einmal bezahlen.
async function runnerAlreadyRunning({ config, ao, store, run, runner }) {
  if (config.runnerMode === "ao") {
    const { worker } = await findWorker(ao, run.ao_project_id, run.worker_name);
    return worker ? `Session ${worker.id}` : null;
  }
  const id = store.priorDiscoverSession(run.ao_project_id, run.job_id);
  return id && runner.alive(id) ? `Prozess ${String(id).replace("lokal:", "")}` : null;
}

async function pushRunnerCard({ agency, projectId, projectPath, maxKarten, docFile, now, note }) {
  try {
    await agency.pushCard(runnerCard({
      projectId, projectPath, maxKarten, docFile,
      lastRunAt: new Date(now).toISOString().slice(0, 16).replace("T", " "),
      lastRunNote: note,
    }));
  } catch (err) {
    log("runner-card.failed", { projectId, error: err.message });
  }
}

// Ein Klick auf "Runner starten": genau ein Lauf, der das Projekt liest und
// Karten pusht. Die Karten kommen vom Runner selbst, nicht von hier — die
// Bridge meldet nur, dass der Lauf angefangen hat.
async function handleDiscover({ config, agency, ao, store, run, pipeline, now, runner }) {
  const projectId = run.ao_project_id;
  const busy = await runnerAlreadyRunning({ config, ao, store, run, runner });
  if (busy) {
    // Doppelklick oder erneut ausgegebener Job: nicht noch einen Lauf bezahlen.
    await agency.updateJob(run.job_id, "done", `Runner läuft bereits (${busy})`, "completed");
    store.update(run.job_id, { state: "completed", agency_job_open: 0 });
    log("discover.skipped", { jobId: run.job_id, reason: "Lauf existiert bereits", busy });
    return;
  }

  const project = await ao.project(projectId);
  const entry = pipeline[projectId] ?? {};
  const paths = runnerPaths(config, projectId);

  // Maßnahme 4: die Fakten über das Repo einmal ohne Modell erheben. Schlägt
  // das fehl, läuft der Runner trotzdem — er erkundet dann eben selbst.
  try {
    const map = await runner.writeRepoMap({
      projectId, projectPath: project.path, outFile: paths.repoMapFile, now,
    });
    log("repo-map.written", { projectId, ...map });
  } catch (err) {
    log("repo-map.failed", { projectId, error: err.message });
  }

  const prompt = buildRunnerPrompt({
    projectId,
    projectPath: project.path,
    maxKarten: entry.maxKarten ?? 3,
    agencyUrl: config.agencyUrl,
    paths,
  });

  let sessionId;
  let note;
  if (config.runnerMode === "ao") {
    const session = await ao.spawn({
      projectId, kind: "worker", displayName: run.worker_name,
      harness: config.runnerHarness, model: config.runnerModel, prompt,
    });
    sessionId = session.id;
    note = `Session ${session.id}`;
  } else {
    await mkdir(paths.cardDir, { recursive: true });
    const started = await runner.start({
      binary: runner.resolveBinary(),
      model: config.runnerModel,
      prompt,
      // Nicht im Projektordner: der Runner soll dort nichts anlegen. Er liest
      // es über den absoluten Pfad, den --add-dir freigibt.
      cwd: join(config.laufzeitDir, "runner-cwd", projectId),
      addDirs: [project.path, config.profilDir, paths.skillDir, join(config.agencyPath, "scripts"), paths.cardDir],
      writeDir: paths.cardDir,
      logFile: join(config.laufzeitDir, `runner-${projectId}.log`),
    });
    sessionId = `lokal:${started.pid}`;
    note = `Prozess ${started.pid}, Protokoll ${started.logFile}`;
  }

  if (config.runnerMode === "ao") {
    await agency.updateJob(run.job_id, "done", `Runner gestartet (${note}), Karten folgen im Feed`, "completed");
    store.update(run.job_id, { state: "completed", agency_job_open: 0, worker_session_id: sessionId, last_summary: "Runner gestartet" });
    await pushRunnerCard({
      agency, projectId, projectPath: project.path, maxKarten: entry.maxKarten ?? 3,
      docFile: paths.docFile, now, note,
    });
  } else {
    const summary = `Discovery-Run für ${projectId} läuft (${note})`;
    await agency.updateJob(run.job_id, "running", summary);
    store.update(run.job_id, { state: "running", agency_job_open: 1, worker_session_id: sessionId,
      last_summary: summary, last_progress_at: now });
  }
  log("discover.started", { jobId: run.job_id, projectId, mode: config.runnerMode, session: sessionId, chars: prompt.length });
}

async function handleMerge({ config, agency, ao, store, run, job, pipeline, now }) {
  if (!config.allowMerge) {
    return block({ agency, store, run, reason: "Merge über die Bridge ist in diesem Setup abgeschaltet (BRIDGE_ALLOW_MERGE=0)", now, final: true });
  }
  const { workerSessionId, headSha, prNumber } = job.ao;
  const pr = (await ao.prs(workerSessionId)).find((p) => p.number === prNumber);
  const reviewRuns = (await ao.reviews(workerSessionId))?.runs ?? [];
  const problem = mergeProblem({ pr, reviewRuns, expectedHeadSha: headSha, requireGreenCi: requiresGreenCi(pipeline, run.ao_project_id) });
  if (problem) {
    log("merge.refused", { jobId: run.job_id, pr: prNumber, reason: problem });
    return block({ agency, store, run, reason: `Merge abgebrochen: ${problem}`, now, prUrl: pr?.url, final: true });
  }
  // AO verlangt prUrl und expectedHeadSha und prüft selbst noch einmal gegen
  // GitHub: schiebt jemand in der Sekunde dazwischen, gibt es 409 statt Merge.
  await ao.merge(prNumber, { prUrl: pr.url, expectedHeadSha: pr.headSha });
  await agency.updateJob(run.job_id, "done", `PR #${prNumber} gemerged (${pr.headSha.slice(0, 7)})`, "completed");
  store.update(run.job_id, { state: "completed", agency_job_open: 0, pr_url: pr.url });
  log("merge.done", { jobId: run.job_id, pr: prNumber, head: pr.headSha });
}

// ---- Start ------------------------------------------------------------------

async function main() {
  const config = loadConfig();
  const agency = createAgencyClient(config.agencyUrl);
  const ao = createAoClient(config.aoRunFile);
  await mkdir(config.laufzeitDir, { recursive: true });
  const store = openStore(config.dbPath);
  const once = process.argv.includes("--once");
  log("bridge.start", {
    agency: config.agencyUrl, aoRunFile: config.aoRunFile, pipeline: config.pipelineFile,
    allowMerge: config.allowMerge, once,
  });

  // Abgleich und Jobs haben getrennte Uhren: ein Agency-Ausfall bremst über
  // den Backoff sonst auch den Projektabgleich aus, der nur AO braucht.
  let lastSync = 0;
  let nextTickAt = 0;
  let backoff = config.pollMs;
  for (;;) {
    const now = Date.now();
    if (now - lastSync >= config.syncMs) {
      lastSync = now;
      try {
        await syncProjects({ ao, agency, config, store, now, log });
      } catch (err) {
        log(err instanceof AoUnavailable ? "ao.unavailable" : "sync.error", { error: err.message });
      }
    }
    if (now >= nextTickAt) {
      try {
        const pipeline = await readPipeline(config.pipelineFile);
        await tick({ config, agency, ao, store, pipeline, now });
        backoff = config.pollMs;
      } catch (err) {
        log(err instanceof AoUnavailable ? "ao.unavailable" : "tick.error", { error: err.message });
        backoff = Math.min(backoff * 2, 5 * 60_000);
      }
      nextTickAt = Date.now() + backoff;
    }
    if (once) break;
    await sleep(Math.min(config.pollMs, config.syncMs));
  }
  store.close();
}

if (process.argv[1]?.endsWith("index.mjs")) {
  await main();
}
