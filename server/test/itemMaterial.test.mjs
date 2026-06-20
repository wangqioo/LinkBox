import test from 'node:test';
import assert from 'node:assert/strict';
import {
  materialForItem,
  attachItemMaterial,
} from '../utils/itemMaterial.js';

test('materialForItem returns content and asset shape with legacy fallback', () => {
  const material = materialForItem({
    content: 'plain note',
    content_md: '# Extracted',
    summary: 'short summary',
    html_note: '<article></article>',
    thumbnail: 'https://example.com/cover.jpg',
    image_path: '/uploads/file.pdf',
  });

  assert.deepEqual(material, {
    textContent: 'plain note',
    extractedMarkdown: '# Extracted',
    summary: 'short summary',
    htmlNote: '<article></article>',
    primaryAssetUrl: '/uploads/file.pdf',
    thumbnailUrl: 'https://example.com/cover.jpg',
    hasExtractedMarkdown: true,
    hasHtmlNote: true,
  });
});

test('materialForItem falls back to item_content when canonical fields are attached', () => {
  const material = materialForItem({
    content: '',
    content_md: '',
    summary: '',
    item_content: {
      text_content: 'canonical text',
      extracted_markdown: 'canonical markdown',
      summary: 'canonical summary',
      html_note: 'canonical html',
    },
  });

  assert.equal(material.textContent, 'canonical text');
  assert.equal(material.extractedMarkdown, 'canonical markdown');
  assert.equal(material.summary, 'canonical summary');
  assert.equal(material.htmlNote, 'canonical html');
});

test('attachItemMaterial adds material without removing legacy fields', () => {
  const item = { id: 1, content_md: 'md', image_path: '/uploads/a.png' };
  const attached = attachItemMaterial(item);

  assert.equal(attached.content_md, 'md');
  assert.equal(attached.material.extractedMarkdown, 'md');
  assert.equal(attached.material.primaryAssetUrl, '/uploads/a.png');
});
