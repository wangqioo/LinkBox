export function initJobSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      link_id INTEGER,
      payload TEXT DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      next_run_at TEXT DEFAULT (datetime('now')),
      locked_at TEXT DEFAULT '',
      last_error TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT DEFAULT '',
      FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status_next_run ON jobs(status, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_link ON jobs(link_id);
  `);
}

function isoNow() {
  return new Date().toISOString();
}

function parsePayload(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

function backoffSeconds(attempts) {
  return Math.min(300, Math.max(5, 5 * Math.pow(2, Math.max(0, attempts - 1))));
}

export function createJobQueue({
  db,
  handlers = {},
  concurrency = Number(process.env.BACKGROUND_QUEUE_CONCURRENCY || 1),
  pollIntervalMs = 1000,
  autoStart = true,
  onFinalFailure = null,
} = {}) {
  if (!db) throw new Error('createJobQueue requires a database');
  initJobSchema(db);

  const registry = new Map(Object.entries(handlers));
  const maxRunning = Math.max(1, Number(concurrency) || 1);
  let timer = null;
  let running = 0;
  let stopped = false;

  function enqueue(type, { linkId = null, payload = {}, maxAttempts = 3 } = {}) {
    const now = isoNow();
    const result = db.prepare(`
      INSERT INTO jobs (type, link_id, payload, status, max_attempts, next_run_at, updated_at)
      VALUES (?, ?, ?, 'queued', ?, ?, ?)
    `).run(type, linkId, JSON.stringify(payload || {}), maxAttempts, now, now);
    return db.prepare('SELECT * FROM jobs WHERE id = ?').get(result.lastInsertRowid);
  }

  function recoverRunningJobs() {
    const result = db.prepare(`
      UPDATE jobs
      SET status = 'queued', locked_at = '', updated_at = ?
      WHERE status = 'running'
    `).run(isoNow());
    return result.changes;
  }

  function leaseNextJob() {
    const job = db.prepare(`
      SELECT * FROM jobs
      WHERE status = 'queued' AND datetime(next_run_at) <= datetime('now')
      ORDER BY id ASC
      LIMIT 1
    `).get();
    if (!job) return null;

    const now = isoNow();
    const result = db.prepare(`
      UPDATE jobs
      SET status = 'running', locked_at = ?, attempts = attempts + 1, updated_at = ?
      WHERE id = ? AND status = 'queued'
    `).run(now, now, job.id);
    if (!result.changes) return null;
    return db.prepare('SELECT * FROM jobs WHERE id = ?').get(job.id);
  }

  function markDone(id) {
    const now = isoNow();
    db.prepare(`
      UPDATE jobs
      SET status = 'done', locked_at = '', last_error = '', completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, id);
  }

  function markFailed(job, error) {
    const now = isoNow();
    const message = String(error?.message || error || 'Unknown job error').slice(0, 1000);
    if (job.attempts >= job.max_attempts) {
      db.prepare(`
        UPDATE jobs
        SET status = 'failed', locked_at = '', last_error = ?, updated_at = ?
        WHERE id = ?
      `).run(message, now, job.id);
      onFinalFailure?.({ ...job, last_error: message });
      return;
    }

    db.prepare(`
      UPDATE jobs
      SET status = 'queued',
          locked_at = '',
          last_error = ?,
          next_run_at = datetime('now', ?),
          updated_at = ?
      WHERE id = ?
    `).run(message, `+${backoffSeconds(job.attempts)} seconds`, now, job.id);
  }

  async function runJob(job) {
    const handler = registry.get(job.type);
    if (!handler) {
      markFailed(job, new Error(`No handler registered for job type ${job.type}`));
      return;
    }

    try {
      await handler({ ...job, payload: parsePayload(job.payload) });
      markDone(job.id);
    } catch (error) {
      markFailed(job, error);
    }
  }

  function drain() {
    if (stopped) return;
    while (running < maxRunning) {
      const job = leaseNextJob();
      if (!job) break;
      running += 1;
      Promise.resolve(runJob(job)).finally(() => {
        running -= 1;
        drain();
      });
    }
  }

  function start() {
    if (timer) return;
    stopped = false;
    recoverRunningJobs();
    drain();
    timer = setInterval(drain, pollIntervalMs);
    timer.unref?.();
  }

  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  }

  function register(type, handler) {
    registry.set(type, handler);
  }

  function stats() {
    const rows = db.prepare('SELECT status, COUNT(*) AS count FROM jobs GROUP BY status').all();
    const counts = Object.fromEntries(rows.map(row => [row.status, row.count]));
    const lastFailed = db.prepare(`
      SELECT id, type, link_id, attempts, last_error, updated_at
      FROM jobs
      WHERE status = 'failed'
      ORDER BY updated_at DESC
      LIMIT 1
    `).get() || null;

    return {
      concurrency: maxRunning,
      running,
      queued: counts.queued || 0,
      leased: counts.running || 0,
      done: counts.done || 0,
      failed: counts.failed || 0,
      lastFailed,
    };
  }

  const api = {
    enqueue,
    recoverRunningJobs,
    leaseNextJob,
    markDone,
    markFailed,
    runJob,
    drain,
    start,
    stop,
    register,
    stats,
  };

  if (autoStart) start();
  return api;
}
