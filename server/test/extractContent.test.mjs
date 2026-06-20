import test from 'node:test'
import assert from 'node:assert/strict'
import { extractPageMarkdown } from '../utils/extractContent.js'

test('extractPageMarkdown routes URLs to site extractor adapters', async () => {
  const calls = []
  const extractors = {
    weixin: async url => {
      calls.push(['weixin', url])
      return { markdown: 'weixin' }
    },
    zhihu: async url => {
      calls.push(['zhihu', url])
      return { markdown: 'zhihu' }
    },
    bilibili: async url => {
      calls.push(['bilibili', url])
      return { markdown: 'bilibili' }
    },
    generic: async url => {
      calls.push(['generic', url])
      return { markdown: 'generic' }
    },
  }

  assert.equal((await extractPageMarkdown('https://mp.weixin.qq.com/s/abc', { extractors })).markdown, 'weixin')
  assert.equal((await extractPageMarkdown('https://zhuanlan.zhihu.com/p/123', { extractors })).markdown, 'zhihu')
  assert.equal((await extractPageMarkdown('https://www.bilibili.com/video/BV1ZBjB6UEbt/', { extractors })).markdown, 'bilibili')
  assert.equal((await extractPageMarkdown('https://example.com/a', { extractors })).markdown, 'generic')
  assert.deepEqual(calls.map(call => call[0]), ['weixin', 'zhihu', 'bilibili', 'generic'])
})

test('extractPageMarkdown extracts Bilibili subtitle text from public player data', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => {
    const href = String(url)
    calls.push(href)
    if (href.includes('/video/BV1ZBjB6UEbt')) {
      return new Response(`
        <html><head><title>Bilibili</title></head><body>
        <script>
          window.__INITIAL_STATE__={
            "videoData":{
              "bvid":"BV1ZBjB6UEbt",
            "cid":98765,
            "title":"罗哥身边的人都怎么了？",
            "desc":"和王楚淇深夜对谈C罗",
            "pic":"//i0.hdslb.com/bfs/archive/cover.jpg",
            "owner":{"name":"B站独家"}
          }
          };
        </script>
        </body></html>
      `, { status: 200, headers: { 'content-type': 'text/html' } })
    }
    if (href.includes('/x/player/v2')) {
      return Response.json({
        code: 0,
        data: {
          subtitle: {
            subtitles: [
              { lan: 'zh-CN', lan_doc: '中文', subtitle_url: '//sub.example/subtitle.json' },
            ],
          },
        },
      })
    }
    if (href === 'https://sub.example/subtitle.json') {
      return Response.json({
        body: [
          { from: 0, to: 2, content: '大家好，今天聊聊这场对谈。' },
          { from: 2, to: 5, content: '罗哥身边的人发生了很多变化。' },
        ],
      })
    }
    throw new Error(`Unexpected fetch ${href}`)
  }

  try {
    const result = await extractPageMarkdown(
      'https://www.bilibili.com/video/BV1ZBjB6UEbt/?share_source=copy_web',
      { vision: false },
    )

    assert.equal(result.title, '罗哥身边的人都怎么了？')
    assert.equal(result.author, 'B站独家')
    assert.equal(result.siteName, 'Bilibili')
    assert.equal(result.thumbnail, 'https://i0.hdslb.com/bfs/archive/cover.jpg')
    assert.match(result.markdown, /## 视频字幕/)
    assert.match(result.markdown, /00:00 大家好，今天聊聊这场对谈。/)
    assert.match(result.markdown, /00:02 罗哥身边的人发生了很多变化。/)
    assert.equal(calls.some(url => url.includes('/x/player/v2') && url.includes('bvid=BV1ZBjB6UEbt')), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('extractPageMarkdown falls back to embedded Bilibili video transcription when public subtitles are absent', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => {
    const href = String(url)
    calls.push(href)
    if (href.includes('/video/BV1ZBjB6UEbt')) {
      return new Response(`
        <html><head><title>Bilibili</title></head><body>
        <script>
          window.__INITIAL_STATE__={
            "videoData":{
              "bvid":"BV1ZBjB6UEbt",
            "cid":98765,
            "title":"罗哥身边的人都怎么了？",
            "desc":"和王楚淇深夜对谈C罗",
            "pic":"https://i0.hdslb.com/bfs/archive/fallback.jpg",
            "owner":{"name":"B站独家"}
          }
          };
        </script>
        </body></html>
      `, { status: 200, headers: { 'content-type': 'text/html' } })
    }
    if (href.includes('/x/player/v2')) {
      return Response.json({
        code: 0,
        data: { subtitle: { subtitles: [] } },
      })
    }
    throw new Error(`Unexpected fetch ${href}`)
  }

  try {
    const result = await extractPageMarkdown(
      'https://www.bilibili.com/video/BV1ZBjB6UEbt/?share_source=copy_web',
      {
        vision: false,
        videoTranscriptExtractor: async (url) => ({
          title: 'B站视频转写标题',
          mode: 'whisper',
          markdown: '# Video Transcription\n\n转写出来的视频内容',
          wordCount: 39,
        }),
      },
    )

    assert.equal(result.title, 'B站视频转写标题')
    assert.equal(result.author, 'B站独家')
    assert.equal(result.siteName, 'Bilibili')
    assert.equal(result.thumbnail, 'https://i0.hdslb.com/bfs/archive/fallback.jpg')
    assert.match(result.markdown, /转写出来的视频内容/)
    assert.equal(calls.some(url => url.includes('/x/player/v2')), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('extractPageMarkdown fails Bilibili extraction when subtitles and audio transcription both fail', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const href = String(url)
    if (href.includes('/video/BV1ZBjB6UEbt')) {
      return new Response(`
        <html><head><title>Bilibili</title></head><body>
        <script>
          window.__INITIAL_STATE__={
            "videoData":{
              "bvid":"BV1ZBjB6UEbt",
              "cid":98765,
              "title":"没有字幕的视频",
              "desc":"",
              "owner":{"name":"B站独家"}
            }
          };
        </script>
        </body></html>
      `, { status: 200, headers: { 'content-type': 'text/html' } })
    }
    if (href.includes('/x/player/v2')) {
      return Response.json({
        code: 0,
        data: { subtitle: { subtitles: [] } },
      })
    }
    throw new Error(`Unexpected fetch ${href}`)
  }

  try {
    await assert.rejects(
      () => extractPageMarkdown(
        'https://www.bilibili.com/video/BV1ZBjB6UEbt/?share_source=copy_web',
        {
          vision: false,
          videoTranscriptExtractor: async () => {
            throw new Error('yt-dlp failed')
          },
        },
      ),
      /Bilibili video audio transcription failed: yt-dlp failed/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
