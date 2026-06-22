import { execFile as execFileCallback } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import { basename, extname, join } from 'path';
import { tmpdir } from 'os';
import { callAIChat } from './aiConfig.js';
import { isBilibiliVideoUrl } from './bilibiliVideoSource.js';

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_PUNCTUATION_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_PUNCTUATION_CHUNK_CHARS = 1800;
const DEFAULT_AUDIO_CHUNK_SECONDS = 60;
const SUBTITLE_LANG_PRIORITY = [
  'zh-Hans',
  'zh-Hant',
  'zh-CN',
  'zh-TW',
  'zh',
  'en',
  'en-orig',
  'ja',
  'ko',
];
const AUDIO_EXTENSIONS = new Set(['.m4a', '.mp3', '.mp4', '.webm', '.wav', '.aac', '.opus']);
const SUBTITLE_EXTENSIONS = new Set(['.vtt', '.srt']);
const CHUNK_EXTENSIONS = new Set(['.wav']);

function execFileAsync(execFile, command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout = '', stderr = '') => {
      if (error) {
        error.stderr = stderr;
        error.stdout = stdout;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanSubtitleText(text) {
  return decodeEntities(text)
    .replace(/<\d{1,2}:\d{2}(?::\d{2})?[.,]\d+>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]+\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTimestamp(timestamp) {
  const clean = timestamp.replace(',', '.').trim();
  const [main] = clean.split('.');
  const parts = main.split(':').map(part => part.padStart(2, '0'));
  if (parts.length === 2) return parts.join(':');
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return hours === '00' ? `${minutes}:${seconds}` : `${hours}:${minutes}:${seconds}`;
  }
  return main;
}

function parseSubtitleBlocks(content) {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized.split(/\n{2,}/).flatMap(block => {
    const lines = block
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .filter(line => line !== 'WEBVTT' && !line.startsWith('NOTE '));
    const timingIndex = lines.findIndex(line => line.includes('-->'));
    if (timingIndex === -1) return [];

    const timing = lines[timingIndex];
    const match = timing.match(/(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?)\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?)/);
    if (!match) return [];

    const text = cleanSubtitleText(lines.slice(timingIndex + 1).join(' '));
    if (!text) return [];
    return [{
      start: normalizeTimestamp(match[1]),
      end: normalizeTimestamp(match[2]),
      text,
    }];
  });
}

function removeRollingDuplicates(entries) {
  return entries.filter((entry, index) => {
    const next = entries[index + 1];
    return !(next && next.text.startsWith(entry.text) && next.text !== entry.text);
  });
}

export function parseVtt(content) {
  return removeRollingDuplicates(parseSubtitleBlocks(content));
}

export function parseSrt(content) {
  return removeRollingDuplicates(parseSubtitleBlocks(content));
}

export function subtitleEntriesToMarkdown(entries, language = 'unknown') {
  const lines = [
    '# Video Transcription',
    '',
    `**Detected Language:** ${language}`,
    '**Language Probability:** 1.00',
    '',
    '## Transcription Content',
    '',
  ];

  for (const entry of entries) {
    lines.push(`**[${entry.start} - ${entry.end}]**`, '', entry.text, '');
  }

  return lines.join('\n');
}

function plainTranscriptToMarkdown(text, language = 'unknown') {
  return [
    '# Video Transcription',
    '',
    `**Detected Language:** ${language}`,
    '**Language Probability:** 1.00',
    '',
    '## Transcription Content',
    '',
    text.trim(),
    '',
  ].join('\n');
}

function stripCodeFence(text) {
  return String(text || '')
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function chunkText(text, maxChars = DEFAULT_PUNCTUATION_CHUNK_CHARS) {
  const clean = String(text || '').trim();
  if (clean.length <= maxChars) return clean ? [clean] : [];
  const chunks = [];
  let rest = clean;
  while (rest.length > maxChars) {
    const slice = rest.slice(0, maxChars);
    const cut = Math.max(
      slice.lastIndexOf('。'),
      slice.lastIndexOf('！'),
      slice.lastIndexOf('？'),
      slice.lastIndexOf('，'),
      slice.lastIndexOf(' '),
    );
    const end = cut > maxChars * 0.55 ? cut + 1 : maxChars;
    chunks.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export async function punctuateTranscriptText(text, {
  callChat = callAIChat,
  timeoutMs = positiveInteger(process.env.TRANSCRIPT_PUNCTUATION_TIMEOUT_MS, DEFAULT_PUNCTUATION_TIMEOUT_MS),
  chunkChars = positiveInteger(process.env.TRANSCRIPT_PUNCTUATION_CHUNK_CHARS, DEFAULT_PUNCTUATION_CHUNK_CHARS),
} = {}) {
  const source = String(text || '').trim();
  if (!source) return '';

  const chunks = chunkText(source, chunkChars);
  const processed = [];
  for (const [index, chunk] of chunks.entries()) {
    try {
      const result = await callChat({
        messages: [
          {
            role: 'system',
            content: '你是中文视频转写整理助手。只添加中文标点、自然分段和少量必要空格；不得改写、总结、增删信息；不要解释。',
          },
          {
            role: 'user',
            content: `请整理下面的视频转写文本，只补标点和分段，保持原意和原词：\n\n${chunk}`,
          },
        ],
        maxTokens: Math.min(2048, Math.max(600, Math.ceil(chunk.length * 1.5))),
        temperature: 0,
        timeoutMs,
      });
      processed.push(stripCodeFence(result) || chunk);
    } catch (error) {
      console.warn(`[video-transcript] Transcript punctuation chunk ${index + 1}/${chunks.length} failed: ${error.message}`);
      processed.push(chunk);
    }
  }
  return processed.join('\n\n').trim();
}

function isBilibiliUrl(url) {
  return isBilibiliVideoUrl(url);
}

function baseYtDlpArgs(url) {
  const args = [
    '--no-warnings',
    '--quiet',
    '--no-playlist',
    '--add-header', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
    '--add-header', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    '--add-header', 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
  ];

  if (isBilibiliUrl(url)) {
    args.push(
      '--add-header', 'Referer: https://www.bilibili.com/',
      '--add-header', 'Origin: https://www.bilibili.com',
      '--add-header', 'Cookie: buvid3=linkbox00000000000000000000000000000000; CURRENT_FNVAL=4048',
      '--extractor-args', 'bilibili:prefer_multi_flv=False',
    );
  }

  const cookieFile = process.env.YTDLP_COOKIE_FILE || (isBilibiliUrl(url) ? process.env.BILIBILI_COOKIE_FILE : '');
  if (cookieFile && existsSync(cookieFile)) args.push('--cookies', cookieFile);

  const cookiesFromBrowser = process.env.YTDLP_COOKIES_FROM_BROWSER || (isBilibiliUrl(url) ? process.env.BILIBILI_COOKIES_FROM_BROWSER : '');
  if (cookiesFromBrowser) args.push('--cookies-from-browser', cookiesFromBrowser);

  return args;
}

function pickSubtitle(metadata) {
  const manual = metadata?.subtitles || {};
  const automatic = metadata?.automatic_captions || {};
  for (const lang of SUBTITLE_LANG_PRIORITY) {
    if (manual[lang]?.length) return { language: lang, automatic: false };
  }
  for (const lang of Object.keys(manual)) {
    if (manual[lang]?.length) return { language: lang, automatic: false };
  }
  for (const lang of SUBTITLE_LANG_PRIORITY) {
    if (automatic[lang]?.length) return { language: lang, automatic: true };
  }
  for (const lang of Object.keys(automatic)) {
    if (automatic[lang]?.length) return { language: lang, automatic: true };
  }
  return null;
}

function findFirstFile(dir, extensions) {
  return readdirSync(dir)
    .map(name => join(dir, name))
    .find(file => extensions.has(extname(file).toLowerCase()));
}

function parseSubtitleFile(file) {
  const content = readFileSync(file, 'utf8');
  return extname(file).toLowerCase() === '.srt' ? parseSrt(content) : parseVtt(content);
}

async function downloadSubtitle({ url, subtitle, dir, execFile, ytDlpBin, timeoutMs }) {
  const args = [
    ...baseYtDlpArgs(url),
    '--skip-download',
    subtitle.automatic ? '--write-auto-subs' : '--write-subs',
    '--sub-langs', subtitle.language,
    '--sub-format', 'vtt/srt/best',
    '--output', join(dir, 'subtitle.%(ext)s'),
    url,
  ];
  await execFileAsync(execFile, ytDlpBin, args, { cwd: dir, timeout: timeoutMs });
  return findFirstFile(dir, SUBTITLE_EXTENSIONS);
}

async function downloadAudio({ url, dir, execFile, ytDlpBin, timeoutMs }) {
  const args = [
    ...baseYtDlpArgs(url),
    '--format', 'bestaudio/best',
    '--extract-audio',
    '--audio-format', 'm4a',
    '--audio-quality', '192K',
    '--output', join(dir, 'audio.%(ext)s'),
    url,
  ];
  await execFileAsync(execFile, ytDlpBin, args, { cwd: dir, timeout: timeoutMs });
  const file = findFirstFile(dir, AUDIO_EXTENSIONS);
  if (!file) throw new Error('yt-dlp did not produce an audio file');
  return file;
}

async function convertAudio({ audioFile, dir, execFile, ffmpegBin, timeoutMs }) {
  const output = join(dir, 'audio_transcribe.wav');
  await execFileAsync(execFile, ffmpegBin, [
    '-y',
    '-i', audioFile,
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-c:a', 'pcm_s16le',
    output,
  ], { cwd: dir, timeout: timeoutMs });
  return output;
}

async function segmentAudio({ audioFile, dir, execFile, ffmpegBin, timeoutMs, chunkSeconds }) {
  const outputPattern = join(dir, 'chunk-%03d.wav');
  await execFileAsync(execFile, ffmpegBin, [
    '-y',
    '-i', audioFile,
    '-f', 'segment',
    '-segment_time', String(chunkSeconds),
    '-c', 'copy',
    outputPattern,
  ], { cwd: dir, timeout: timeoutMs });
  const chunks = readdirSync(dir)
    .filter(name => /^chunk-\d+\.wav$/.test(name) && CHUNK_EXTENSIONS.has(extname(name).toLowerCase()))
    .sort()
    .map(name => join(dir, name));
  if (!chunks.length) throw new Error('ffmpeg did not produce audio chunks');
  return chunks;
}

async function transcribeAudio({ audioFile, fetchImpl, whisperServerUrl, timeoutMs }) {
  if (!whisperServerUrl) {
    throw new Error('WHISPER_SERVER_URL is required for video audio transcription');
  }

  const body = new FormData();
  body.set('temperature', '0');
  body.set('response_format', 'json');
  body.set('file', new Blob([readFileSync(audioFile)]), basename(audioFile));

  const response = await fetchImpl(whisperServerUrl, {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Whisper HTTP ${response.status}`);

  const payload = await response.json();
  const text = payload?.text || payload?.transcript || payload?.result;
  if (!text?.trim()) throw new Error('Whisper response did not contain transcript text');
  return text.trim();
}

async function transcribeAudioChunks({ audioFiles, fetchImpl, whisperServerUrl, timeoutMs }) {
  const transcripts = [];
  for (const [index, audioFile] of audioFiles.entries()) {
    console.info(`[video-transcript] Transcribing audio chunk ${index + 1}/${audioFiles.length}: ${basename(audioFile)}`);
    try {
      const text = await transcribeAudio({ audioFile, fetchImpl, whisperServerUrl, timeoutMs });
      if (text) transcripts.push(text);
    } catch (error) {
      throw new Error(`Whisper chunk ${index + 1}/${audioFiles.length} failed: ${error.message}`);
    }
  }
  return transcripts.join('\n\n').trim();
}

export async function extractTranscriptWithYtDlp(url, options = {}) {
  const execFile = options.execFile || execFileCallback;
  const fetchImpl = options.fetch || globalThis.fetch;
  const ytDlpBin = options.ytDlpBin || process.env.YTDLP_BIN || 'yt-dlp';
  const ffmpegBin = options.ffmpegBin || process.env.FFMPEG_BIN || 'ffmpeg';
  const whisperServerUrl = options.whisperServerUrl || process.env.WHISPER_SERVER_URL || '';
  const transcriptPostProcessor = options.transcriptPostProcessor === undefined
    ? punctuateTranscriptText
    : options.transcriptPostProcessor;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const audioChunkSeconds = options.audioChunkSeconds
    || positiveInteger(process.env.TRANSCRIPT_AUDIO_CHUNK_SECONDS, DEFAULT_AUDIO_CHUNK_SECONDS);
  const dir = options.tempDir || mkdtempSync(join(tmpdir(), 'linkbox-video-transcript-'));
  const shouldCleanup = !options.tempDir;

  try {
    const { stdout } = await execFileAsync(execFile, ytDlpBin, [
      ...baseYtDlpArgs(url),
      '--dump-single-json',
      '--skip-download',
      url,
    ], { cwd: dir, timeout: timeoutMs });
    const metadata = JSON.parse(stdout);
    const title = metadata?.title || 'Bilibili Video';
    const subtitle = pickSubtitle(metadata);

    if (subtitle) {
      const subtitleFile = await downloadSubtitle({ url, subtitle, dir, execFile, ytDlpBin, timeoutMs });
      if (subtitleFile) {
        const entries = parseSubtitleFile(subtitleFile);
        if (entries.length) {
          const markdown = subtitleEntriesToMarkdown(entries, subtitle.language);
          return {
            title,
            language: subtitle.language,
            mode: 'subtitle',
            markdown,
            wordCount: markdown.length,
          };
        }
      }
    }

    const audioFile = await downloadAudio({ url, dir, execFile, ytDlpBin, timeoutMs });
    const convertedAudio = await convertAudio({ audioFile, dir, execFile, ffmpegBin, timeoutMs });
    const audioChunks = await segmentAudio({
      audioFile: convertedAudio,
      dir,
      execFile,
      ffmpegBin,
      timeoutMs,
      chunkSeconds: audioChunkSeconds,
    });
    const rawTranscript = await transcribeAudioChunks({
      audioFiles: audioChunks,
      fetchImpl,
      whisperServerUrl,
      timeoutMs,
    });
    let transcript = rawTranscript;
    if (transcriptPostProcessor) {
      try {
        transcript = await transcriptPostProcessor(rawTranscript);
      } catch (error) {
        console.warn(`[video-transcript] Transcript punctuation post-process failed: ${error.message}`);
      }
    }
    const markdown = plainTranscriptToMarkdown(transcript, 'zh');
    return {
      title,
      language: 'zh',
      mode: 'whisper',
      markdown,
      wordCount: markdown.length,
    };
  } finally {
    if (shouldCleanup) rmSync(dir, { recursive: true, force: true });
  }
}
