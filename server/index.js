import express from 'express';
import cors from 'cors';
import https from 'https';
import http from 'http';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import authRoutes from './routes/auth.js';
import linkRoutes from './routes/links.js';
import tagRoutes from './routes/tags.js';
import settingsRoutes from './routes/settings.js';
import assistantRoutes from './routes/assistant.js';
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

// Serve static frontend in production
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
