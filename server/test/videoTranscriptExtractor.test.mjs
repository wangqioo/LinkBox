import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  extractTranscriptWithYtDlp,
  punctuateTranscriptText,
  parseVtt,
  subtitleEntriesToMarkdown,
} from '../utils/videoTranscriptExtractor.js';

async function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'linkbox-video-transcript-test-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('parseVtt removes cue tags and rolling duplicate captions', () => {
  const entries = parseVtt([
    'WEBVTT',
    '',
    '00:00.000 --> 00:01.000',
    '<c>大家</c>',
    '',
    '00:01.000 --> 00:03.000',
    '<00:01.200>大家好',
    '',
    '00:03.000 --> 00:05.000',
    '今天聊聊这场对谈',
  ].join('\n'));

  assert.deepEqual(entries, [
    { start: '00:01', end: '00:03', text: '大家好' },
    { start: '00:03', end: '00:05', text: '今天聊聊这场对谈' },
  ]);
});

test('subtitleEntriesToMarkdown formats subtitle entries for LinkBox markdown', () => {
  assert.equal(
    subtitleEntriesToMarkdown([
      { start: '00:01', end: '00:03', text: '大家好' },
    ], 'zh-Hans'),
    [
      '# Video Transcription',
      '',
      '**Detected Language:** zh-Hans',
      '**Language Probability:** 1.00',
      '',
      '## Transcription Content',
      '',
      '**[00:01 - 00:03]**',
      '',
      '大家好',
      '',
    ].join('\n'),
  );
});

test('extractTranscriptWithYtDlp returns downloaded subtitles before audio transcription', async () => withTempDir(async (dir) => {
  const calls = [];
  const execFile = (command, args, options, callback) => {
    calls.push({ command, args, cwd: options.cwd });
    if (args.includes('--dump-single-json')) {
      callback(null, JSON.stringify({
        title: 'B站视频',
        subtitles: { 'zh-Hans': [{ ext: 'vtt' }] },
        automatic_captions: {},
      }), '');
      return;
    }
    writeFileSync(join(options.cwd, 'subtitle.zh-Hans.vtt'), [
      'WEBVTT',
      '',
      '00:00.000 --> 00:02.000',
      '第一句字幕',
    ].join('\n'));
    callback(null, '', '');
  };

  const result = await extractTranscriptWithYtDlp('https://www.bilibili.com/video/BV1ZBjB6UEbt/', {
    tempDir: dir,
    execFile,
  });

  assert.equal(result.title, 'B站视频');
  assert.equal(result.mode, 'subtitle');
  assert.match(result.markdown, /第一句字幕/);
  assert.equal(calls.some(call => call.args.includes('--write-subs')), true);
  assert.equal(calls.some(call => call.command === 'ffmpeg'), false);
}));

test('extractTranscriptWithYtDlp downloads audio and calls whisper when subtitles are absent', async () => withTempDir(async (dir) => {
  const calls = [];
  const execFile = (command, args, options, callback) => {
    calls.push({ command, args, cwd: options.cwd });
    if (args.includes('--dump-single-json')) {
      callback(null, JSON.stringify({
        title: '无字幕视频',
        subtitles: {},
        automatic_captions: {},
      }), '');
      return;
    }
    if (command === 'yt-dlp') {
      writeFileSync(join(options.cwd, 'audio.webm'), 'fake audio');
      callback(null, '', '');
      return;
    }
    if (command === 'ffmpeg') {
      const outputPath = args.at(-1);
      writeFileSync(outputPath, readFileSync(join(options.cwd, 'audio.webm')));
      callback(null, '', '');
      return;
    }
    callback(new Error(`unexpected command ${command}`), '', '');
  };
  const fetch = async (url, options) => {
    assert.equal(url, 'http://whisper.local/inference');
    assert.equal(options.method, 'POST');
    return Response.json({ text: '转写出来的视频内容' });
  };

  const result = await extractTranscriptWithYtDlp('https://www.bilibili.com/video/BV1ZBjB6UEbt/', {
    tempDir: dir,
    execFile,
    fetch,
    whisperServerUrl: 'http://whisper.local/inference',
    transcriptPostProcessor: null,
  });

  assert.equal(result.title, '无字幕视频');
  assert.equal(result.mode, 'whisper');
  assert.match(result.markdown, /转写出来的视频内容/);
  assert.equal(calls.some(call => call.command === 'ffmpeg'), true);
}));

test('extractTranscriptWithYtDlp post-processes whisper transcript punctuation', async () => withTempDir(async (dir) => {
  const execFile = (command, args, options, callback) => {
    if (args.includes('--dump-single-json')) {
      callback(null, JSON.stringify({ title: '无字幕视频', subtitles: {}, automatic_captions: {} }), '');
      return;
    }
    if (command === 'yt-dlp') {
      writeFileSync(join(options.cwd, 'audio.webm'), 'fake audio');
      callback(null, '', '');
      return;
    }
    if (command === 'ffmpeg') {
      writeFileSync(args.at(-1), readFileSync(join(options.cwd, 'audio.webm')));
      callback(null, '', '');
      return;
    }
    callback(new Error(`unexpected command ${command}`), '', '');
  };
  const fetch = async () => Response.json({ text: '今天我们来测试视频转写没有标点怎么办' });
  const result = await extractTranscriptWithYtDlp('https://www.bilibili.com/video/BV1ZBjB6UEbt/', {
    tempDir: dir,
    execFile,
    fetch,
    whisperServerUrl: 'http://whisper.local/inference',
    transcriptPostProcessor: async text => `${text}。`,
  });

  assert.match(result.markdown, /今天我们来测试视频转写没有标点怎么办。/);
}));

test('extractTranscriptWithYtDlp keeps raw whisper transcript when post-process fails', async () => withTempDir(async (dir) => {
  const execFile = (command, args, options, callback) => {
    if (args.includes('--dump-single-json')) {
      callback(null, JSON.stringify({ title: '无字幕视频', subtitles: {}, automatic_captions: {} }), '');
      return;
    }
    if (command === 'yt-dlp') {
      writeFileSync(join(options.cwd, 'audio.webm'), 'fake audio');
      callback(null, '', '');
      return;
    }
    if (command === 'ffmpeg') {
      writeFileSync(args.at(-1), readFileSync(join(options.cwd, 'audio.webm')));
      callback(null, '', '');
      return;
    }
    callback(new Error(`unexpected command ${command}`), '', '');
  };
  const fetch = async () => Response.json({ text: '原始转写文本' });
  const result = await extractTranscriptWithYtDlp('https://www.bilibili.com/video/BV1ZBjB6UEbt/', {
    tempDir: dir,
    execFile,
    fetch,
    whisperServerUrl: 'http://whisper.local/inference',
    transcriptPostProcessor: async () => {
      throw new Error('llm unavailable');
    },
  });

  assert.match(result.markdown, /原始转写文本/);
}));

test('punctuateTranscriptText asks LLM to add punctuation without changing content', async () => {
  const calls = [];
  const result = await punctuateTranscriptText('今天我们测试一下这个功能', {
    callChat: async payload => {
      calls.push(payload);
      return '今天，我们测试一下这个功能。';
    },
  });

  assert.equal(result, '今天，我们测试一下这个功能。');
  assert.match(calls[0].messages[0].content, /只添加中文标点/);
  assert.equal(calls[0].temperature, 0);
});

test('punctuateTranscriptText splits long transcripts into smaller AI calls', async () => {
  const calls = [];
  const result = await punctuateTranscriptText('第一段没有标点 第二段也没有标点 第三段还是没有标点', {
    chunkChars: 12,
    timeoutMs: 12345,
    callChat: async payload => {
      calls.push(payload);
      return `${payload.messages[1].content.split('\n\n').at(-1)}。`;
    },
  });

  assert.equal(calls.length > 1, true);
  assert.equal(calls.every(call => call.timeoutMs === 12345), true);
  assert.match(result, /第一段没有标点/);
  assert.match(result, /第三段还是没有标点。/);
});

test('punctuateTranscriptText keeps original chunk when one punctuation call fails', async () => {
  let index = 0;
  const result = await punctuateTranscriptText('第一段没有标点 第二段没有标点 第三段没有标点', {
    chunkChars: 10,
    callChat: async payload => {
      index += 1;
      const chunk = payload.messages[1].content.split('\n\n').at(-1);
      if (index === 2) throw new Error('timeout');
      return `${chunk}。`;
    },
  });

  assert.match(result, /第一段没有标点。/);
  assert.match(result, /第二段没有标点/);
  assert.match(result, /第三段没有标点。/);
});
