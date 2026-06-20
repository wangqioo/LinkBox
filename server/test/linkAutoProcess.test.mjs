import test from 'node:test'
import assert from 'node:assert/strict'
import { getAutoProcessLinkUrl, isAutoProcessLinkText } from '../utils/linkAutoProcess.js'

test('isAutoProcessLinkText allows exact mobile auto-process URLs only', () => {
  assert.equal(isAutoProcessLinkText('https://mp.weixin.qq.com/s/abc'), true)
  assert.equal(isAutoProcessLinkText('https://weixin.qq.com/cgi-bin/readtemplate?t=abc'), true)
  assert.equal(isAutoProcessLinkText('https://zhuanlan.zhihu.com/p/123'), true)
  assert.equal(isAutoProcessLinkText('https://www.zhihu.com/p/123'), true)
  assert.equal(isAutoProcessLinkText('https://www.bilibili.com/video/BV1ZBjB6UEbt/?share_source=copy_web'), true)
  assert.equal(isAutoProcessLinkText('https://m.bilibili.com/video/BV1ZBjB6UEbt'), true)
})

test('isAutoProcessLinkText extracts allowed share URLs from surrounding text', () => {
  assert.equal(
    getAutoProcessLinkUrl('【B站独家】罗哥深夜对谈 https://www.bilibili.com/video/BV1ZBjB6UEbt/?share_source=copy_web'),
    'https://www.bilibili.com/video/BV1ZBjB6UEbt/?share_source=copy_web',
  )
  assert.equal(
    getAutoProcessLinkUrl('【花37天，破解上海最贵汉堡，成本只要。。。】 https://www.bilibili.com/video/BV1GDjB66EE9/?share_source=copy_web&vd_source=c7eacf65356bd9b3ebb5403b8ff1d512'),
    'https://www.bilibili.com/video/BV1GDjB66EE9/?share_source=copy_web&vd_source=c7eacf65356bd9b3ebb5403b8ff1d512',
  )
  assert.equal(
    getAutoProcessLinkUrl('【B站】 https://b23.tv/abc123'),
    'https://b23.tv/abc123',
  )
})

test('isAutoProcessLinkText rejects generic URLs and mixed generic message text', () => {
  assert.equal(isAutoProcessLinkText('https://example.com/article'), false)
  assert.equal(isAutoProcessLinkText('https://www.bilibili.com/read/cv123'), false)
  assert.equal(
    isAutoProcessLinkText('看看这个 https://example.com/article'),
    false,
  )
})
