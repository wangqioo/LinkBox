import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'linkbox-playwright-'));
const uploadsDir = join(dataDir, 'uploads');
mkdirSync(uploadsDir, { recursive: true });

const app = spawn(process.execPath, ['index.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DATA_DIR: dataDir,
    DB_PATH: join(dataDir, 'linkbox.db'),
    UPLOADS_DIR: uploadsDir,
  },
  stdio: 'inherit',
});

let stopping = false;
let cleanupDone = false;
let forceKillTimer;

function cleanup() {
  if (cleanupDone) return;
  cleanupDone = true;
  rmSync(dataDir, { recursive: true, force: true });
}

function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  app.kill(signal);
  forceKillTimer = setTimeout(() => {
    app.kill('SIGKILL');
    cleanup();
    process.exit(0);
  }, 3000).unref();
}

process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
app.on('exit', (code, signal) => {
  if (forceKillTimer) clearTimeout(forceKillTimer);
  cleanup();
  if (stopping || signal) process.exit(0);
  else process.exit(code || 0);
});
