import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeXmlEntities,
  extractHtmlText,
  findImagePlaceholders,
  formatImageBlock,
  replaceImagePlaceholdersWithDescriptions,
} from '../utils/fileMarkdownUtils.js';

test('decodeXmlEntities decodes numeric and named XML entities', () => {
  const decoded = decodeXmlEntities('Tom &amp; Jerry &#20320;&#x597D; &lt;b&gt;&quot;x&quot;&lt;/b&gt;');
  assert.equal(decoded, 'Tom & Jerry 你好 <b>"x"</b>');
});

test('formatImageBlock includes optional Chinese image description', () => {
  assert.equal(formatImageBlock('/uploads/a.png', ''), '![image](/uploads/a.png)');
  assert.equal(
    formatImageBlock('/uploads/a.png', '一张产品图'),
    '![image](/uploads/a.png)\n\n> 图片描述：一张产品图',
  );
});

test('extractHtmlText removes script/style/tags and normalizes whitespace', () => {
  const html = `
    <html>
      <style>.hidden { display: none; }</style>
      <script>window.secret = 1</script>
      <body><h1>标题</h1><p>第一段 <strong>重点</strong></p></body>
    </html>
  `;
  assert.equal(extractHtmlText(html), '标题 第一段 重点');
});

test('findImagePlaceholders returns placeholders and upload urls', () => {
  const placeholders = findImagePlaceholders('a\n__IMG_PLACEHOLDER__/uploads/img_1.png__END__\nb');
  assert.deepEqual(placeholders, [{
    full: '__IMG_PLACEHOLDER__/uploads/img_1.png__END__',
    url: '/uploads/img_1.png',
  }]);
});

test('replaceImagePlaceholdersWithDescriptions formats known descriptions', () => {
  const markdown = [
    'before',
    '__IMG_PLACEHOLDER__/uploads/a.png__END__',
    '__IMG_PLACEHOLDER__/uploads/b.png__END__',
  ].join('\n\n');

  const result = replaceImagePlaceholdersWithDescriptions(markdown, {
    '/uploads/a.png': '第一张图',
    '/uploads/b.png': '',
  });

  assert.equal(result, [
    'before',
    '![image](/uploads/a.png)\n\n> 图片描述：第一张图',
    '![image](/uploads/b.png)',
  ].join('\n\n'));
});
