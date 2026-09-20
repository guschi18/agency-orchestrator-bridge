import test from "node:test";
import assert from "node:assert/strict";
import { tick } from "../index.mjs";
import { assertSafeCardHtml, unsafeCardHtml } from "../lib/cards.mjs";
import { ciState, foreignPrCard, foreignPrDedupeKey, isForeign, listOpenPrs, repoSlug } from "../lib/foreign-prs.mjs";
import { openStore } from "../lib/store.mjs";

function pr(over = {}) {
  return {
    number: 1, title: "CI: Tests bei jedem Pull Request", headRefName: "ci/tests-workflow",
    isDraft: false, author: { login: "guschi18" }, additions: 18, deletions: 0, changedFiles: 1,
    url: "https://github.com/guschi18/polnisch-app/pull/1",
    statusCheckRollup: [{ conclusion: "SUCCESS", name: "test" }],
    ...over,
  };
}

// ---- Repo-Erkennung ----------------------------------------------------------

test("repoSlug erkennt die üblichen GitHub-Schreibweisen", () => {
  assert.equal(repoSlug("https://github.com/guschi18/polnisch-app.git"), "guschi18/polnisch-app");
  assert.equal(repoSlug("https://github.com/guschi18/polnisch-app"), "guschi18/polnisch-app");
  assert.equal(repoSlug("git@github.com:guschi18/polnisch-app.git"), "guschi18/polnisch-app");
});

test("ohne GitHub-Remote gibt es keinen Slug und damit keine Abfrage", () => {
  assert.equal(repoSlug(""), null);
  assert.equal(repoSlug(null), null);
  assert.equal(repoSlug("https://gitlab.com/x/y.git"), null);
});

// ---- Welcher PR ist fremd? ---------------------------------------------------

test("ein ao/-Branch gehört zu AO und bekommt keine Hinweiskarte", () => {
  assert.equal(isForeign(pr({ headRefName: "ao/polnisch-3/einheit-20" }), new Set()), false);
});

test("ein PR, den die Bridge selbst kennt, bekommt keine zweite Karte", () => {
  assert.equal(isForeign(pr(), new Set([pr().url])), false);
});

test("ein von Hand angelegter PR ist fremd", () => {
  assert.equal(isForeign(pr(), new Set()), true);
});

// ---- CI-Zustand --------------------------------------------------------------

test("ciState fasst GitHubs Check-Mischung zusammen", () => {
  assert.equal(ciState(pr()), "passing");
  assert.equal(ciState(pr({ statusCheckRollup: [] })), "unknown");
  assert.equal(ciState(pr({ statusCheckRollup: [{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }] })), "failing");
  assert.equal(ciState(pr({ statusCheckRollup: [{ conclusion: "SUCCESS" }, { state: "PENDING" }] })), "pending");
  // Ein roter Check schlägt einen laufenden: rot bleibt rot.
  assert.equal(ciState(pr({ statusCheckRollup: [{ state: "PENDING" }, { conclusion: "ERROR" }] })), "failing");
});

// ---- Die Karte ---------------------------------------------------------------

test("die Hinweiskarte hält Agencys Sanitizer-Regeln ein", () => {
  const card = foreignPrCard({ projectId: "polnisch", pr: pr() });
  assert.doesNotThrow(() => assertSafeCardHtml(card.cardHtml));
  assert.equal(unsafeCardHtml(card.cardHtml), false);
});

test("die Hinweiskarte bietet 'Gesehen', aber keinen Merge", () => {
  // Ohne AO-Review fehlt die Grundlage fuer den Live-Recheck. Ein Knopf, der
  // trotzdem mergt, waere genau der Fehler, den die Bridge verhindern soll.
  // Agency verlangt aber eine Entscheidung je Karte (400 sonst), also "Gesehen".
  const { cardHtml, agentContext } = foreignPrCard({ projectId: "polnisch", pr: pr() });
  assert.match(cardHtml, /data-radar-action="open"/);
  assert.match(cardHtml, /data-radar-action="do"/);
  assert.match(cardHtml, />Gesehen</);
  assert.equal(/Mergen<\/button>/.test(cardHtml), false);
  assert.match(cardHtml, /Mergen geht hier nicht/);
  assert.equal(agentContext.ao.action, "acknowledge");
});

test("die Hinweiskarte nennt Herkunft, Umfang und CI-Stand", () => {
  const { cardHtml, dedupeKey, headline } = foreignPrCard({ projectId: "polnisch", pr: pr() });
  assert.equal(dedupeKey, foreignPrDedupeKey("polnisch", 1));
  assert.match(headline, /ohne AO-Auftrag/);
  assert.match(cardHtml, /ci\/tests-workflow/);
  assert.match(cardHtml, /1 Dateien, \+18 \/ −0/);
  assert.match(cardHtml, /grün/);
});

test("die Hinweiskarte verdrängt keinen echten Befund", () => {
  const { rise } = foreignPrCard({ projectId: "polnisch", pr: pr() });
  assert.ok(rise.reach + rise.impact + rise.strategicFit + rise.ease <= 25);
});

// ---- gh als Quelle -----------------------------------------------------------

test("listOpenPrs fragt genau ein Repo ab und liest JSON", async () => {
  const calls = [];
  const out = await listOpenPrs("guschi18/polnisch-app", async (cmd, args) => {
    calls.push([cmd, args]);
    return { stdout: JSON.stringify([pr()]) };
  });
  assert.equal(calls[0][0], "gh");
  assert.ok(calls[0][1].includes("--repo") && calls[0][1].includes("guschi18/polnisch-app"));
  assert.ok(calls[0][1].includes("open"));
  assert.equal(out[0].number, 1);
});

test("leere Ausgabe von gh ist kein Fehler", async () => {
  assert.deepEqual(await listOpenPrs("x/y", async () => ({ stdout: "" })), []);
});

// ---- Unbekannte Aktionen -----------------------------------------------------

test('"Gesehen" hakt die Karte ab, ohne einen Auftrag auszuloesen', async () => {
  const store = openStore(":memory:");
  const calls = { updates: [], sends: 0, cards: [] };
  const job = { id: 9, instruction: "", cardContext: JSON.stringify({
    idea: { id: 7, version: 1, dedupeKey: "polnisch:pr-1", headline: "Offener PR", project: "polnisch",
      category: "polnisch", cardHtml: "x".repeat(90),
      agentContext: JSON.stringify({ ao: { projectId: "polnisch", action: "acknowledge", prNumber: 1 } }) },
  }) };
  const agency = {
    jobs: async () => [job],
    updateJob: async (...a) => { calls.updates.push(a); },
    pushCard: async (c) => { calls.cards.push(c); },
  };
  const ao = {
    project: async () => ({ id: "polnisch" }),
    sessions: async () => [], orchestrators: async () => [],
    send: async () => { calls.sends++; },
    prs: async () => [], reviews: async () => ({ runs: [] }),
  };
  await tick({ config: { allowMerge: true, limits: {} }, pipeline: { polnisch: { analysieren: true, umsetzen: true } },
    agency, ao, store, now: 0 });
  assert.equal(calls.sends, 0);
  assert.deepEqual(calls.updates.at(-1).slice(1), ["done", "Zur Kenntnis genommen", "completed"]);
  assert.equal(store.get(9).state, "completed");
});

test("eine unbekannte Aktion wird sichtbar blockiert, nicht still ausgefuehrt", async () => {
  const store = openStore(":memory:");
  const calls = { updates: [], sends: 0 };
  const job = { id: 11, instruction: "", cardContext: JSON.stringify({
    idea: { id: 8, version: 1, dedupeKey: "polnisch:x", headline: "H", project: "polnisch",
      category: "polnisch", cardHtml: "x".repeat(90),
      agentContext: JSON.stringify({ ao: { projectId: "polnisch", action: "loeschen" } }) },
  }) };
  const agency = { jobs: async () => [job], updateJob: async (...a) => { calls.updates.push(a); }, pushCard: async () => {} };
  const ao = { project: async () => ({ id: "polnisch" }), sessions: async () => [], orchestrators: async () => [],
    send: async () => { calls.sends++; }, prs: async () => [], reviews: async () => ({ runs: [] }) };
  await tick({ config: { allowMerge: true, limits: {} }, pipeline: { polnisch: { analysieren: true, umsetzen: true } },
    agency, ao, store, now: 0 });
  assert.equal(calls.sends, 0);
  assert.match(calls.updates.at(-1)[2], /kennt keine Aktion "loeschen"/);
});
