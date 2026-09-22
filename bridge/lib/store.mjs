import { DatabaseSync } from "node:sqlite";

const OPEN_STATES = ["dispatching", "running", "blocked"];

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS runs (
      job_id                  INTEGER PRIMARY KEY,
      idea_id                 INTEGER NOT NULL,
      idea_version            INTEGER NOT NULL,
      dedupe_key              TEXT    NOT NULL,
      headline                TEXT    NOT NULL,
      card_json               TEXT    NOT NULL,
      action                 TEXT    NOT NULL,
      ao_project_id           TEXT    NOT NULL,
      orchestrator_session_id TEXT,
      worker_name             TEXT    NOT NULL,
      worker_session_id       TEXT,
      pr_url                  TEXT,
      state                   TEXT    NOT NULL,
      agency_job_open         INTEGER NOT NULL DEFAULT 1,
      last_summary            TEXT,
      review_cycles           INTEGER NOT NULL DEFAULT 0,
      created_at              INTEGER NOT NULL,
      sent_at                 INTEGER,
      last_progress_at        INTEGER,
      last_lease_at           INTEGER,
      last_synced_at          INTEGER,
      error                   TEXT
    );
    CREATE TABLE IF NOT EXISTS pushed_cards (
      dedupe_key TEXT PRIMARY KEY,
      pushed_at  INTEGER NOT NULL
    );
  `);

  const get = db.prepare("SELECT * FROM runs WHERE job_id = ?");
  const lastDiscover = db.prepare(
    "SELECT * FROM runs WHERE action = 'discover' AND ao_project_id = ? ORDER BY job_id DESC LIMIT 1");
  // Der Doppelklick-Schutz im lokalen Modus. Der gerade angelegte Job muss
  // draußen bleiben — er steht beim Prüfen schon in der Tabelle und wäre sonst
  // sein eigener Vorgänger.
  const priorDiscover = db.prepare(`
    SELECT worker_session_id FROM runs
    WHERE action = 'discover' AND ao_project_id = ? AND job_id <> ? AND worker_session_id IS NOT NULL
    ORDER BY job_id DESC LIMIT 1`);
  return {
    get: (jobId) => get.get(jobId) ?? null,
    // Für die Runner-Karte: wann lief zuletzt ein Discovery-Lauf?
    lastDiscover: (projectId) => lastDiscover.get(projectId) ?? null,
    priorDiscoverSession: (projectId, exceptJobId) =>
      priorDiscover.get(projectId, exceptJobId)?.worker_session_id ?? null,
    // Hinweiskarten werden genau einmal gelegt. Ohne dieses Gedächtnis käme
    // eine abgelehnte Karte beim nächsten Abgleich zurück.
    // PRs, die aus einem AO-Auftrag der Bridge stammen — die brauchen keine
    // Hinweiskarte, sie haben schon eine.
    knownPrUrls: () => db.prepare("SELECT pr_url FROM runs WHERE pr_url IS NOT NULL").all().map((r) => r.pr_url),
    wasPushed: (key) => db.prepare("SELECT 1 FROM pushed_cards WHERE dedupe_key = ?").get(key) != null,
    markPushed: (key, now) =>
      db.prepare("INSERT OR IGNORE INTO pushed_cards (dedupe_key, pushed_at) VALUES (?, ?)").run(key, now),
    open: () => db.prepare(`SELECT * FROM runs WHERE state IN (${OPEN_STATES.map(() => "?").join(",")}) ORDER BY job_id`).all(...OPEN_STATES),
    // INSERT OR IGNORE: ein zweiter Durchlauf für denselben Job legt nichts neu an.
    insert: (run) => db.prepare(`
      INSERT OR IGNORE INTO runs (job_id, idea_id, idea_version, dedupe_key, headline, card_json, action, ao_project_id, worker_name, state, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'dispatching', ?)
    `).run(run.jobId, run.ideaId, run.ideaVersion, run.dedupeKey, run.headline, JSON.stringify(run.card), run.action, run.projectId, run.workerName, run.now).changes === 1,
    update: (jobId, fields) => {
      const keys = Object.keys(fields);
      if (!keys.length) return;
      db.prepare(`UPDATE runs SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE job_id = ?`)
        .run(...keys.map((k) => fields[k]), jobId);
    },
    close: () => db.close(),
  };
}
