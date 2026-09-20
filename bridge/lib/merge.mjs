// Live-Recheck vor dem Merge (Entscheidung 2 aus Aufbau-Pipeline.md §8).
//
// Zwischen dem Bau der Merge-Karte und deinem Klick können Minuten oder Tage
// liegen. Deshalb wird jede Bedingung unmittelbar vor dem Merge noch einmal
// gegen den echten Stand geprüft, nicht gegen das, was auf der Karte steht.
// Reine Funktion: jede abgelehnte Bedingung hat ihren eigenen Test.

const DONE_REVIEW = new Set(["complete", "delivered"]);

// Grund, warum nicht gemerged werden darf, sonst null.
export function mergeProblem({ pr, reviewRuns = [], expectedHeadSha, requireGreenCi = false }) {
  if (!pr) return "PR nicht mehr gefunden";
  if (pr.state === "merged") return "PR ist bereits gemerged";
  if (pr.state !== "open") return `PR ist ${pr.state}`;
  if (!pr.headSha) return "AO meldet keinen Head-Commit für den PR";
  if (expectedHeadSha && pr.headSha !== expectedHeadSha) {
    return `PR hat seit dem Review neue Commits (${short(expectedHeadSha)} → ${short(pr.headSha)})`;
  }

  const ci = pr.ci?.state ?? "unknown";
  if (ci === "failing") return `CI ist rot${failing(pr)}`;
  if (ci === "pending") return "CI läuft noch";
  if (requireGreenCi && ci !== "passing") return `CI ist nicht grün (${ci}) — ohne grünen Check wird nicht gemerged`;

  const mergeability = pr.mergeability?.state ?? "unknown";
  if (mergeability !== "mergeable") {
    const why = (pr.mergeability?.reasons ?? []).join(", ");
    return `PR ist nicht mergebar (${mergeability}${why ? `: ${why}` : ""})`;
  }

  if ((pr.review?.unresolvedThreadCount ?? 0) > 0) return `${pr.review.unresolvedThreadCount} offene Review-Threads`;
  if (pr.review?.hasUnresolvedHumanComments) return "offene menschliche Review-Kommentare";
  if (pr.review?.decision === "changes_requested") return "GitHub-Review verlangt Änderungen";

  const approved = reviewRuns.some((r) => r.targetSha === pr.headSha && r.verdict === "approved" && DONE_REVIEW.has(r.status));
  if (!approved) return `kein abgeschlossenes AO-Review mit "approved" für ${short(pr.headSha)}`;

  return null;
}

function failing(pr) {
  const names = (pr.ci?.failingChecks ?? []).map((c) => c.name).filter(Boolean);
  return names.length ? ` (${names.slice(0, 3).join(", ")})` : "";
}

function short(sha) {
  return String(sha ?? "").slice(0, 7);
}
