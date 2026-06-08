export type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'code'; lang: string; lines: string[] }
  | { kind: 'image'; url: string; alt: string; description?: string }
  | { kind: 'blockquote'; lines: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'hr' }
  | { kind: 'html'; html: string }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'paragraph'; lines: string[] };

export const proxyImg = (url: string) => {
  const u = url.trim();
  return u.startsWith('http') ? '/api/links/image-proxy?url=' + encodeURIComponent(u) : u;
};

function extractCells(lines: string[], startI: number, endI: number): string[] {
  const cells: string[] = [];
  let current: string[] = [];
  const separatorPattern = /^\|[\s\-:|]+\|$/;

  for (let j = startI; j < endI; j++) {
    const text = lines[j].trim();
    if (text === '') continue;

    if (text === '|') {
      const cell = current.join(' ').trim();
      if (cell) cells.push(cell);
      current = [];
      continue;
    }

    if (text.startsWith('|') && text.endsWith('|') && text.length > 1 && !separatorPattern.test(text)) {
      const cell = current.join(' ').trim();
      if (cell) cells.push(cell);
      current = [];
      text.slice(1, -1).split('|').map(part => part.trim()).filter(Boolean).forEach(part => cells.push(part));
      continue;
    }

    current.push(text);
  }

  const last = current.join(' ').trim();
  if (last) cells.push(last);
  return cells;
}

function extractRow(
  lines: string[],
  startI: number,
  maxCells: number,
): { cells: string[]; nextI: number } | null {
  if (lines[startI].trim() !== '|') return null;
  const separatorPattern = /^\|[\s\-:|]+\|$/;
  const cells: string[] = [];
  let current: string[] = [];
  let j = startI + 1;
  const limit = startI + 80;

  while (j < lines.length && j < limit) {
    const text = lines[j].trim();

    if (text === '') { j++; continue; }

    if (text === '|') {
      const cell = current.join(' ').trim();
      if (cell) cells.push(cell);
      current = [];
      j++;
      if (cells.length >= maxCells) break;
      continue;
    }

    if (text.startsWith('|') && text.endsWith('|') && text.length > 1 && !separatorPattern.test(text)) {
      const cell = current.join(' ').trim();
      if (cell) cells.push(cell);
      current = [];
      text.slice(1, -1).split('|').map(part => part.trim()).filter(Boolean).forEach(part => cells.push(part));
      j++;
      if (cells.length >= maxCells) break;
      continue;
    }

    current.push(text);
    j++;
  }

  const last = current.join(' ').trim();
  if (last) cells.push(last);
  return { cells, nextI: j };
}

function tryMultilineTable(
  lines: string[],
  startI: number,
): { block: MarkdownBlock; nextI: number } | null {
  if (lines[startI].trim() !== '|') return null;

  let sepIdx = -1;
  for (let j = startI + 1; j < Math.min(startI + 80, lines.length); j++) {
    if (/^\s*\|[\s\-:|]+\|\s*$/.test(lines[j])) { sepIdx = j; break; }
  }
  if (sepIdx === -1) return null;

  const header = extractCells(lines, startI, sepIdx);
  if (header.length === 0) return null;

  const rows: string[][] = [];
  let i = sepIdx + 1;

  while (i < lines.length && rows.length < 100) {
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i >= lines.length || lines[i].trim() !== '|') break;

    const result = extractRow(lines, i, header.length);
    if (!result || result.cells.length === 0) break;
    rows.push(result.cells);
    i = result.nextI;
  }

  return { block: { kind: 'table', header, rows }, nextI: i };
}

export function parseBlocks(content: string): MarkdownBlock[] {
  const lines = content.split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      blocks.push({ kind: 'heading', level: headingMatch[1].length, text: headingMatch[2] });
      i++;
      continue;
    }

    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++; }
      blocks.push({ kind: 'code', lang, lines: codeLines });
      i++;
      continue;
    }

    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      const imgUrl = proxyImg(imgMatch[2].trim());
      const imgAlt = imgMatch[1].trim();
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      const descLine = j < lines.length ? lines[j] : '';
      const descMatch = descLine.match(/^>\s*图片描述[：:]\s*(.*)/);
      if (descMatch) {
        const descParts = [descMatch[1]];
        let k = j + 1;
        while (k < lines.length && lines[k].startsWith('> ')) {
          descParts.push(lines[k].slice(2));
          k++;
        }
        blocks.push({ kind: 'image', url: imgUrl, alt: imgAlt, description: descParts.join(' ').trim() });
        i = k;
      } else {
        blocks.push({ kind: 'image', url: imgUrl, alt: imgAlt });
        i++;
      }
      continue;
    }

    if (line.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) { quoteLines.push(lines[i].slice(2)); i++; }
      blocks.push({ kind: 'blockquote', lines: quoteLines });
      continue;
    }

    if (line.match(/^[\-\*\+]\s/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[\-\*\+]\s/)) {
        items.push(lines[i].replace(/^[\-\*\+]\s/, '')); i++;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }

    if (line.match(/^\d+\.\s/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
        items.push(lines[i].replace(/^\d+\.\s/, '')); i++;
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }

    if (line.match(/^[-*_]{3,}\s*$/)) {
      blocks.push({ kind: 'hr' });
      i++;
      continue;
    }

    if (line.match(/^<[a-zA-Z]/)) {
      const htmlLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== '') { htmlLines.push(lines[i]); i++; }
      blocks.push({ kind: 'html', html: htmlLines.join('\n') });
      continue;
    }

    if (line.trim().startsWith('|')) {
      if (line.trim() === '|') {
        const mlResult = tryMultilineTable(lines, i);
        if (mlResult) {
          blocks.push(mlResult.block);
          i = mlResult.nextI;
          continue;
        }
        i++;
        continue;
      }

      if (line.trim().endsWith('|')) {
        const tableLines: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
          tableLines.push(lines[i]); i++;
        }
        if (tableLines.length >= 2) {
          const parseRow = (row: string) => row.trim().slice(1, -1).split('|').map(cell => cell.trim());
          const header = parseRow(tableLines[0]);
          const isSep = /^\|[\s\-:|]+\|$/.test(tableLines[1].trim());
          const bodyStart = isSep ? 2 : 1;
          const rows = tableLines.slice(bodyStart).map(parseRow);
          blocks.push({ kind: 'table', header, rows });
        }
        continue;
      }

      i++;
      continue;
    }

    if (line.trim() === '') { i++; continue; }

    const paraLines: string[] = [];
    while (i < lines.length) {
      const currentLine = lines[i];
      if (currentLine.trim() === '' || currentLine.match(/^#{1,6}\s/) || currentLine.startsWith('```') ||
          currentLine.startsWith('> ') || currentLine.match(/^[\-\*\+]\s/) || currentLine.match(/^\d+\.\s/) ||
          currentLine.match(/^[-*_]{3,}\s*$/) || (currentLine.trim().startsWith('|') && currentLine.trim().endsWith('|')) ||
          currentLine.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)) break;
      paraLines.push(currentLine);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ kind: 'paragraph', lines: paraLines });
    } else {
      i++;
    }
  }

  return blocks;
}
