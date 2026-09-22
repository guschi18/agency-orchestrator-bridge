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
    cardDir: join(config.agencyPath, "agent-work", `discovery-${projectId}`),
    meFile: join(config.profilDir, "me.md"),
    docFile: join(config.projectDocsDir, `${projectId}.md`),
    projectsFile: config.projectsFile,
    exampleDir: join(config.profilDir, "karten-beispiel"),
    // Von der Bridge vor dem Start erzeugt, ohne Modell. Siehe repo-map.mjs.
    repoMapFile: join(config.laufzeitDir, `repo-map-${projectId}.md`),
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
   - ${p.exampleDir}\\card.json und card.html  (fertiges Beispiel einer Karte: Format und Felder)

   Das Kartenformat steht damit vollständig fest. Lies **nicht** Agencys Quellcode
   (\`app/\`, \`lib/\`, README), um es zu verstehen — das kostet nur Token.

2. Lies zuerst ${p.repoMapFile}. Darin stehen — bereits erhoben, ohne dass es dich
   einen Turn kostet — Dateibaum, Zeilenzahlen, Testdateien, Einstiegspunkte, die
   letzten Commits und das Ungetrackte. Verschaffe dir **keinen** eigenen Überblick
   mit \`ls\`, \`find\` oder \`git log\`: das ist doppelte Arbeit und teuer.

3. Untersuche **nur** \`${projectPath}\` und **nur lesend**: gezielt die Dateien, die
   nach der Repo-Karte zählen, dazu die in der Projektdatei genannten Quellen. Nichts
   ändern, nichts committen, nichts pushen, keine \`.env\` lesen, keine Secrets in
   Karten schreiben.

   Wichtig: Du läufst in einem eigenen AO-Arbeitsverzeichnis, nicht im Projektordner.
   Lies \`${projectPath}\` über den absoluten Pfad — dort stehen auch die Dateien, die
   nicht eingecheckt sind.

4. Finde die wertvollsten Verbesserungen nach den Maßstäben der Projektdatei und pushe
   **höchstens ${maxKarten} Karten** an die laufende Agency unter ${agencyUrl}
   (POST /api/ideas mit Header \`x-radar-local-agent: 1\`). Lege \`card.json\`
   und \`card.html\` ausschließlich unter ${p.cardDir} mit dem Write-Werkzeug an
   und pushe jede Karte einzeln mit \`node "${p.pushCard}" <meta.json>\`. Das
   Verzeichnis existiert bereits; benutze keine Shell-Umleitung, kein \`cat\`
   und keine verketteten Shell-Befehle.
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

5. Prüfe nach dem Push mit einem einzelnen \`node -e\`-Aufruf und \`fetch\`, dass
   die Karten in GET ${agencyUrl}/api/state angekommen sind. Verwende keine
   \`curl | grep\`-Pipe; erlaubt sind einzelne Node-Aufrufe.

6. Antworte am Ende mit: Liste der Karten (id, dedupeKey, Titel, RISE) und was du nicht
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

export const DEFAULT_COST_NOTE =
  "grob 0,45 $ je Lauf (Hochrechnung; gemessen waren 2,71 $ — vor Sonnet, Repo-Karte und schlankem Präfix)";

export function runnerCardHtml({ projectId, projectPath, maxKarten, docFile, lastRunAt, lastRunNote, costNote = DEFAULT_COST_NOTE }) {
  const rows = [
    ["Projekt", projectId],
    ["Ordner", String(projectPath).replaceAll("\\", "/")],
    ["Budget", `höchstens ${maxKarten} Karten`],
    ["Maßstab", String(docFile).replaceAll("\\", "/")],
    // Kein Messwert mehr, sondern die Hochrechnung der Token-Analyse: der
    // gemessene Lauf war Opus mit vollem Präfix und ohne Repo-Karte. Die alte
    // Zahl bleibt daneben stehen, damit der Maßstab sichtbar bleibt.
    ["Kosten", costNote],
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

export function runnerCard({ projectId, projectPath, maxKarten = 3, docFile, lastRunAt, lastRunNote, costNote }) {
  return {
    project: projectId,
    category: projectId,
    headline: `Neue Vorschläge für ${projectId} suchen`.slice(0, 200),
    dedupeKey: runnerDedupeKey(projectId),
    cardHtml: runnerCardHtml({ projectId, projectPath, maxKarten, docFile, lastRunAt, lastRunNote, costNote }),
    // Agency sortiert den Stapel nach RISE. Der Knopf ist kein Befund, sondern
    // eine Möglichkeit — er gehört ans Ende: erst die angefangene Arbeit zu
    // Ende entscheiden, dann neue suchen. Deshalb bewusst der Bodenwert.
    rise: { reach: 1, impact: 1, strategicFit: 1, ease: 5 },
    effortSeconds: 30,
    effortReason: "Entscheiden, ob sich ein Lauf über dieses Projekt jetzt lohnt",
    agentName: "ao-agency-bridge",
    agentContext: { ao: { projectId, action: "discover" } },
  };
}
