import test from 'node:test'
import assert from 'node:assert/strict'
import { parseBlocks, renderBlocksToHtml } from './markdownParser.js'

test('parseBlocks escapes unsafe raw HTML and normalizes citations', () => {
  const blocks = parseBlocks(`结论见[资料1 - 2]和[资料4
<script>alert("x")</script>`)

  assert.deepEqual(blocks, [
    {
      kind: 'paragraph',
      lines: [
        '结论见[资料1][资料2]和[资料4]',
        '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
      ],
    },
  ])
})

test('renderBlocksToHtml proxies markdown images and sanitizes html table blocks', () => {
  const blocks = parseBlocks(`![封面](https://example.com/a.png)

<div data-linkbox-table onclick="alert(1)"><table><tr><td onmouseover="x">A</td><script>alert(1)</script></tr></table></div>`)

  assert.equal(
    renderBlocksToHtml(blocks, { proxyImageUrl: src => `/proxy?url=${encodeURIComponent(src)}` }),
    '<p><img alt="封面" src="/proxy?url=https%3A%2F%2Fexample.com%2Fa.png" /></p><div class="table-scroll"><div data-linkbox-table=""><table><tbody><tr><td>A</td></tr></tbody></table></div></div>',
  )
})
