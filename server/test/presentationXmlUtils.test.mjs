import test from 'node:test';
import assert from 'node:assert/strict';
import {
  presentationParagraphLines,
  slideToMarkdown,
} from '../utils/presentationXmlUtils.js';

test('presentationParagraphLines extracts decoded slide paragraph text', () => {
  const xml = `
    <p:sld>
      <a:p><a:r><a:t>标题 &amp; 摘要</a:t></a:r></a:p>
      <a:p><a:r><a:t>第一点</a:t></a:r><a:r><a:t> 补充</a:t></a:r></a:p>
      <a:p></a:p>
    </p:sld>
  `;

  assert.deepEqual(presentationParagraphLines(xml), ['标题 & 摘要', '第一点 补充']);
});

test('slideToMarkdown formats title, bullet lines, and image placeholders', () => {
  assert.equal(
    slideToMarkdown(2, ['封面', '卖点', '计划'], [
      '__IMG_PLACEHOLDER__/uploads/a.png__END__',
    ]),
    [
      '### Slide 2: 封面',
      '',
      '- 卖点',
      '- 计划',
      '',
      '__IMG_PLACEHOLDER__/uploads/a.png__END__',
    ].join('\n'),
  );
});

test('slideToMarkdown supports image-only slides', () => {
  assert.equal(
    slideToMarkdown(3, [], ['__IMG_PLACEHOLDER__/uploads/a.png__END__']),
    [
      '### Slide 3',
      '',
      '__IMG_PLACEHOLDER__/uploads/a.png__END__',
    ].join('\n'),
  );
});

test('slideToMarkdown returns an empty string for blank slides', () => {
  assert.equal(slideToMarkdown(4, [], []), '');
});
