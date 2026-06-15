import {
  describeUploadedFile,
  initialFileStatus,
  isHtmlFile,
  shouldExtractFile,
} from './linkPayloads.js';
import { presentItem } from './itemPresentation.js';

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
  return link ? presentItem({ ...link, tags: attachTags(db, link.id) }) : null;
}

export function createLinkItem(db, {
  userId,
  url,
  title = '',
  comment = '',
  tagIds = [],
  importedAt = new Date().toISOString(),
}) {
  const result = db.prepare(`
    INSERT INTO links (user_id, type, url, title, description, thumbnail, comment, imported_at, status)
    VALUES (?, 'link', ?, ?, '', '', ?, ?, 'processing')
  `).run(userId, url, title || url, comment || '', importedAt);

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
}) {
  const result = db.prepare(`
    INSERT INTO links (user_id, type, url, title, content, comment, imported_at)
    VALUES (?, 'text', '', ?, ?, ?, ?)
  `).run(userId, title || '', content || '', comment || '', importedAt);

  setTags(db, result.lastInsertRowid, tagIds);
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
}) {
  const result = db.prepare(`
    INSERT INTO links (user_id, type, url, title, image_path, thumbnail, comment, imported_at, status)
    VALUES (?, 'image', '', ?, ?, ?, ?, ?, 'processing')
  `).run(userId, title || originalName, imagePath, imagePath, comment || '', importedAt);

  setTags(db, result.lastInsertRowid, tagIds);
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
}) {
  const result = db.prepare(`
    INSERT INTO links (user_id, type, url, title, image_path, comment, imported_at)
    VALUES (?, 'audio', '', ?, ?, ?, ?)
  `).run(userId, title || '录音', audioPath, comment || '', importedAt);

  setTags(db, result.lastInsertRowid, tagIds);

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
}) {
  const description = describeUploadedFile(originalName, sizeBytes);
  const status = initialFileStatus(originalName);
  const result = db.prepare(`
    INSERT INTO links (user_id, type, url, title, description, image_path, comment, imported_at, status)
    VALUES (?, 'file', '', ?, ?, ?, ?, ?, ?)
  `).run(userId, title || originalName, description, filePath, comment || '', importedAt, status);

  setTags(db, result.lastInsertRowid, tagIds);
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
