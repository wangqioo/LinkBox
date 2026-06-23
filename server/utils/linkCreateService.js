import {
  describeUploadedFile,
  initialFileStatus,
  isHtmlFile,
  shouldExtractFile,
} from './linkPayloads.js';
import { attachProcessingStatus } from './itemProcessingStatus.js';
import { presentItem } from './itemPresentation.js';
import { upsertItemAsset } from './itemAssetStore.js';
import { upsertItemContent } from './itemContentStore.js';

export function attachTags(db, linkId) {
  return db.prepare('SELECT t.* FROM tags t JOIN link_tags lt ON t.id = lt.tag_id WHERE lt.link_id = ?').all(linkId);
}

export function setTags(db, linkId, tagIds) {
  db.prepare('DELETE FROM link_tags WHERE link_id = ?').run(linkId);
  if (tagIds?.length) {
    const stmt = db.prepare('INSERT OR IGNORE INTO link_tags (link_id, tag_id) VALUES (?, ?)');
    for (const tagId of tagIds) stmt.run(linkId, tagId);
  }
}

export function getLinkWithTags(db, linkId) {
  const link = db.prepare('SELECT * FROM links WHERE id = ?').get(linkId);
  return link ? presentItem(attachProcessingStatus(db, { ...link, tags: attachTags(db, link.id) })) : null;
}

function hasLinksScopeColumn(db) {
  return db.prepare('PRAGMA table_info(links)').all().some(column => column.name === 'scope');
}

function insertLinkRow(db, values) {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined);
  const columns = entries.map(([key]) => key);
  const params = entries.map(([, value]) => value);
  if (!hasLinksScopeColumn(db)) {
    const index = columns.indexOf('scope');
    if (index >= 0) {
      columns.splice(index, 1);
      params.splice(index, 1);
    }
  }
  return db.prepare(`
    INSERT INTO links (${columns.join(', ')})
    VALUES (${columns.map(() => '?').join(', ')})
  `).run(...params);
}

export function createLinkItem(db, {
  userId,
  url,
  title = '',
  comment = '',
  tagIds = [],
  importedAt = new Date().toISOString(),
  scope = 'personal',
}) {
  const result = insertLinkRow(db, {
    user_id: userId,
    type: 'link',
    url,
    title: title || url,
    description: '',
    thumbnail: '',
    comment: comment || '',
    imported_at: importedAt,
    status: 'processing',
    scope,
  });

  setTags(db, result.lastInsertRowid, tagIds);
  const link = getLinkWithTags(db, result.lastInsertRowid);

  return {
    link,
    processing: {
      linkId: result.lastInsertRowid,
      url,
      title,
    },
  };
}

export function createTextItem(db, {
  userId,
  title = '',
  content = '',
  comment = '',
  tagIds = [],
  importedAt = new Date().toISOString(),
  indexLink = () => {},
  scope = 'personal',
}) {
  const result = insertLinkRow(db, {
    user_id: userId,
    type: 'text',
    url: '',
    title: title || '',
    content: content || '',
    comment: comment || '',
    imported_at: importedAt,
    scope,
  });

  setTags(db, result.lastInsertRowid, tagIds);
  upsertItemContent(db, result.lastInsertRowid, { text_content: content || '' });
  indexLink(result.lastInsertRowid);

  return {
    link: getLinkWithTags(db, result.lastInsertRowid),
  };
}

export function importLinkItems(db, {
  userId,
  items,
}) {
  const imported = [];
  const toFetch = [];

  for (const item of items) {
    const url = typeof item === 'string' ? item : item.url;
    if (!url) continue;

    const explicitTitle = typeof item === 'string' ? '' : item.title;
    const result = db.prepare(`
      INSERT INTO links (user_id, type, url, title, description, thumbnail, comment, imported_at, status)
      VALUES (?, 'link', ?, ?, '', '', ?, ?, 'processing')
    `).run(
      userId,
      url,
      explicitTitle || url,
      typeof item === 'string' ? '' : item.comment || '',
      typeof item === 'string' ? new Date().toISOString() : item.imported_at || new Date().toISOString(),
    );

    imported.push(result.lastInsertRowid);
    toFetch.push({ id: result.lastInsertRowid, url, title: explicitTitle || '' });
  }

  return { imported: imported.length, toFetch };
}

export function createImageItem(db, {
  userId,
  imagePath,
  diskPath,
  originalName,
  title = '',
  comment = '',
  tagIds = [],
  importedAt = new Date().toISOString(),
  batchId = '',
  batchIndex = 0,
  scope = 'personal',
}) {
  const result = insertLinkRow(db, {
    user_id: userId,
    type: 'image',
    url: '',
    title: title || originalName,
    image_path: imagePath,
    thumbnail: imagePath,
    comment: comment || '',
    imported_at: importedAt,
    status: 'processing',
    batch_id: batchId || '',
    batch_index: Number(batchIndex) || 0,
    scope,
  });

  setTags(db, result.lastInsertRowid, tagIds);
  upsertItemAsset(db, result.lastInsertRowid, {
    kind: 'image',
    publicPath: imagePath,
    diskPath,
    originalName: originalName || title || '',
    metadata: { source: 'createImageItem' },
  });
  const link = getLinkWithTags(db, result.lastInsertRowid);

  return {
    link,
    processing: {
      linkId: result.lastInsertRowid,
      diskPath,
    },
  };
}

export function createAudioItem(db, {
  userId,
  audioPath,
  title = '',
  comment = '',
  tagIds = [],
  importedAt = new Date().toISOString(),
  scope = 'personal',
}) {
  const result = insertLinkRow(db, {
    user_id: userId,
    type: 'audio',
    url: '',
    title: title || '录音',
    image_path: audioPath,
    comment: comment || '',
    imported_at: importedAt,
    scope,
  });

  setTags(db, result.lastInsertRowid, tagIds);
  upsertItemAsset(db, result.lastInsertRowid, {
    kind: 'audio',
    publicPath: audioPath,
    originalName: title || audioPath.split('/').pop() || '',
    metadata: { source: 'createAudioItem' },
  });

  return {
    link: getLinkWithTags(db, result.lastInsertRowid),
  };
}

export function createFileItem(db, {
  userId,
  filePath,
  diskPath,
  originalName,
  sizeBytes = 0,
  title = '',
  comment = '',
  tagIds = [],
  importedAt = new Date().toISOString(),
  scope = 'personal',
}) {
  const description = describeUploadedFile(originalName, sizeBytes);
  const status = initialFileStatus(originalName);
  const result = insertLinkRow(db, {
    user_id: userId,
    type: 'file',
    url: '',
    title: title || originalName,
    description,
    image_path: filePath,
    comment: comment || '',
    imported_at: importedAt,
    status,
    scope,
  });

  setTags(db, result.lastInsertRowid, tagIds);
  upsertItemAsset(db, result.lastInsertRowid, {
    kind: 'file',
    publicPath: filePath,
    diskPath,
    originalName,
    sizeBytes,
    metadata: { source: 'createFileItem' },
  });
  const link = getLinkWithTags(db, result.lastInsertRowid);
  const processing = shouldExtractFile(originalName)
    ? {
        linkId: result.lastInsertRowid,
        diskPath,
        originalName,
        isHtml: isHtmlFile(originalName),
      }
    : null;

  return { link, processing };
}
