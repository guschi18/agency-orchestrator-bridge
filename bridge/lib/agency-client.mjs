import { assertSafeCardHtml } from "./cards.mjs";

export function createAgencyClient(baseUrl, fetchImpl = fetch) {
  async function call(method, path, body) {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      // Kein Origin-Header: so gilt die Loopback-Agentenregel, nicht die Browserregel.
      headers: { "x-radar-local-agent": "1", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = new Error(`Agency ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    // Liefert nur queued und abgelaufene running-Jobs; beanspruchte Jobs verschwinden hier.
    jobs: async () => (await call("GET", "/api/agent-jobs")).jobs,
    updateJob: (id, status, result, ticketOutcome) =>
      call("POST", "/api/agent-jobs", { id, status, result, ...(ticketOutcome ? { ticketOutcome } : {}) }),
    pushCard: (card) => {
      assertSafeCardHtml(card.cardHtml);
      return call("POST", "/api/ideas", card);
    },
    upsertTopic: (label, hint) => call("POST", "/api/topics", { label, hint }),
    // Die Bridge ruft /api/ideas/action absichtlich nie auf: Freigaben gibt nur der Mensch.
  };
}

// Steuerdaten der Karte aus dem Job-Schnappschuss; null = kein AO-Job.
export function aoJobFromAgencyJob(job) {
  let ctx;
  try {
    ctx = JSON.parse(job.cardContext);
  } catch {
    return null;
  }
  const idea = ctx?.idea;
  if (!idea) return null;
  let agentContext = idea.agentContext;
  if (typeof agentContext === "string") {
    try {
      agentContext = JSON.parse(agentContext);
    } catch {
      return null;
    }
  }
  const ao = agentContext?.ao;
  if (!ao?.projectId) return null;
  return {
    jobId: job.id,
    ideaId: idea.id,
    ideaVersion: idea.version,
    dedupeKey: idea.dedupeKey,
    headline: idea.headline,
    cardHtml: idea.cardHtml ?? "",
    project: idea.project,
    category: idea.category,
    rise: {
      reach: idea.riseReach,
      impact: idea.riseImpact,
      strategicFit: idea.riseStrategicFit,
      ease: idea.riseEase,
    },
    instruction: job.instruction ?? "",
    reclaimed: Boolean(job.reclaimed),
    ao,
  };
}
