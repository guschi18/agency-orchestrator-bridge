// Offene Pull Requests, die nicht aus einem AO-Auftrag stammen.
//
// Anlass: Die CI-Action kam als PR direkt nach GitHub, an den Karten vorbei —
// und war damit unsichtbar. Alles, was am Entscheidungsstapel vorbeiläuft,
// läuft auch an der Entscheidung vorbei.
//
// Quelle ist die gh-CLI als Unterprozess, nicht die GitHub-API: gh ist bereits
// angemeldet, also braucht die Bridge kein Token und speichert keines.
// Diese Karten tragen bewusst **keinen** Merge-Knopf: ohne AO-Review fehlt die
// Grundlage für den Live-Recheck, und ohne die wird hier nichts gemergt.
// Agency verlangt aber auf jeder Karte eine Entscheidung — eine reine
// Hinweiskarte lehnt es mit 400 ab, und zu Recht: ein Stapel ist kein Feed.
// Die mögliche Entscheidung ist hier "gesehen": du entscheidest auf GitHub,
// die Karte verschwindet und kommt nicht wieder.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { escapeHtml } from "./cards.mjs";

const run = promisify(execFile);

export function foreignPrDedupeKey(projectId, number) {
  return `${projectId}:pr-${number}`;
}

// "https://github.com/guschi18/polnisch-app.git" → "guschi18/polnisch-app"
export function repoSlug(repoUrl) {
  const match = String(repoUrl ?? "").match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/i);
  return match ? match[1] : null;
}

const FIELDS = "number,title,headRefName,isDraft,author,additions,deletions,changedFiles,url,createdAt,statusCheckRollup";

export async function listOpenPrs(slug, exec = run) {
  const { stdout } = await exec("gh", ["pr", "list", "--repo", slug, "--state", "open", "--limit", "30", "--json", FIELDS],
    { windowsHide: true, maxBuffer: 4_000_000 });
  return JSON.parse(stdout || "[]");
}

// Ein PR gehört zu AO, wenn sein Branch im ao/-Namensraum liegt oder die Bridge
// ihn selbst kennt. Alles andere ist "fremd" — auch die eigenen Handgriffe.
export function isForeign(pr, knownUrls) {
  if (knownUrls.has(pr.url)) return false;
  return !/^ao\//.test(String(pr.headRefName ?? ""));
}

export function ciState(pr) {
  const checks = (pr.statusCheckRollup ?? []).map((c) => c.conclusion ?? c.state).filter(Boolean);
  if (!checks.length) return "unknown";
  if (checks.some((c) => ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED"].includes(c))) return "failing";
  if (checks.some((c) => ["PENDING", "IN_PROGRESS", "QUEUED", "EXPECTED"].includes(c))) return "pending";
  return checks.every((c) => ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(c)) ? "passing" : "unknown";
}

const STYLE = `<style>
.aof{font:15px/1.5 system-ui,sans-serif;padding:20px;display:grid;gap:14px;max-width:760px}
.aof h2{margin:0;font-size:19px}
.aof p{margin:0}
.aof dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:0}
.aof dt{opacity:.65}.aof dd{margin:0}
.aof code{font:13px/1.4 ui-monospace,Consolas,monospace;word-break:break-all}
.aof .row{display:flex;gap:8px;flex-wrap:wrap}
.aof button{padding:8px 14px;border-radius:8px;border:1px solid currentColor;background:none;font:inherit;cursor:pointer}
.aof .hint{padding:8px 12px;border-radius:8px;background:rgba(128,128,128,.14)}
@media (max-width:420px){.aof{padding:14px}.aof dl{grid-template-columns:1fr;gap:0}.aof dt{margin-top:6px}}
</style>`;

const CI_TEXT = { passing: "grün", failing: "rot", pending: "läuft noch", unknown: "keine Checks" };

export function foreignPrCardHtml({ projectId, pr }) {
  const ci = ciState(pr);
  return `${STYLE}<div class="aof">
<h2>${escapeHtml(pr.title)}</h2>
<p>Dieser Pull Request ist offen, stammt aber <strong>nicht</strong> aus einem AO-Auftrag —
er wurde von Hand angelegt. Deshalb hat ihn kein AO-Reviewer geprüft.</p>
<dl>${[
  ["Projekt", projectId],
  ["Pull Request", `#${pr.number}`],
  ["Branch", pr.headRefName],
  ["Von", pr.author?.login ?? "?"],
  ["Änderung", `${pr.changedFiles ?? "?"} Dateien, +${pr.additions ?? "?"} / −${pr.deletions ?? "?"}`],
  ["Tests (CI)", CI_TEXT[ci]],
  ["Entwurf", pr.isDraft ? "ja" : "nein"],
].map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join("")}</dl>
<p class="hint">Mergen geht hier nicht: Der Merge-Weg der Bridge verlangt ein AO-Review
für genau diesen Commit, und das gibt es ohne AO-Auftrag nicht. Entscheide auf GitHub.</p>
<div class="row">
<button data-radar-action="open" data-radar-url="${escapeHtml(pr.url)}">Pull Request ansehen ↗</button>
<button data-radar-action="do" data-radar-prompt="${escapeHtml(`PR #${pr.number} in ${projectId} zur Kenntnis genommen.`)}">Gesehen</button>
</div>
</div>`;
}

export function foreignPrCard({ projectId, pr }) {
  return {
    project: projectId,
    category: projectId,
    headline: `Offener PR ohne AO-Auftrag: ${pr.title}`.slice(0, 200),
    dedupeKey: foreignPrDedupeKey(projectId, pr.number),
    cardHtml: foreignPrCardHtml({ projectId, pr }),
    // Etwas über dem Runner-Knopf, deutlich unter einem echten Befund: ein
    // Hinweis, der nicht untergehen soll, aber nichts verdrängt.
    rise: { reach: 4, impact: 4, strategicFit: 4, ease: 8 },
    effortSeconds: 45,
    effortReason: "Ansehen und auf GitHub entscheiden, dann hier abhaken",
    agentName: "ao-agency-bridge",
    agentContext: { ao: { projectId, action: "acknowledge", prNumber: pr.number, prUrl: pr.url } },
  };
}
