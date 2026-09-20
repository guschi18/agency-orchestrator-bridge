// Projektabgleich und Freigaben.
//
// AO ist die einzige Wahrheit über Projekte. Diese Datei spiegelt das
// AO-Register in drei Artefakte, die der Runner und die Bridge lesen:
//   profil/ao-projects.json   Liste mit Pfad und Typ (erzeugt, nie von Hand)
//   profil/pipeline.json      je Projekt: analysieren? umsetzen? (von Hand)
//   profil/projekte/<id>.md   Ziele und Quellen (Vorlage erzeugt, Inhalt von Hand)
// plus eine Agency-Lane (Topic) je Projekt.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { foreignPrCard, foreignPrDedupeKey, isForeign, listOpenPrs, repoSlug } from "./foreign-prs.mjs";
import { runnerCard, runnerDedupeKey } from "./runner.mjs";

// Neue Projekte stehen absichtlich auf false: ein Tippfehler bei der
// Registrierung darf keine echte Arbeit auslösen.
export const DEFAULT_ENTRY = Object.freeze({ analysieren: false, umsetzen: false, prioritaet: 50, maxKarten: 3 });

export async function readPipeline(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw new Error(`${path} ist kein gültiges JSON: ${err.message}`);
  }
}

// Grund, warum dieses Projekt keinen Auftrag bekommen darf, sonst null.
export function dispatchProblem(pipeline, projectId) {
  const entry = pipeline?.[projectId];
  if (!entry) return `Projekt "${projectId}" steht nicht in pipeline.json`;
  if (entry.umsetzen !== true) return `Projekt "${projectId}" ist in pipeline.json nicht zur Umsetzung freigegeben (umsetzen: false)`;
  if (entry.nichtMehrInAo) return `Projekt "${projectId}" ist in AO nicht mehr registriert (seit ${entry.nichtMehrInAo})`;
  return null;
}

export function analysisAllowed(pipeline, projectId) {
  const entry = pipeline?.[projectId];
  return entry?.analysieren === true && !entry.nichtMehrInAo;
}

// A5: Verlangt dieses Projekt einen grünen CI-Check, statt sich mit "nicht rot"
// zu begnügen? Bewusst je Projekt: global gesetzt würde ein Projekt ohne
// GitHub-Action dauerhaft auf "unknown" stehen und nie eine Karte fertigstellen.
export function requiresGreenCi(pipeline, projectId) {
  return pipeline?.[projectId]?.ciGruenVerlangen === true;
}

// Reine Funktion, damit der Abgleich ohne AO und ohne Dateisystem testbar ist.
// Bestehende Einträge bleiben unangetastet — nur `nichtMehrInAo` wird gesetzt
// oder entfernt. Gelöscht wird nie etwas.
export function mergePipeline(current, aoProjects, nowIso) {
  const next = { ...current };
  const added = [];
  const vanished = [];
  const returned = [];
  const known = new Set(aoProjects.map((p) => p.id));

  for (const p of aoProjects) {
    if (!next[p.id]) {
      next[p.id] = { ...DEFAULT_ENTRY };
      added.push(p.id);
      continue;
    }
    if (next[p.id].nichtMehrInAo) {
      const { nichtMehrInAo: _gone, ...rest } = next[p.id];
      next[p.id] = rest;
      returned.push(p.id);
    }
  }
  for (const id of Object.keys(next)) {
    if (known.has(id) || next[id].nichtMehrInAo) continue;
    next[id] = { ...next[id], nichtMehrInAo: nowIso };
    vanished.push(id);
  }
  return { pipeline: sortByKey(next), added, vanished, returned };
}

function sortByKey(obj) {
  return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
}

export function projectDocTemplate(projectId, project = {}) {
  const path = String(project.path ?? "").replaceAll("\\", "/");
  return `# ${projectId}

**Was das ist:** _(eine Zeile: Was ist das Projekt, welche Sprache, wie laufen die Tests?)_
${path ? `Ordner: \`${path}\`\n` : ""}
## Ziel in diesem Quartal
_(ein Satz — woran misst du Erfolg?)_

## Wonach suchen
- _(Art von Befund, die dir wirklich hilft)_

## Wonach nicht suchen
- Design-Umbauten, Refactorings ohne Anlass, neue Abhängigkeiten

## Quellen
_(Code, \`test/\`, \`docs/\`, git log der letzten 4 Wochen …)_

## Grenzen
_(Was darf ein Worker nicht anfassen? Was kann er ohne Secrets nicht prüfen?)_
`;
}

// Legt die Vorlage nur an, wenn die Datei fehlt. Eine gefüllte Projektdatei
// wird nie überschrieben.
export async function ensureProjectDoc(dir, projectId, project) {
  const file = join(dir, `${projectId}.md`);
  try {
    await readFile(file, "utf8");
    return { file, created: false };
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  await mkdir(dir, { recursive: true });
  await writeFile(file, projectDocTemplate(projectId, project), "utf8");
  return { file, created: true };
}

async function writeJson(path, value) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

// Ein Durchlauf des Abgleichs. Läuft beim Start und danach alle 5 Minuten in
// der Bridge-Schleife. AO-Ausfälle werfen (die Schleife bremst dann ab),
// Agency-Ausfälle blockieren den Rest nicht.
export async function syncProjects({ ao, agency, config, store = null, now = Date.now(), log = () => {} }) {
  const aoProjects = await ao.projects();
  const current = await readPipeline(config.pipelineFile);
  const { pipeline, added, vanished, returned } = mergePipeline(current, aoProjects, new Date(now).toISOString());

  await writeJson(config.pipelineFile, pipeline);

  const projects = aoProjects.map((p) => ({
    id: p.id,
    name: p.name,
    path: p.path,
    kind: p.kind,
    folderMissing: Boolean(p.folderMissing),
    orchestratorAgent: p.orchestratorAgent ?? null,
    analysieren: pipeline[p.id]?.analysieren === true,
    bridgeDispatch: pipeline[p.id]?.umsetzen === true,
    maxKarten: pipeline[p.id]?.maxKarten ?? DEFAULT_ENTRY.maxKarten,
    prioritaet: pipeline[p.id]?.prioritaet ?? DEFAULT_ENTRY.prioritaet,
    projektDatei: join(config.projectDocsDir, `${p.id}.md`),
  }));
  await writeJson(config.projectsFile, { syncedAt: new Date(now).toISOString(), projects });

  const docsCreated = [];
  for (const p of projects.filter((p) => p.analysieren)) {
    const { created } = await ensureProjectDoc(config.projectDocsDir, p.id, p);
    if (created) docsCreated.push(p.id);
  }

  // Eine Lane je Projekt, damit du in Agency nach Projekt filtern kannst.
  const topicsFailed = [];
  for (const p of projects) {
    try {
      await agency.upsertTopic(p.id, `${p.kind ?? "repo"} · ${String(p.path).replaceAll("\\", "/")}`.slice(0, 120));
    } catch (err) {
      topicsFailed.push(`${p.id}: ${err.message}`);
    }
  }
  if (topicsFailed.length) log("sync.topics-failed", { failed: topicsFailed.slice(0, 5) });

  const cardsPushed = await ensureRunnerCards({ agency, config, projects, store, log });
  const prCards = await ensureForeignPrCards({ ao, agency, config, projects, store, now, log });

  const result = { count: projects.length, added, vanished, returned, docsCreated, cardsPushed, prCards, pipeline, projects };
  log("sync.done", { count: result.count, added, vanished, returned, docsCreated, cardsPushed, prCards });
  return result;
}

// Offene PRs, die nicht aus einem AO-Auftrag stammen, bekommen eine
// Hinweiskarte — genau einmal. Sonst laufen sie am Stapel vorbei.
async function ensureForeignPrCards({ ao, agency, config, projects, store, now, log }) {
  if (!config.foreignPrCards || !store) return [];
  const pushed = [];
  for (const p of projects.filter((p) => p.analysieren || p.bridgeDispatch)) {
    let slug = null;
    try {
      slug = repoSlug((await ao.project(p.id))?.repo);
    } catch (err) {
      log("foreign-prs.project-failed", { projectId: p.id, error: err.message });
      continue;
    }
    if (!slug) continue; // kein GitHub-Remote: nichts zu holen
    let prs;
    try {
      prs = await listOpenPrs(slug);
    } catch (err) {
      // gh fehlt oder ist nicht angemeldet: kein Grund, den Abgleich zu stoppen.
      log("foreign-prs.skipped", { projectId: p.id, error: err.message.slice(0, 200) });
      continue;
    }
    const known = new Set(store.knownPrUrls?.() ?? []);
    for (const pr of prs) {
      if (!isForeign(pr, known)) continue;
      const key = foreignPrDedupeKey(p.id, pr.number);
      if (store.wasPushed(key)) continue;
      try {
        await agency.pushCard(foreignPrCard({ projectId: p.id, pr }));
        store.markPushed(key, now);
        pushed.push(key);
      } catch (err) {
        log("foreign-pr-card.failed", { key, error: err.message });
      }
    }
  }
  return pushed;
}

// Der Startknopf je freigeschaltetem Projekt. Er gehört dauerhaft in den
// aktiven Stapel: einen neuen Lauf muss man immer anstoßen können.
//
// Deshalb zählt nur "new" und "working". Liegt die Karte in "done" (Lauf
// vorbei), wurde sie übersprungen oder ist sie sonstwie aus dem Stapel
// gefallen, legt der nächste Abgleich sie zurück. Das heilt sich selbst,
// statt sich auf die Reihenfolge rund um den Job-Abschluss zu verlassen.
//
// Aus-Schalter ist "analysieren": false — dann verschwindet auch der Knopf.
const ACTIVE_VIEWS = ["new", "working"];

async function ensureRunnerCards({ agency, config, projects, store, log }) {
  const wanted = projects.filter((p) => p.analysieren && !p.folderMissing);
  if (!wanted.length) return [];
  let existing;
  try {
    existing = await agency.dedupeKeysIn(ACTIVE_VIEWS);
  } catch (err) {
    log("runner-cards.skipped", { error: err.message });
    return [];
  }
  const pushed = [];
  for (const p of wanted) {
    if (existing.has(runnerDedupeKey(p.id))) continue;
    const last = store?.lastDiscover?.(p.id) ?? null;
    try {
      await agency.pushCard(runnerCard({
        projectId: p.id, projectPath: p.path, maxKarten: p.maxKarten, docFile: p.projektDatei,
        lastRunAt: last ? isoMinute(last.created_at) : null,
        lastRunNote: last?.worker_session_id ? `Session ${last.worker_session_id}` : null,
      }));
      pushed.push(p.id);
    } catch (err) {
      log("runner-card.failed", { projectId: p.id, error: err.message });
    }
  }
  return pushed;
}

function isoMinute(ms) {
  return new Date(Number(ms)).toISOString().slice(0, 16).replace("T", " ");
}
