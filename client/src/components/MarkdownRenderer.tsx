import { useMemo, useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

const proxyImg = (url: string) => {
  const u = url.trim();
  return u.startsWith('http') ? '/api/links/image-proxy?url=' + encodeURIComponent(u) : u;
};

interface Props {
  content: string;
  className?: string;
  maxLines?: number;
}

// ---------------------------------------------------------------------------
// Block types (plain data, no React)
// ---------------------------------------------------------------------------
type Block =
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

// ---------------------------------------------------------------------------
// WeChat multi-line table helpers
// ---------------------------------------------------------------------------

/** Extract non-empty cells from lines[startI..endI), treating lone | as separators. */
function extractCells(lines: string[], startI: number, endI: number): string[] {
  const cells: string[] = [];
  let current: string[] = [];
  const SEP_RE = /^\|[\s\-:|]+\|$/;

  for (let j = startI; j < endI; j++) {
    const t = lines[j].trim();
    if (t === '') continue;

    if (t === '|') {
      const txt = current.join(' ').trim();
      if (txt) cells.push(txt);
      current = [];
      continue;
    }

    // Inline "| cell1 | cell2 |" line (not a separator)
    if (t.startsWith('|') && t.endsWith('|') && t.length > 1 && !SEP_RE.test(t)) {
      const txt = current.join(' ').trim();
      if (txt) cells.push(txt);
      current = [];
      t.slice(1, -1).split('|').map(s => s.trim()).filter(Boolean).forEach(p => cells.push(p));
      continue;
    }

    current.push(t);
  }
  const last = current.join(' ').trim();
  if (last) cells.push(last);
  return cells;
}

/** Collect one row starting at lines[startI] (lone pipe), up to maxCells cells. */
function extractRow(
  lines: string[],
  startI: number,
  maxCells: number,
): { cells: string[]; nextI: number } | null {
  if (lines[startI].trim() !== '|') return null;
  const SEP_RE = /^\|[\s\-:|]+\|$/;
  const cells: string[] = [];
  let current: string[] = [];
  let j = startI + 1;
  const limit = startI + 80;

  while (j < lines.length && j < limit) {
    const t = lines[j].trim();

    if (t === '') { j++; continue; }

    if (t === '|') {
      const txt = current.join(' ').trim();
      if (txt) cells.push(txt);
      current = [];
      j++;
      if (cells.length >= maxCells) break;
      continue;
    }

    if (t.startsWith('|') && t.endsWith('|') && t.length > 1 && !SEP_RE.test(t)) {
      const txt = current.join(' ').trim();
      if (txt) cells.push(txt);
      current = [];
      t.slice(1, -1).split('|').map(s => s.trim()).filter(Boolean).forEach(p => cells.push(p));
      j++;
      if (cells.length >= maxCells) break;
      continue;
    }

    current.push(t);
    j++;
  }

  const last = current.join(' ').trim();
  if (last) cells.push(last);
  return { cells, nextI: j };
}

/**
 * Try to parse a WeChat-style multi-line table where lone | lines act as
 * cell delimiters and a standard "| --- |" separator separates header from body.
 */
function tryMultilineTable(
  lines: string[],
  startI: number,
): { block: Block; nextI: number } | null {
  if (lines[startI].trim() !== '|') return null;

  // Look for the separator row within the next 80 lines
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

// ---------------------------------------------------------------------------
// Parse all lines into blocks — pure string ops, no React, runs once
// ---------------------------------------------------------------------------
function parseBlocks(content: string): Block[] {
  const lines = content.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      blocks.push({ kind: 'heading', level: headingMatch[1].length, text: headingMatch[2] });
      i++;
      continue;
    }

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++; }
      blocks.push({ kind: 'code', lang, lines: codeLines });
      i++;
      continue;
    }

    // Standalone image (possibly with caption)
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

    // Blockquote
    if (line.startsWith('> ')) {
      const qLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) { qLines.push(lines[i].slice(2)); i++; }
      blocks.push({ kind: 'blockquote', lines: qLines });
      continue;
    }

    // Unordered list
    if (line.match(/^[\-\*\+]\s/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[\-\*\+]\s/)) {
        items.push(lines[i].replace(/^[\-\*\+]\s/, '')); i++;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }

    // Ordered list
    if (line.match(/^\d+\.\s/)) {
      const items: string[] = [];
      while (i < lines.length) {
        if (lines[i].match(/^\d+\.\s/)) {
          items.push(lines[i].replace(/^\d+\.\s/, ''));
          i++;
          continue;
        }
        if (lines[i].trim() === '') {
          let j = i + 1;
          while (j < lines.length && lines[j].trim() === '') j++;
          if (j < lines.length && lines[j].match(/^\d+\.\s/)) {
            i = j;
            continue;
          }
        }
        break;
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }

    // Horizontal rule
    if (line.match(/^[-*_]{3,}\s*$/)) {
      blocks.push({ kind: 'hr' });
      i++;
      continue;
    }

    // HTML block
    if (line.match(/^<[a-zA-Z]/)) {
      const htmlLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== '') { htmlLines.push(lines[i]); i++; }
      blocks.push({ kind: 'html', html: htmlLines.join('\n') });
      continue;
    }

    // Pipe line: multi-line WeChat table OR standard markdown table
    if (line.trim().startsWith('|')) {
      // Lone pipe → try WeChat multi-line table first
      if (line.trim() === '|') {
        const mlResult = tryMultilineTable(lines, i);
        if (mlResult) {
          blocks.push(mlResult.block);
          i = mlResult.nextI;
          continue;
        }
        // Lone pipe with no separator nearby: skip to avoid infinite loop
        i++;
        continue;
      }

      // Standard single-line markdown table (each row on one line)
      if (line.trim().endsWith('|')) {
        const tableLines: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
          tableLines.push(lines[i]); i++;
        }
        if (tableLines.length >= 2) {
          const parseRow = (row: string) => row.trim().slice(1, -1).split('|').map(c => c.trim());
          const header = parseRow(tableLines[0]);
          const isSep = /^\|[\s\-:|]+\|$/.test(tableLines[1].trim());
          const bodyStart = isSep ? 2 : 1;
          const rows = tableLines.slice(bodyStart).map(parseRow);
          blocks.push({ kind: 'table', header, rows });
        }
        continue;
      }

      // Starts with | but doesn't end with | — skip to avoid stall
      i++;
      continue;
    }

    // Blank line
    if (line.trim() === '') { i++; continue; }

    // Paragraph: collect consecutive non-special lines
    const paraLines: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === '' || l.match(/^#{1,6}\s/) || l.startsWith('```') ||
          l.startsWith('> ') || l.match(/^[\-\*\+]\s/) || l.match(/^\d+\.\s/) ||
          l.match(/^[-*_]{3,}\s*$/) || (l.trim().startsWith('|') && l.trim().endsWith('|')) ||
          l.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)) break;
      paraLines.push(l);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ kind: 'paragraph', lines: paraLines });
    } else {
      i++; // safety: prevent infinite loop if no handler matched and no lines were collected
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Inline markdown parser
// ---------------------------------------------------------------------------
function normalizeCitations(text: string) {
  return String(text || '')
    .replace(/\[资料(\d+)\s*-\s*(\d+)\]/g, (_match, start, end) => {
      const from = Number(start);
      const to = Number(end);
      if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || to - from > 20) return '';
      return Array.from({ length: to - from + 1 }, (_v, index) => `[资料${from + index}]`).join('');
    })
    .replace(/\[资料(\d+)(?!\])/g, (_match, n) => `[资料${n}]`);
}

function parseInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const normalized = normalizeCitations(text);
  const pattern = /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[资料(\d+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = pattern.exec(normalized)) !== null) {
    if (m.index > last) nodes.push(normalized.slice(last, m.index));
    if (m[1] !== undefined) {
      nodes.push(<img key={`${keyBase}-img-${idx++}`} src={proxyImg(m[2].trim())} alt={m[1].trim()}
        className="max-w-full rounded my-1 block" loading="lazy"
        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />);
    } else if (m[3] !== undefined) {
      nodes.push(<a key={`${keyBase}-a-${idx++}`} href={m[4]} target="_blank" rel="noopener noreferrer"
        className="text-indigo-600 dark:text-indigo-400 underline underline-offset-2 break-all">{m[3]}</a>);
    } else if (m[5] !== undefined) {
      nodes.push(<code key={`${keyBase}-c-${idx++}`}
        className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-[0.85em] font-mono">{m[5]}</code>);
    } else if (m[6] !== undefined) {
      nodes.push(<strong key={`${keyBase}-b-${idx++}`}>{m[6]}</strong>);
    } else if (m[7] !== undefined) {
      nodes.push(<em key={`${keyBase}-i-${idx++}`}>{m[7]}</em>);
    } else if (m[8] !== undefined) {
      nodes.push(<span key={`${keyBase}-ref-${idx++}`}
        className="inline-flex items-center rounded bg-indigo-50 dark:bg-indigo-950 px-1.5 py-0.5 text-[0.85em] font-medium text-indigo-600 dark:text-indigo-300">
        资料{m[8]}
      </span>);
    }
    last = m.index + m[0].length;
  }
  if (last < normalized.length) nodes.push(normalized.slice(last));
  return nodes;
}

// ---------------------------------------------------------------------------
// Render a single block — called ONCE per block, result stored in cache
// ---------------------------------------------------------------------------
function renderBlock(block: Block, key: number): ReactNode {
  const k = String(key);
  switch (block.kind) {
    case 'heading': {
      const cls = block.level === 1 ? 'text-lg font-bold mt-3 mb-1' :
        block.level === 2 ? 'text-base font-bold mt-2 mb-1' : 'text-sm font-semibold mt-2 mb-0.5';
      return <div key={key} className={cls}>{parseInline(block.text, k)}</div>;
    }
    case 'code':
      return (
        <pre key={key} className="bg-gray-100 dark:bg-gray-800 rounded p-3 my-2 overflow-x-auto text-xs font-mono whitespace-pre">
          {block.lang && <span className="text-gray-400 text-[10px] block mb-1">{block.lang}</span>}
          {block.lines.join('\n')}
        </pre>
      );
    case 'image':
      return (
        <div key={key} className="flex flex-col items-center my-3">
          <img src={block.url} alt={block.alt}
            className="max-w-full rounded shadow-sm" loading="lazy"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          {block.description && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 italic text-center max-w-[90%]">
              图片描述：{block.description}
            </p>
          )}
        </div>
      );
    case 'blockquote':
      return (
        <blockquote key={key} className="border-l-4 border-gray-300 dark:border-gray-600 pl-3 my-1.5 text-gray-500 dark:text-gray-400 italic text-sm">
          {block.lines.join(' ')}
        </blockquote>
      );
    case 'ul':
      return (
        <ul key={key} className="list-disc list-inside my-1.5 space-y-0.5">
          {block.items.map((item, j) => <li key={j} className="text-sm">{parseInline(item, `ul-${k}-${j}`)}</li>)}
        </ul>
      );
    case 'ol':
      return (
        <ol key={key} className="list-decimal list-inside my-1.5 space-y-0.5">
          {block.items.map((item, j) => <li key={j} className="text-sm">{parseInline(item, `ol-${k}-${j}`)}</li>)}
        </ol>
      );
    case 'hr':
      return <hr key={key} className="my-3 border-gray-200 dark:border-gray-700" />;
    case 'html':
      return (
        <div key={key} className="my-2 overflow-x-auto [&_table]:w-full [&_table]:text-sm [&_table]:border-collapse [&_td]:px-3 [&_td]:py-2 [&_td]:border [&_td]:border-gray-200 dark:[&_td]:border-gray-700 [&_th]:px-3 [&_th]:py-2 [&_th]:border [&_th]:border-gray-200 [&_th]:bg-gray-50 [&_th]:font-semibold dark:[&_th]:border-gray-700 dark:[&_th]:bg-gray-800"
          dangerouslySetInnerHTML={{ __html: block.html }} />
      );
    case 'table':
      return (
        <div key={key} className="my-2 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800">
                {block.header.map((cell, ci) => (
                  <th key={ci} className="px-3 py-2 text-left font-semibold text-xs text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
                    {parseInline(cell, `th-${k}-${ci}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50/50 dark:bg-gray-800/50'}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 border-b border-gray-100 dark:border-gray-800">
                      {parseInline(cell, `td-${k}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'paragraph':
      return (
        <p key={key} className="text-sm leading-relaxed my-1 break-words">
          {parseInline(block.lines.join('\n'), `p-${k}`)}
        </p>
      );
  }
}

// ---------------------------------------------------------------------------
// How many blocks to add per animation frame
// ---------------------------------------------------------------------------
const BATCH_SIZE = 80;

export default function MarkdownRenderer({ content, className = '', maxLines = 0 }: Props) {
  // Parse all blocks once (cheap string ops, memoized)
  const blocks = useMemo(() => parseBlocks(content), [content]);

  // For truncated preview (maxLines > 0): render all blocks immediately,
  // CSS clip handles display. Content is always small in preview context.
  const previewNodes = useMemo(
    () => maxLines > 0 ? blocks.map((b, i) => renderBlock(b, i)) : null,
    [blocks, maxLines]
  );

  // For full view: accumulate rendered nodes progressively.
  // Each block is rendered ONCE and stored — never re-rendered on subsequent steps.
  const [nodeCache, setNodeCache] = useState<ReactNode[]>([]);

  // Reset cache when content changes
  const prevContent = useRef(content);
  useEffect(() => {
    if (prevContent.current !== content) {
      prevContent.current = content;
      setNodeCache([]);
    }
  }, [content]);

  // Progressive rendering: append one batch per animation frame
  useEffect(() => {
    if (maxLines > 0) return;
    if (nodeCache.length >= blocks.length) return;

    const startIdx = nodeCache.length; // captured from this render

    const appendBatch = () => {
      const endIdx = Math.min(startIdx + BATCH_SIZE, blocks.length);
      const newNodes = blocks.slice(startIdx, endIdx).map((b, i) => renderBlock(b, startIdx + i));
      setNodeCache(prev => {
        // Guard: only append if no reset happened between scheduling and execution
        if (prev.length !== startIdx) return prev;
        return [...prev, ...newNodes];
      });
    };

    if (startIdx === 0) {
      // First batch: run immediately so content appears without rAF delay
      appendBatch();
      return;
    }

    // Subsequent batches: yield to browser between frames
    const id = requestAnimationFrame(appendBatch);
    return () => cancelAnimationFrame(id);
  }, [nodeCache.length, blocks, maxLines]);

  const isLoading = maxLines === 0 && nodeCache.length < blocks.length;

  const style = maxLines > 0 ? {
    display: '-webkit-box',
    WebkitLineClamp: maxLines,
    WebkitBoxOrient: 'vertical' as const,
    overflow: 'hidden',
  } : {};

  return (
    <div className={`markdown-body text-gray-700 dark:text-gray-300 break-words min-w-0 ${className}`} style={style}>
      {maxLines > 0 ? previewNodes : nodeCache}
      {isLoading && (
        <div className="flex items-center gap-2 py-3 text-xs text-gray-400 dark:text-gray-600">
          <div className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
          <span>加载中… {nodeCache.length} / {blocks.length} 段</span>
        </div>
      )}
    </div>
  );
}
