import express from 'express';
import cors from 'cors';
import https from 'https';
import http from 'http';
import { readFileSync, existsSync } from 'fs';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import authRoutes from './routes/auth.js';
import linkRoutes from './routes/links.js';
import tagRoutes from './routes/tags.js';
import settingsRoutes from './routes/settings.js';
import assistantRoutes from './routes/assistant.js';
import mobileFileRoutes from './routes/mobileFiles.js';
import adminRoutes from './routes/admin.js';
import socialRoutes from './routes/social.js';
import db from './db.js';
import { createJobQueue } from './utils/jobQueue.js';
import { registerEnrichmentJobs } from './utils/enrichmentJobs.js';
import { setRuntimeQueue } from './utils/runtimeQueue.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3100;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/links', linkRoutes);
app.use('/api/tags', tagRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/mobile/files', mobileFileRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/admin', adminRoutes);

function runJsonCommand(command, args, timeoutMs = 3000) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          ok: false,
          error: error.killed ? `timeout after ${timeoutMs}ms` : error.message,
          stderr: stderr?.trim() || '',
        });
        return;
      }

      try {
        resolve({ ok: true, data: JSON.parse(stdout) });
      } catch (parseError) {
        resolve({
          ok: false,
          error: parseError.message,
          raw: stdout.slice(0, 1000),
        });
      }
    });
  });
}

async function fetchJsonWithTimeout(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let body = text;

    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text.slice(0, 1000);
    }

    return {
      ok: response.ok,
      status: response.status,
      data: body,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

app.get('/api/system/health', async (req, res) => {
  const modelUrl = `${process.env.LOCAL_LLM_URL || 'http://127.0.0.1:8000/v1'}/health`;
  const [system, model] = await Promise.all([
    runJsonCommand('taishan-health', ['--json'], 3000),
    fetchJsonWithTimeout(modelUrl, 3000),
  ]);

  res.json({
    ok: system.ok && model.ok,
    ts: new Date().toISOString(),
    app: {
      name: 'LinkBox',
      port: Number(PORT),
      dataDir: process.env.DATA_DIR || '',
      uploadsDir: process.env.UPLOADS_DIR || '',
    },
    system,
    model,
  });
});

// Serve uploaded files with long-term caching (filenames are random hex = immutable content)
const uploadsDir = process.env.UPLOADS_DIR || join(__dirname, 'uploads');
app.use('/uploads', express.static(uploadsDir, {
  maxAge: '7d',
  immutable: true,
}));

const jobQueue = createJobQueue({
  db,
  autoStart: false,
  onFinalFailure: job => {
    if (job.link_id) {
      db.prepare('UPDATE links SET status = ? WHERE id = ?').run('error', job.link_id);
    }
  },
});
registerEnrichmentJobs(jobQueue, { uploadsDir });
setRuntimeQueue(jobQueue);
jobQueue.start();

// Global error handler for API (returns JSON, not HTML)
app.use((err, req, res, next) => {
  console.error('API Error:', err.message);
  res.status(500).json({ error: err.message || '服务器错误' });
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// Serve static frontends in production
app.use('/mobile', express.static(join(__dirname, '../mobile/dist')));
app.get('/mobile/*', (req, res) => {
  res.sendFile(join(__dirname, '../mobile/dist/index.html'));
});

app.use(express.static(join(__dirname, '../client/dist')));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(join(__dirname, '../client/dist/index.html'));
  }
});

// Try to start HTTPS if certs exist, otherwise fallback to HTTP
const certPath = join(__dirname, 'certs/cert.pem');
const keyPath = join(__dirname, 'certs/key.pem');

if (existsSync(certPath) && existsSync(keyPath)) {
  const options = {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  };
  https.createServer(options, app).listen(PORT, '0.0.0.0', () => {
    console.log(`LinkBox server running on https://0.0.0.0:${PORT}`);
  });
} else {
  http.createServer(app).listen(PORT, '0.0.0.0', () => {
    console.log(`LinkBox server running on http://0.0.0.0:${PORT} (no certs found, HTTP mode)`);
  });
}
