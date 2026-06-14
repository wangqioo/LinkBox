export function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function normalizeCitations(value, maxSourceNumber = 0) {
  return String(value || '')
    .replace(/\[资料(\d+)\s*-\s*(\d+)\]/g, (_match, start, end) => {
      const from = Number(start);
      const to = maxSourceNumber ? Math.min(Number(end), maxSourceNumber) : Number(end);
      if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || to - from > 20) return '';
      return Array.from({ length: to - from + 1 }, (_v, index) => `[资料${from + index}]`).join('');
    })
    .replace(/\[资料(\d+)(?!\])/g, (match, n) => {
      const value = Number(n);
      if (!Number.isFinite(value)) return match;
      if (maxSourceNumber && value > maxSourceNumber) return match;
      return `[资料${value}]`;
    });
}

function sanitizeTableHtml(rawHtml) {
  return String(rawHtml || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|svg|math|template)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|svg|math|template)[^>]*\/?\s*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/<div\b[^>]*\bdata-linkbox-table\b[^>]*>/gi, '<div data-linkbox-table="">')
    .replace(/<table\b[^>]*>\s*<tr\b/gi, '<table><tbody><tr')
    .replace(/<tr\b[^>]*>/gi, '<tr>')
    .replace(/<td\b[^>]*>/gi, '<td>')
    .replace(/<th\b[^>]*>/gi, '<th>')
    .replace(/<\/tr>\s*<\/table>/gi, '</tr></tbody></table>');
}

export function parseBlocks(markdown) {
  const lines = normalizeCitations(markdown).split(/\r?\n/);
  const blocks = [];
  let paragraph = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    blocks.push({
      kind: 'paragraph',
      lines: paragraph.map(escapeHtml),
    });
    paragraph = [];
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const imageMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imageMatch) {
      flushParagraph();
      blocks.push({
        kind: 'image',
        alt: imageMatch[1].trim(),
        url: imageMatch[2].trim(),
      });
      continue;
    }

    if (/^<div\b[^>]*\bdata-linkbox-table\b/i.test(line)) {
      flushParagraph();
      const htmlLines = [line];
      while (!line.includes('</div>') && i + 1 < lines.length) {
        i += 1;
        htmlLines.push(lines[i]);
        if (lines[i].includes('</div>')) break;
      }
      blocks.push({
        kind: 'html',
        html: sanitizeTableHtml(htmlLines.join('\n')),
      });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

export function renderBlocksToHtml(blocks, { proxyImageUrl } = {}) {
  return blocks.map(block => {
    if (block.kind === 'image') {
      const src = proxyImageUrl ? proxyImageUrl(block.url) : block.url;
      return `<p><img alt="${escapeHtml(block.alt)}" src="${escapeHtml(src)}" /></p>`;
    }
    if (block.kind === 'html') {
      return `<div class="table-scroll">${block.html}</div>`;
    }
    if (block.kind === 'paragraph') {
      return `<p>${block.lines.join('<br>')}</p>`;
    }
    return '';
  }).join('');
}
