// Der Discovery-Runner: Auftragstext und Startkarte.
//
// Die Karte ist der Knopf. Sie liegt in der Lane des Projekts und startet bei
// einem Klick genau einen Lauf — dieselbe Mechanik wie "Mit AO umsetzen", nur
// mit action "discover". Weder Agency noch AO mussten dafür geändert werden.
//
// Auftragstext und Karte stehen hier zusammen, damit das PowerShell-Skript und
// die Bridge nicht zwei Fassungen desselben Auftrags pflegen.
import { join } from "node:path";
import { escapeHtml } from "./cards.mjs";

// POST /sessions nimmt prompt ≤ 16384 (AO openapi: SpawnSessionRequest).
export const MAX_PROMPT = 16_384;

export function runnerDedupeKey(projectId) {
  return `${projectId}:runner`;
}

export function runnerPaths(config, projectId) {
  return {
    skillDir: join(config.agencyPath, "skills", "agency"),
    pushCard: join(config.agencyPath, "scripts", "push-card.mjs"),
    agentWork: join(config.agencyPath, "agent-work"),
    meFile: join(config.profilDir, "me.md"),
    docFile: join(config.projectDocsDir, `${projectId}.md`),
    projectsFile: config.projectsFile,
  };
}

export function buildRunnerPrompt({ projectId, projectPath, maxKarten = 3, agencyUrl, paths }) {
  const p = paths;
  const text = `Du bist der Agency-Runner für einen einmaligen Discovery-Lauf über **ein** Projekt: \`${projectId}\`.

1. Lies diese Dateien vollständig und halte dich an sie:
   - ${p.skillDir}\\SKILL.md
   - ${p.skillDir}\\APPROVALS.md
   - ${p.skillDir}\\LAYOUT.md
   - ${p.meFile}  (gilt immer; hat Vorrang bei Sprache und Ausführung)
   - ${p.docFile}  (Ziele, Quellen und Grenzen genau dieses Projekts)
   - ${p.projectsFile}  (Projekt-ID und Pfad — nie raten)
   - ${p.pushCard}  (so werden Karten gepusht)

2. Untersuche **nur** \`${projectPath}\` und **nur lesend**: Code, Tests, die in der
   Projektdatei genannten Quellen, git log. Nichts ändern, nichts committen, nichts pushen,
   keine \`.env\` lesen, keine Secrets in Karten schreiben.

   Wichtig: Du läufst in einem eigenen AO-Arbeitsverzeichnis, nicht im Projektordner.
   Lies \`${projectPath}\` über den absoluten Pfad — dort stehen auch die Dateien, die
   nicht eingecheckt sind.

3. Finde die wertvollsten Verbesserungen nach den Maßstäben der Projektdatei und pushe
   **höchstens ${maxKarten} Karten** an die laufende Agency unter ${agencyUrl}
   (POST /api/ideas mit Header \`x-radar-local-agent: 1\`, z. B.
   \`node "${p.pushCard}" <meta.json>\` mit Arbeitsdateien unter ${p.agentWork}).
   Lieber weniger Karten als schwache — eine schwache Karte kostet eine echte Entscheidung.

   Jede Karte:
   - \`project\` und \`category\` = "${projectId}"
   - stabiler \`dedupeKey\` "${projectId}:<thema>" — **nie** "${runnerDedupeKey(projectId)}",
     das ist die Karte, die dich gestartet hat
   - vollständiges \`rise\`, \`effortSeconds\` + \`effortReason\`
   - \`agentContext.ao\` = { projectId: "${projectId}", action: "implement", route: "orchestrator",
     task: { objective, evidence[], acceptanceCriteria[], constraints[] } }, zusammen unter 2500 Zeichen
   - eine Do-Aktion "Mit AO umsetzen"
   - Karten-HTML: kein \`<a>\`, \`<script>\`, \`<svg>\`, keine Event-Handler, keine externen Bilder.
     Links nur als \`<button data-radar-action="open" data-radar-url="…">\`.

4. Prüfe nach dem Push mit GET ${agencyUrl}/api/state (Header \`x-radar-local-agent: 1\`),
   dass die Karten angekommen sind.

5. Antworte am Ende mit: Liste der Karten (id, dedupeKey, Titel, RISE) und was du nicht
   prüfen konntest.

Du setzt nichts selbst um. Die Umsetzung startet erst, wenn der Nutzer eine Karte freigibt;
dann übergibt die Bridge sie an den AO-Orchestrator.`;

  if (text.length > MAX_PROMPT) {
    throw new Error(`Runner-Auftrag ist ${text.length} Zeichen lang, AO erlaubt ${MAX_PROMPT}`);
  }
  return text;
}

const CARD_STYLE = `<style>
.aor{font:15px/1.5 system-ui,sans-serif;padding:20px;display:grid;gap:14px;max-width:760px}
.aor h2{margin:0;font-size:19px}
.aor p{margin:0}
.aor dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:0}
.aor dt{opacity:.65}.aor dd{margin:0}
.aor code{font:13px/1.4 ui-monospace,Consolas,monospace;word-break:break-all}
.aor .row{display:flex;gap:8px;flex-wrap:wrap}
.aor button{padding:8px 14px;border-radius:8px;border:1px solid currentColor;background:none;font:inherit;cursor:pointer}
@media (max-width:420px){.aor{padding:14px}.aor dl{grid-template-columns:1fr;gap:0}.aor dt{margin-top:6px}}
</style>`;

export function runnerCardHtml({ projectId, projectPath, maxKarten, docFile, lastRunAt, lastRunNote }) {
  const rows = [
    ["Projekt", projectId],
    ["Ordner", String(projectPath).replaceAll("\\", "/")],
    ["Budget", `höchstens ${maxKarten} Karten`],
    ["Maßstab", String(docFile).replaceAll("\\", "/")],
    ["Kosten", "rund 2,71 $ je Lauf (Messwert aus dem Testlauf)"],
    ["Zuletzt gestartet", lastRunAt ? `${lastRunAt}${lastRunNote ? ` — ${lastRunNote}` : ""}` : "noch nie"],
  ];
  return `${CARD_STYLE}<div class="aor">
<h2>Neue Vorschläge für ${escapeHtml(projectId)} suchen</h2>
<p>Ein Runner liest das Projekt <strong>nur lesend</strong> und legt dir bis zu ${escapeHtml(String(maxKarten))} Karten vor.
Er ändert nichts und committet nichts — umgesetzt wird erst, was du danach einzeln freigibst.</p>
<dl>${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join("")}</dl>
<p>Taugen die Karten nichts, schärfe zuerst den Maßstab in der Projektdatei — nicht die Technik.</p>
<div class="row">
<button data-radar-action="do" data-radar-prompt="${escapeHtml(`Discovery-Lauf für ${projectId} starten.`)}">Runner starten</button>
</div>
</div>`;
}

export function runnerCard({ projectId, projectPath, maxKarten = 3, docFile, lastRunAt, lastRunNote }) {
  return {
    project: projectId,
    category: projectId,
    headline: `Neue Vorschläge für ${projectId} suchen`.slice(0, 200),
    dedupeKey: runnerDedupeKey(projectId),
    cardHtml: runnerCardHtml({ projectId, projectPath, maxKarten, docFile, lastRunAt, lastRunNote }),
    // Bewusst unter den Werten eines echten Befunds: der Knopf soll auffindbar
    // sein, aber nie über der Arbeit stehen, die er gefunden hat.
    rise: { reach: 10, impact: 10, strategicFit: 15, ease: 25 },
    effortSeconds: 30,
    effortReason: "Entscheiden, ob sich ein Lauf über dieses Projekt jetzt lohnt",
    agentName: "ao-agency-bridge",
    agentContext: { ao: { projectId, action: "discover" } },
  };
}
