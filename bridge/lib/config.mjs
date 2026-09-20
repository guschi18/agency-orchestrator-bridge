import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MINUTE = 60_000;

// Alle Standardpfade hängen am Repo, nicht am Arbeitsverzeichnis: die Bridge
// wird mal aus bridge\, mal aus dem Startskript heraus gestartet.
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadConfig(env = process.env) {
  const profilDir = env.BRIDGE_PROFIL_DIR ?? join(repoRoot, "profil");
  const laufzeitDir = env.BRIDGE_LAUFZEIT_DIR ?? join(repoRoot, "laufzeit");
  return {
    agencyUrl: loopbackUrl(env.AGENCY_URL ?? "http://localhost:3100", "AGENCY_URL"),
    aoRunFile: env.AO_RUN_FILE ?? join(homedir(), ".ao", "running.json"),
    dbPath: env.BRIDGE_DB ?? join(laufzeitDir, "bridge.db"),
    profilDir,
    laufzeitDir,
    // Erzeugt, nicht von Hand gepflegt: Spiegel des AO-Registers für den Runner.
    projectsFile: env.BRIDGE_PROJECTS_FILE ?? join(profilDir, "ao-projects.json"),
    // Die einzige Freigabequelle. Früher: BRIDGE_ALLOWED_PROJECTS.
    pipelineFile: env.BRIDGE_PIPELINE_FILE ?? join(profilDir, "pipeline.json"),
    projectDocsDir: env.BRIDGE_PROJECT_DOCS_DIR ?? join(profilDir, "projekte"),
    // Agency-Klon: der Runner-Auftrag verweist auf dessen Skill und push-card.mjs.
    agencyPath: env.AGENCY_PATH ?? "D:\\Tools\\Agency\\agency",
    // Der Runner denkt, er schreibt nicht — dafür das stärkere Modell.
    runnerHarness: env.BRIDGE_RUNNER_HARNESS ?? "claude-code",
    runnerModel: env.BRIDGE_RUNNER_MODEL ?? "claude-opus-5",
    allowMerge: env.BRIDGE_ALLOW_MERGE !== "0",
    // Hinweiskarten für offene PRs ohne AO-Auftrag. Braucht die gh-CLI;
    // fehlt sie, wird der Abgleich davon nicht aufgehalten.
    foreignPrCards: env.BRIDGE_FOREIGN_PR_CARDS !== "0",
    pollMs: Number(env.BRIDGE_POLL_MS ?? 15_000),
    syncMs: Number(env.BRIDGE_SYNC_MS ?? 5 * MINUTE),
    limits: {
      workerTimeoutMs: Number(env.BRIDGE_WORKER_TIMEOUT_MIN ?? 15) * MINUTE,
      maxReviewCycles: Number(env.BRIDGE_MAX_REVIEW_CYCLES ?? 3),
      stallMs: Number(env.BRIDGE_STALL_MIN ?? 240) * MINUTE,
      leaseRefreshMs: 30 * MINUTE,
    },
  };
}

// Beide Apps sind auf Loopback unauthentifiziert. Die Bridge spricht nie mit
// einem anderen Host, auch nicht, wenn es jemand konfiguriert.
export function loopbackUrl(raw, name) {
  const url = new URL(raw);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.protocol !== "http:") {
    throw new Error(`${name} muss http://localhost oder http://127.0.0.1 sein, nicht ${raw}`);
  }
  return url.origin;
}
