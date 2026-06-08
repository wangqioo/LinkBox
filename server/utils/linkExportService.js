export function exportSummariesMarkdown(db, {
  userId,
  ids = null,
  today = new Date().toISOString().slice(0, 10),
}) {
  let links;

  if (ids?.length) {
    const placeholders = ids.map(() => '?').join(',');
    links = db.prepare(
      `SELECT title, url, summary, imported_at FROM links WHERE user_id = ? AND id IN (${placeholders}) AND summary != '' AND summary IS NOT NULL ORDER BY imported_at DESC`
    ).all(userId, ...ids);
  } else {
    links = db.prepare(
      "SELECT title, url, summary, imported_at FROM links WHERE user_id = ? AND summary != '' AND summary IS NOT NULL ORDER BY imported_at DESC"
    ).all(userId);
  }

  const NL = '\n';
  let markdown = '# LinkBox 摘要导出' + NL;
  markdown += '> 导出时间：' + today + NL + NL;
  markdown += '---' + NL + NL;

  links.forEach((link, index) => {
    const date = link.imported_at ? link.imported_at.slice(0, 10) : '';
    markdown += '## ' + (index + 1) + '. ' + (link.title || link.url) + NL;
    if (date) markdown += '_' + date + '_  ' + NL;
    markdown += '[' + link.url + '](' + link.url + ')' + NL + NL;
    markdown += link.summary + NL + NL;
    markdown += '---' + NL + NL;
  });

  return {
    markdown,
    filename: 'linkbox-summaries-' + today + '.md',
  };
}

export function exportAllData(db, {
  userId,
  exportedAt = new Date().toISOString(),
}) {
  const links = db.prepare('SELECT * FROM links WHERE user_id = ? ORDER BY imported_at DESC').all(userId);
  const tags = db.prepare('SELECT * FROM tags WHERE user_id = ?').all(userId);
  const linkTags = db.prepare('SELECT lt.* FROM link_tags lt JOIN links l ON lt.link_id = l.id WHERE l.user_id = ?').all(userId);

  return { links, tags, linkTags, exported_at: exportedAt };
}
