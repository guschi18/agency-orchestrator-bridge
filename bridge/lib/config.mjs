import { homedir } from "node:os";
import { join } from "node:path";

const MINUTE = 60_000;

export function loadConfig(env = process.env) {
  return {
    agencyUrl: loopbackUrl(env.AGENCY_URL ?? "http://localhost:3100", "AGENCY_URL"),
    aoRunFile: env.AO_RUN_FILE ?? join(homedir(), ".ao", "running.json"),
    dbPath: env.BRIDGE_DB ?? "bridge.db",
    projectsFile: env.BRIDGE_PROJECTS_FILE ?? "ao-projects.json",
    // Nur diese AO-Projekte dürfen Aufträge bekommen. Leer = keins.
    allowedProjects: (env.BRIDGE_ALLOWED_PROJECTS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    allowMerge: env.BRIDGE_ALLOW_MERGE === "1",
    pollMs: Number(env.BRIDGE_POLL_MS ?? 15_000),
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
