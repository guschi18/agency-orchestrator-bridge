import { readFile } from "node:fs/promises";
import { loopbackUrl } from "./config.mjs";

export class AoUnavailable extends Error {}

// Liest den Port bei jedem Aufruf frisch aus running.json: AO kann auf einen
// anderen Port ausweichen und wird mit der Desktop-App neu gestartet.
export function createAoClient(runFile, fetchImpl = fetch) {
  async function baseUrl() {
    let info;
    try {
      info = JSON.parse(await readFile(runFile, "utf8"));
    } catch {
      throw new AoUnavailable(`AO läuft nicht (${runFile} fehlt)`);
    }
    if (!info.port) throw new AoUnavailable(`AO läuft nicht (${runFile} ohne Port)`);
    return `${loopbackUrl(`http://127.0.0.1:${info.port}`, "AO")}/api/v1`;
  }

  async function call(method, path, body) {
    const url = `${await baseUrl()}${path}`;
    let res;
    try {
      res = await fetchImpl(url, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new AoUnavailable(`AO nicht erreichbar: ${err.message}`);
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = new Error(`AO ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    projects: async () => (await call("GET", "/projects")).projects,
    project: async (id) => (await call("GET", `/projects/${encodeURIComponent(id)}`)).project,
    orchestrators: async () => (await call("GET", "/orchestrators")).sessions,
    spawnOrchestrator: async (projectId) => (await call("POST", "/orchestrators", { projectId })).orchestrator,
    sessions: async (projectId) => (await call("GET", `/sessions?project=${encodeURIComponent(projectId)}`)).sessions,
    session: async (id) => (await call("GET", `/sessions/${encodeURIComponent(id)}`)).session,
    prs: async (id) => {
      const data = await call("GET", `/sessions/${encodeURIComponent(id)}/pr`);
      return data?.prs ?? (data ? [data] : []);
    },
    reviews: async (id) => call("GET", `/sessions/${encodeURIComponent(id)}/reviews`),
    // Geänderte Dateien des Worker-Worktrees gegenüber dem Basis-Branch:
    // die einzige Quelle für eine Diff-Übersicht, die AO selbst kennt.
    workspaceFiles: async (id) => call("GET", `/sessions/${encodeURIComponent(id)}/workspace/files`),
    send: async (id, message) => call("POST", `/sessions/${encodeURIComponent(id)}/send`, { message }),
    // AO verlangt prUrl und expectedHeadSha (MergePRRequest): das ist AOs
    // eigener Schutz gegen einen Merge auf einen inzwischen bewegten Head.
    merge: async (prNumber, { prUrl, expectedHeadSha }) =>
      call("POST", `/prs/${encodeURIComponent(prNumber)}/merge`, { prUrl, expectedHeadSha }),
  };
}

// Neuester laufender Orchestrator des Projekts, sonst ein neuer.
export async function ensureOrchestrator(ao, projectId) {
  const live = (await ao.orchestrators())
    .filter((s) => s.projectId === projectId && !s.isTerminated)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (live.length) return { id: live[0].id, created: false };
  const created = await ao.spawnOrchestrator(projectId);
  return { id: created.id, created: true };
}

export async function findWorker(ao, projectId, workerName) {
  const matches = (await ao.sessions(projectId))
    .filter((s) => s.kind !== "orchestrator" && s.displayName === workerName);
  // Mehr als ein Treffer ist selbst ein Befund (Doppel-Dispatch); der älteste gilt.
  matches.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return { worker: matches[0] ?? null, duplicates: Math.max(0, matches.length - 1) };
}
