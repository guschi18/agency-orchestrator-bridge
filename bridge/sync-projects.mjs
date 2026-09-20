// Einmaliger Projektabgleich von Hand. Dieselbe Logik läuft in der Bridge
// alle 5 Minuten (lib/pipeline.mjs); dieses Skript ist für den ersten Aufbau
// und fürs Startskript, das den Abgleich vor dem Bridge-Start einmal anstößt.
import { loadConfig } from "./lib/config.mjs";
import { createAoClient } from "./lib/ao-client.mjs";
import { createAgencyClient } from "./lib/agency-client.mjs";
import { syncProjects } from "./lib/pipeline.mjs";
import { openStore } from "./lib/store.mjs";

const config = loadConfig();
const result = await syncProjects({
  ao: createAoClient(config.aoRunFile),
  agency: createAgencyClient(config.agencyUrl),
  config,
  store: openStore(config.dbPath),
  // Lanes scheitern, solange Agency nicht läuft — das soll man hier sehen.
  log: (event, fields) => { if (event === "sync.topics-failed") console.warn(`Agency-Lanes nicht gesetzt: ${fields.failed.join("; ")}`); },
});

console.log(`${result.count} AO-Projekte gespiegelt nach ${config.projectsFile}`);
if (result.added.length) {
  console.log(`neu in pipeline.json (auf false, bitte freischalten): ${result.added.join(", ")}`);
}
if (result.vanished.length) console.log(`nicht mehr in AO (Eintrag bleibt stehen): ${result.vanished.join(", ")}`);
if (result.returned.length) console.log(`wieder in AO: ${result.returned.join(", ")}`);
if (result.docsCreated.length) console.log(`Projektdatei-Vorlage angelegt: ${result.docsCreated.join(", ")}`);

const offen = Object.entries(result.pipeline).filter(([, e]) => !e.analysieren && !e.nichtMehrInAo).map(([id]) => id);
if (offen.length) console.log(`noch nicht freigeschaltet: ${offen.join(", ")} → ${config.pipelineFile}`);
