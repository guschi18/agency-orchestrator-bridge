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
  `);

  const get = db.prepare("SELECT * FROM runs WHERE job_id = ?");
  return {
    get: (jobId) => get.get(jobId) ?? null,
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
