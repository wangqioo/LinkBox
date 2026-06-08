import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractDrawingEmbedRefs,
  extractWordText,
  parseRelationshipsByTypeSuffix,
  wordTableToMarkdown,
} from '../utils/officeXmlUtils.js';

test('parseRelationshipsByTypeSuffix reads relationships regardless of attribute order', () => {
  const relsXml = `
    <Relationships>
      <Relationship Id="rId1" Target="media/image1.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>
      <Relationship Target="../media/image2.jpg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Id="rId2"/>
      <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com"/>
    </Relationships>
  `;

  assert.deepEqual(parseRelationshipsByTypeSuffix(relsXml, '/image'), {
    rId1: 'media/image1.png',
    rId2: '../media/image2.jpg',
  });
});

test('extractDrawingEmbedRefs returns drawing relationship ids in document order', () => {
  const fragment = `
    <a:blip r:embed="rId1" cstate="print"/>
    <a:blip r:link="rIdExternal"/>
    <a:blip cstate="print" r:embed="rId2"/>
  `;

  assert.deepEqual(extractDrawingEmbedRefs(fragment), ['rId1', 'rId2']);
});

test('extractWordText joins text runs and decodes XML entities', () => {
  const fragment = `
    <w:r><w:t>Tom &amp; </w:t></w:r>
    <w:r><w:t>Jerry &#20320;&#x597D;</w:t></w:r>
  `;

  assert.equal(extractWordText(fragment), 'Tom & Jerry 你好');
});

test('wordTableToMarkdown converts uneven Word table rows into a padded markdown table', () => {
  const tableXml = `
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>名称</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>数量</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>苹果</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  `;

  assert.equal(wordTableToMarkdown(tableXml), [
    '| 名称 | 数量 |',
    '| --- | --- |',
    '| 苹果 |  |',
  ].join('\n'));
});
