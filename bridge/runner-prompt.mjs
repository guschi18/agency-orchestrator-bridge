// Druckt den Runner-Auftrag für ein Projekt. Dieselbe Quelle, die die Bridge
// beim Klick auf "Runner starten" benutzt — damit es nicht zwei Fassungen
// desselben Auftrags gibt, die langsam auseinanderlaufen.
//
//   node runner-prompt.mjs <projektId> [maxKarten] [--out <datei>]
//
// --out schreibt die Datei selbst und gibt nur den Pfad aus. Das ist der Weg
// für PowerShell: über die Pipe liest es Nodes UTF-8-Ausgabe als CP850 und
// macht aus jedem "ü" ein "├╝".
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { loadConfig } from "./lib/config.mjs";
import { readPipeline } from "./lib/pipeline.mjs";
import { writeRepoMap } from "./lib/repo-map.mjs";
import { buildRunnerPrompt, runnerPaths } from "./lib/runner.mjs";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outFile = outIndex >= 0 ? args[outIndex + 1] : null;
const [projectId, maxArg] = outIndex >= 0 ? args.slice(0, outIndex) : args;
if (!projectId || (outIndex >= 0 && !outFile)) {
  console.error("Aufruf: node runner-prompt.mjs <projektId> [maxKarten] [--out <datei>]");
  process.exit(2);
}

const config = loadConfig();
const mirror = JSON.parse(await readFile(config.projectsFile, "utf8"));
const project = mirror.projects.find((p) => p.id === projectId);
if (!project) {
  console.error(`AO kennt kein Projekt "${projectId}". Bekannt: ${mirror.projects.map((p) => p.id).join(", ")}`);
  process.exit(1);
}

const pipeline = await readPipeline(config.pipelineFile);
const maxKarten = Number(maxArg) > 0 ? Number(maxArg) : (pipeline[projectId]?.maxKarten ?? 3);

const paths = runnerPaths(config, projectId);

// Der Auftrag verweist auf die Repo-Karte. Ohne sie zeigt er auf eine Datei,
// die es nicht gibt — also hier erheben, nicht nur bei der Bridge.
await mkdir(config.laufzeitDir, { recursive: true });
try {
  await writeRepoMap({ projectId, projectPath: project.path, outFile: paths.repoMapFile });
} catch (err) {
  console.error(`Repo-Karte konnte nicht erhoben werden: ${err.message}`);
}

const text = buildRunnerPrompt({
  projectId, projectPath: project.path, maxKarten,
  agencyUrl: config.agencyUrl, paths,
});

if (outFile) {
  await writeFile(outFile, text, "utf8");
  console.log(outFile);
} else {
  process.stdout.write(text);
}
