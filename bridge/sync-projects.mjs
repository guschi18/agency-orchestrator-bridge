// Spiegelt das AO-Projektregister für den Agency-Runner: ao-projects.json
// plus ein Agency-Topic je Projekt. AO bleibt die einzige Wahrheit.
import { writeFile } from "node:fs/promises";
import { loadConfig } from "./lib/config.mjs";
import { createAoClient } from "./lib/ao-client.mjs";
import { createAgencyClient } from "./lib/agency-client.mjs";

const config = loadConfig();
const ao = createAoClient(config.aoRunFile);
const agency = createAgencyClient(config.agencyUrl);

const projects = (await ao.projects()).map((p) => ({
  id: p.id,
  name: p.name,
  path: p.path,
  kind: p.kind,
  folderMissing: Boolean(p.folderMissing),
  orchestratorAgent: p.orchestratorAgent ?? null,
  bridgeDispatch: config.allowedProjects.includes(p.id),
}));

await writeFile(config.projectsFile, `${JSON.stringify({ syncedAt: new Date().toISOString(), projects }, null, 2)}\n`);
for (const p of projects) {
  await agency.upsertTopic(p.id, `${p.kind ?? "repo"} · ${String(p.path).replaceAll("\\", "/")}`.slice(0, 120));
}
console.log(`${projects.length} AO-Projekte gespiegelt nach ${config.projectsFile}`);
