import { createHash, randomBytes } from 'crypto';
import { execFile } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { extname, join } from 'path';

const DEFAULT_MAX_BYTES = Number(process.env.IMAGE_VISION_MAX_BYTES || 2 * 1024 * 1024);
const DEFAULT_MAX_EDGE = Number(process.env.IMAGE_VISION_MAX_EDGE || 1280);
const DEFAULT_TIMEOUT_MS = Number(process.env.IMAGE_VISION_TIMEOUT_MS || 90000);
const CLOUD_TIMEOUT_MS = Number(process.env.CLOUD_IMAGE_VISION_TIMEOUT_MS || 30000);
const TMP_DIR = join(tmpdir(), 'linkbox-image-vision');

mkdirSync(TMP_DIR, { recursive: true });

export function initImageVisionSchema(database) {
  if (!database) throw new Error('initImageVisionSchema requires a database');
  database.exec(`
    CREATE TABLE IF NOT EXISTS image_vision_cache (
      image_hash TEXT NOT NULL,
      prompt_type TEXT NOT NULL,
      model TEXT NOT NULL,
      description TEXT DEFAULT '',
      source_bytes INTEGER DEFAULT 0,
      prepared_bytes INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (image_hash, prompt_type, model)
    );
  `);
}

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function getRuntimeDeps() {
  const [{ default: database }, { getAIConfig }] = await Promise.all([
    import('../db.js'),
    import('./aiConfig.js'),
  ]);
  return { database, getAIConfig };
}

export function hashFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function fileSize(filePath) {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

function imageMime(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

export function isLocalVisionConfig(config = {}) {
  if (config.provider !== 'custom') return false;
  try {
    const url = new URL(config.baseUrl);
    return ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function inferImagePromptType({ originalName = '', filePath = '' } = {}) {
  const name = `${originalName} ${filePath}`.toLowerCase();
  if (/(screenshot|screen|wechat|weixin|ui|app)/i.test(name)) return 'screenshot';
  if (/(receipt|invoice|contract|document|paper|scan|form|bill)/i.test(name)) return 'document';
  return 'photo';
}

export function promptForImageType(promptType = 'photo') {
  if (promptType === 'screenshot') {
    return [
      'Analyze this screenshot for LinkBox.',
      'Return concise Chinese.',
      'Prioritize visible text, UI structure, key numbers, buttons, errors, and user intent.',
      'Do not invent hidden content.',
    ].join(' ');
  }
  if (promptType === 'document') {
    return [
      'Analyze this document-like image for LinkBox.',
      'Return concise Chinese.',
      'Extract visible titles, fields, dates, amounts, names, and important text.',
      'If text is unclear, say it is unclear instead of guessing.',
    ].join(' ');
  }
  return [
    'Analyze this image for LinkBox.',
    'Return concise Chinese.',
    'Describe the main subject, scene, visible text, and useful details in 1-3 short sentences.',
    'Do not invent details that are not visible.',
  ].join(' ');
}

function getCachedDescription({ imageHash, promptType, model }, database) {
  return database.prepare(`
    SELECT description
    FROM image_vision_cache
    WHERE image_hash = ? AND prompt_type = ? AND model = ?
  `).get(imageHash, promptType, model)?.description;
}

function saveCachedDescription({
  imageHash,
  promptType,
  model,
  description,
  sourceBytes,
  preparedBytes,
}, database) {
  database.prepare(`
    INSERT OR REPLACE INTO image_vision_cache
      (image_hash, prompt_type, model, description, source_bytes, prepared_bytes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(imageHash, promptType, model, description || '', sourceBytes || 0, preparedBytes || 0);
}

async function tryImageMagick(inputPath, outputPath, {
  maxEdge = DEFAULT_MAX_EDGE,
  timeoutMs = 20000,
} = {}) {
  const args = [
    inputPath,
    '-auto-orient',
    '-resize',
    `${maxEdge}x${maxEdge}>`,
    '-strip',
    '-quality',
    '82',
    outputPath,
  ];
  const commands = process.env.IMAGE_PREPROCESSOR_CMD
    ? [process.env.IMAGE_PREPROCESSOR_CMD]
    : ['magick', 'convert'];

  for (const command of commands) {
    try {
      await execFileAsync(command, args, { timeout: timeoutMs });
      if (existsSync(outputPath) && fileSize(outputPath) > 0) return true;
    } catch {
      // Optional optimizer. Fall through to the next command or original image.
    }
  }
  return false;
}

export async function prepareImageForVision(filePath, {
  maxBytes = DEFAULT_MAX_BYTES,
  maxEdge = DEFAULT_MAX_EDGE,
} = {}) {
  const sourceBytes = fileSize(filePath);
  if (!sourceBytes || sourceBytes <= maxBytes) {
    return {
      path: filePath,
      sourceBytes,
      preparedBytes: sourceBytes,
      cleanup: () => {},
      optimized: false,
    };
  }

  const outputPath = join(TMP_DIR, `vision-${Date.now()}-${randomBytes(4).toString('hex')}.jpg`);
  const optimized = await tryImageMagick(filePath, outputPath, { maxEdge });
  if (!optimized) {
    return {
      path: filePath,
      sourceBytes,
      preparedBytes: sourceBytes,
      cleanup: () => {},
      optimized: false,
    };
  }

  return {
    path: outputPath,
    sourceBytes,
    preparedBytes: fileSize(outputPath),
    cleanup: () => rmSync(outputPath, { force: true }),
    optimized: true,
  };
}

export async function describeImage(localPath, {
  originalName = '',
  promptType = inferImagePromptType({ originalName, filePath: localPath }),
  database = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!localPath || !existsSync(localPath)) return '';

  const runtime = await getRuntimeDeps();
  const activeDb = database || runtime.database;
  const aiConfig = runtime.getAIConfig({ includeSecret: true });
  const useLocalOptimizations = isLocalVisionConfig(aiConfig);
  const model = aiConfig.visionModel || aiConfig.model;
  const imageHash = hashFile(localPath);
  if (useLocalOptimizations) {
    initImageVisionSchema(activeDb);
    const cached = getCachedDescription({ imageHash, promptType, model }, activeDb);
    if (cached !== undefined) return cached;
  }

  const prepared = useLocalOptimizations
    ? await prepareImageForVision(localPath)
    : {
        path: localPath,
        sourceBytes: fileSize(localPath),
        preparedBytes: fileSize(localPath),
        cleanup: () => {},
        optimized: false,
      };
  try {
    const imgBuf = readFileSync(prepared.path);
    const b64 = imgBuf.toString('base64');
    const payload = {
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${imageMime(prepared.path)};base64,${b64}` } },
          { type: 'text', text: promptForImageType(promptType) },
        ],
      }],
      max_tokens: useLocalOptimizations
        ? Number(process.env.IMAGE_VISION_MAX_TOKENS || 180)
        : Number(process.env.CLOUD_IMAGE_VISION_MAX_TOKENS || 120),
      temperature: aiConfig.temperature,
    };
    if (aiConfig.supportsThinkingParam) {
      payload.chat_template_kwargs = { enable_thinking: aiConfig.enableThinking };
    }

    const response = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(aiConfig.apiKey ? { Authorization: `Bearer ${aiConfig.apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(useLocalOptimizations ? timeoutMs : CLOUD_TIMEOUT_MS),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      throw new Error(`Vision LLM returned ${response.status}: ${err.slice(0, 200)}`);
    }

    const data = await response.json();
    const description = data?.choices?.[0]?.message?.content?.trim() || '';
    if (useLocalOptimizations) {
      saveCachedDescription({
        imageHash,
        promptType,
        model,
        description,
        sourceBytes: prepared.sourceBytes,
        preparedBytes: prepared.preparedBytes,
      }, activeDb);
    }
    return description;
  } finally {
    prepared.cleanup();
  }
}
