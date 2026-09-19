// Reine Entscheidungslogik: AO-Fakten → was die Bridge an Agency meldet.
// Bewusst nicht aus AOs Kanban-Spalte abgeleitet: AO setzt einen PR ohne
// Pflicht-Checks sofort auf "Mergeable", bevor der eigene Review gelaufen ist.
//
// Ergebnis: { kind, reason, summary, pr?, reviewCycles }
//   kind ∈ wait | running | ready | blocked | completed

const ACTIVE_PR_STATES = new Set(["open", "draft"]);
const DONE_REVIEW = new Set(["complete", "delivered"]);

export function decide({ run, worker, prs = [], reviewRuns = [], now, limits }) {
  const sinceSent = now - (run.sent_at ?? run.created_at);

  if (!worker) {
    if (sinceSent > limits.workerTimeoutMs) {
      return { kind: "blocked", reason: `Orchestrator hat nach ${minutes(sinceSent)} min keinen Worker "${run.worker_name}" gestartet` };
    }
    return { kind: "wait", summary: `Orchestrator plant, Worker ${run.worker_name} noch nicht gestartet` };
  }

  const merged = prs.find((p) => p.state === "merged");
  const pr = prs.find((p) => ACTIVE_PR_STATES.has(p.state));
  const status = worker.status;
  const display = worker.displayStatus ?? status;

  if (merged && !pr) return { kind: "completed", summary: `PR #${merged.number} gemerged`, pr: merged };

  if (!pr) {
    if (prs.some((p) => p.state === "closed")) return { kind: "blocked", reason: "PR wurde ohne Merge geschlossen", pr: prs[0] };
    if (worker.isTerminated || status === "terminated") return { kind: "blocked", reason: "Worker beendet ohne PR" };
    if (status === "exited") return { kind: "blocked", reason: "Worker-Agent hat sich ohne PR beendet" };
    if (status === "needs_input") return { kind: "blocked", reason: `Worker wartet auf Eingabe – in AO antworten (${worker.id})` };
    if (stalled(run, now, limits)) return { kind: "blocked", reason: `Kein Fortschritt seit ${minutes(now - run.last_progress_at)} min (${display})` };
    return { kind: "running", summary: `Worker ${worker.id}: ${display}` };
  }

  const ci = pr.ci?.state ?? "unknown";
  const runsForPr = reviewRuns.filter((r) => !r.prUrl || r.prUrl === pr.url);
  const reviewCycles = runsForPr.filter((r) => r.verdict === "changes_requested").length;
  const headRun = latest(runsForPr.filter((r) => r.targetSha === pr.headSha));
  const review = headRun ? `${headRun.status}/${headRun.verdict || "—"}` : "noch kein Review für aktuellen Stand";
  const summary = `PR #${pr.number} · ${display} · CI ${ci} · Review ${review}`;

  if (reviewCycles > limits.maxReviewCycles) {
    return { kind: "blocked", reason: `${reviewCycles} Review-Runden ohne Freigabe`, pr, reviewCycles };
  }
  if (worker.isTerminated || status === "terminated") return { kind: "blocked", reason: "Worker beendet, PR offen und nicht geprüft", pr, reviewCycles };
  if (status === "needs_input") return { kind: "blocked", reason: `Worker wartet auf Eingabe – in AO antworten (${worker.id})`, pr, reviewCycles };

  const reviewed = headRun && DONE_REVIEW.has(headRun.status) && headRun.verdict === "approved";
  if (reviewed && pr.state === "open" && ci !== "failing" && ci !== "pending") {
    return {
      kind: "ready", summary, pr, reviewCycles,
      reviewSummary: `${headRun.harness} hat ${shortSha(pr.headSha)} freigegeben`
        + (reviewCycles ? ` (nach ${reviewCycles} Runde${reviewCycles > 1 ? "n" : ""} mit Änderungswünschen)` : ""),
      reviewRuns: [...runsForPr].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
    };
  }
  if (stalled(run, now, limits)) return { kind: "blocked", reason: `Kein Fortschritt seit ${minutes(now - run.last_progress_at)} min (${summary})`, pr, reviewCycles };
  return { kind: "running", summary, pr, reviewCycles };
}

// Fortschritt = die sichtbare Zusammenfassung hat sich geändert.
export function progressed(run, decision) {
  return decision.summary !== undefined && decision.summary !== run.last_summary;
}

function stalled(run, now, limits) {
  return run.last_progress_at != null && now - run.last_progress_at > limits.stallMs;
}

function latest(runs) {
  return runs.reduce((best, r) => (!best || String(r.createdAt) > String(best.createdAt) ? r : best), null);
}

function minutes(ms) {
  return Math.round(ms / 60_000);
}

function shortSha(sha) {
  return String(sha ?? "").slice(0, 7);
}
