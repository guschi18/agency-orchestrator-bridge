// Dieselben Regeln wie app/api/ideas/route.ts (unsafeHtml) in Agency. Vorab
// prüfen, damit ein 400 nicht erst beim Push auffällt.
export function unsafeCardHtml(html) {
  return /<\s*(script|iframe|object|embed|form|meta|base|link|svg|math|a)\b/i.test(html)
    || /\son[a-z]+\s*=/i.test(html)
    || /javascript\s*:/i.test(html)
    || /@import\b/i.test(html)
    || /url\s*\(\s*["']?(?:https?:)?\/\//i.test(html)
    || /\s(?:src|poster|srcset)\s*=\s*["'](?:https?:)?\/\//i.test(html);
}

export function assertSafeCardHtml(html) {
  if (!html || html.length < 80) throw new Error("Karten-HTML ist kürzer als 80 Zeichen");
  if (unsafeCardHtml(html)) throw new Error("Karten-HTML verletzt die Agency-Sanitizer-Regeln");
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const STYLE = `<style>
.aob{font:15px/1.5 system-ui,sans-serif;padding:20px;display:grid;gap:14px;max-width:760px}
.aob h2{margin:0;font-size:19px}.aob h3{margin:0;font-size:14px;opacity:.7;font-weight:600}
.aob p{margin:0}
.aob dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:0}
.aob dt{opacity:.65}.aob dd{margin:0}
.aob table{border-collapse:collapse;width:100%;font-size:14px}
.aob td,.aob th{text-align:left;padding:4px 8px 4px 0;border-bottom:1px solid rgba(128,128,128,.25);vertical-align:top}
.aob th{opacity:.65;font-weight:500}
.aob .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.aob .add{color:#1a7f37}.aob .del{color:#b3261e}
.aob code{font:13px/1.4 ui-monospace,Consolas,monospace;word-break:break-all}
.aob ul{margin:0;padding-left:18px}
.aob details{border-top:1px solid rgba(128,128,128,.25);padding-top:8px}
.aob summary{cursor:pointer}
.aob .row{display:flex;gap:8px;flex-wrap:wrap}
.aob button{padding:8px 14px;border-radius:8px;border:1px solid currentColor;background:none;font:inherit;cursor:pointer}
.aob .blocked{padding:8px 12px;border-radius:8px;background:rgba(200,60,40,.12)}
@media (max-width:420px){.aob{padding:14px}.aob dl{grid-template-columns:1fr;gap:0 0}.aob dt{margin-top:6px}}
</style>`;

function facts(rows) {
  return `<dl>${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join("")}</dl>`;
}

const STATUS_LABEL = { added: "neu", modified: "geändert", deleted: "gelöscht", renamed: "umbenannt" };

// Die eingebettete Ursprungskarte darf keine eigene Do-Aktion mehr tragen:
// sonst stünde neben "Mergen" ein zweiter Knopf, der dieselbe Arbeit noch
// einmal startet. Ihre Open-Links bleiben erhalten.
export function neutralizeCardActions(html) {
  return String(html ?? "")
    .replace(/data-radar-action\s*=\s*(["'])do\1/gi, 'data-radar-done="1"')
    .replace(/data-radar-prompt\s*=\s*"[^"]*"/gi, "")
    .replace(/data-radar-prompt\s*=\s*'[^']*'/gi, "");
}

function fileTable(files) {
  if (!files?.length) return "";
  const rows = files.map((f) => `<tr><td><code>${escapeHtml(f.path)}</code></td><td>${escapeHtml(STATUS_LABEL[f.status] ?? f.status ?? "")}</td>`
    + `<td class="num add">${f.additions ? `+${f.additions}` : ""}</td><td class="num del">${f.deletions ? `−${f.deletions}` : ""}</td></tr>`).join("");
  return `<table><thead><tr><th>Datei</th><th>Art</th><th class="num">+</th><th class="num">−</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function reviewList(runs) {
  if (!runs?.length) return "";
  const items = runs.map((r) => {
    const verdict = r.verdict === "approved" ? "freigegeben" : r.verdict === "changes_requested" ? "Änderungen verlangt" : (r.verdict || r.status);
    const line = (r.body || "").split("\n").map((s) => s.trim()).find((s) => s && !s.startsWith("#") && !s.startsWith("##")) ?? "";
    return `<li><strong>${escapeHtml(verdict)}</strong> (${escapeHtml(r.harness ?? "")}, ${escapeHtml(String(r.targetSha ?? "").slice(0, 7))}): ${escapeHtml(line.slice(0, 300))}</li>`;
  }).join("");
  return `<ul>${items}</ul>`;
}

// Ersatzkarte nach geprüftem PR: nächste Entscheidung ist der Merge.
// Bewusst derselbe dedupeKey wie die Ursprungskarte: sonst bliebe die alte
// Karte mit ihrem "Mit AO umsetzen"-Knopf im Stapel und ein zweiter Klick
// würde dieselbe Arbeit noch einmal starten. Der ursprüngliche Karteninhalt
// bleibt deshalb aufklappbar erhalten.
export function mergeCardHtml({ headline, projectId, pr, workerSessionId, reviewSummary, files, commits, reviewRuns, originalCardHtml }) {
  const sum = files?.length
    ? `${files.length} Dateien, +${files.reduce((n, f) => n + (f.additions ?? 0), 0)} / −${files.reduce((n, f) => n + (f.deletions ?? 0), 0)}`
    : `${pr.changedFiles ?? "?"} Dateien, +${pr.additions ?? "?"} / −${pr.deletions ?? "?"}`;
  return `${STYLE}<div class="aob">
<h2>${escapeHtml(headline)}</h2>
<p>Die Arbeit ist umgesetzt und von AO geprüft. Offen ist nur noch deine Merge-Entscheidung.</p>
${facts([
  ["Projekt", projectId],
  ["Pull Request", `#${pr.number} · ${pr.title ?? ""}`],
  ["Stand", `${String(pr.headSha ?? "").slice(0, 7)} auf ${pr.sourceBranch ?? "?"} → ${pr.targetBranch ?? "?"}`],
  ["Änderung", sum],
  ["Tests (CI)", pr.ciState === "passing" ? "grün" : pr.ciState === "failing" ? "rot" : "keine CI im Repo — nicht unabhängig geprüft"],
  ["Review", reviewSummary],
  ["AO-Worker", workerSessionId],
])}
<h3>Geänderte Dateien</h3>
${fileTable(files)}
${commits?.length ? `<h3>Commits</h3><ul>${commits.map((c) => `<li>${escapeHtml(String(c).slice(0, 160))}</li>`).join("")}</ul>` : ""}
${reviewRuns?.length ? `<details><summary>Review-Verlauf (${reviewRuns.length})</summary>${reviewList(reviewRuns)}</details>` : ""}
${originalCardHtml ? `<details><summary>Warum diese Arbeit vorgeschlagen wurde</summary>${neutralizeCardActions(originalCardHtml)}</details>` : ""}
<div class="row">
<button data-radar-action="open" data-radar-url="${escapeHtml(pr.url)}">Pull Request ansehen ↗</button>
<button data-radar-action="do" data-radar-prompt="${escapeHtml(`PR #${pr.number} in ${projectId} nach Live-Recheck mergen.`)}">Mergen</button>
</div>
</div>`;
}

export function blockedCardHtml({ headline, projectId, reason, workerSessionId, prUrl }) {
  return `${STYLE}<div class="aob" data-radar-state="blocked">
<h2>${escapeHtml(headline)}</h2>
<p class="blocked">Blockiert: ${escapeHtml(reason)}</p>
${facts([
  ["Projekt", projectId],
  ["AO-Session", workerSessionId ?? "—"],
])}
${prUrl ? `<div class="row"><button data-radar-action="open" data-radar-url="${escapeHtml(prUrl)}">Pull Request ansehen ↗</button></div>` : ""}
</div>`;
}
