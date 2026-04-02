import { Fragment } from 'react';


const proxyImg = (url: string) => {
  const u = url.trim();
  return u.startsWith('http') ? '/api/links/image-proxy?url=' + encodeURIComponent(u) : u;
};

interface Props {
  content: string;
  className?: string;
  maxLines?: number;
}

function parseInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
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
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export default function MarkdownRenderer({ content, className = '', maxLines = 0 }: Props) {
  const lines = content.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const cls = level === 1 ? 'text-lg font-bold mt-3 mb-1' :
        level === 2 ? 'text-base font-bold mt-2 mb-1' : 'text-sm font-semibold mt-2 mb-0.5';
      nodes.push(<div key={key++} className={cls}>{parseInline(headingMatch[2], String(key))}</div>);
      i++;
      continue;
    }

    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++; }
      nodes.push(
        <pre key={key++} className="bg-gray-100 dark:bg-gray-800 rounded p-3 my-2 overflow-x-auto text-xs font-mono whitespace-pre">
          {lang && <span className="text-gray-400 text-[10px] block mb-1">{lang}</span>}
          {codeLines.join('\n')}
        </pre>
      );
      i++;
      continue;
    }

    // Image + description block: ![...](url) followed by > 图片描述：...
    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      const imgUrl = proxyImg(imgMatch[2].trim());
      const imgAlt = imgMatch[1].trim();
      // Look ahead for a description blockquote after optional blank lines
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      const descLine = j < lines.length ? lines[j] : '';
      const descMatch = descLine.match(/^>\s*图片描述[：:]\s*(.*)/);

      if (descMatch) {
        // Collect multi-line description
        const descParts = [descMatch[1]];
        let k = j + 1;
        while (k < lines.length && lines[k].startsWith('> ')) {
          descParts.push(lines[k].slice(2));
          k++;
        }
        const description = descParts.join(' ').trim();

        nodes.push(
          <div key={key++} className="flex flex-col items-center my-3">
            <img src={imgUrl} alt={imgAlt}
              className="max-w-full rounded shadow-sm" loading="lazy"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 italic text-center max-w-[90%]">
              图片描述：{description}
            </p>
          </div>
        );
        i = k;
        continue;
      } else {
        // Standalone image without description - render centered
        nodes.push(
          <div key={key++} className="flex flex-col items-center my-3">
            <img src={imgUrl} alt={imgAlt}
              className="max-w-full rounded shadow-sm" loading="lazy"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          </div>
        );
        i++;
        continue;
      }
    }

    if (line.startsWith('> ')) {
      const qLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) { qLines.push(lines[i].slice(2)); i++; }
      nodes.push(
        <blockquote key={key++} className="border-l-4 border-gray-300 dark:border-gray-600 pl-3 my-1.5 text-gray-500 dark:text-gray-400 italic text-sm">
          {qLines.join(' ')}
        </blockquote>
      );
      continue;
    }

    if (line.match(/^[\-\*\+]\s/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[\-\*\+]\s/)) {
        items.push(lines[i].replace(/^[\-\*\+]\s/, '')); i++;
      }
      nodes.push(
        <ul key={key++} className="list-disc list-inside my-1.5 space-y-0.5">
          {items.map((item, j) => <li key={j} className="text-sm">{parseInline(item, `ul-${key}-${j}`)}</li>)}
        </ul>
      );
      continue;
    }

    if (line.match(/^\d+\.\s/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
        items.push(lines[i].replace(/^\d+\.\s/, '')); i++;
      }
      nodes.push(
        <ol key={key++} className="list-decimal list-inside my-1.5 space-y-0.5">
          {items.map((item, j) => <li key={j} className="text-sm">{parseInline(item, `ol-${key}-${j}`)}</li>)}
        </ol>
      );
      continue;
    }

    if (line.match(/^[-*_]{3,}\s*$/)) {
      nodes.push(<hr key={key++} className="my-3 border-gray-200 dark:border-gray-700" />);
      i++;
      continue;
    }

    // Markdown table: consecutive lines starting and ending with |
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      if (tableLines.length >= 2) {
        const parseRow = (row: string) =>
          row.trim().slice(1, -1).split('|').map(c => c.trim());
        const headerCells = parseRow(tableLines[0]);
        // Check if second line is separator (| --- | --- |)
        const isSep = /^\|[\s\-:|]+\|$/.test(tableLines[1].trim());
        const bodyStart = isSep ? 2 : 1;
        const bodyRows = tableLines.slice(bodyStart).map(parseRow);

        nodes.push(
          <div key={key++} className="my-2 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800">
                  {headerCells.map((cell, ci) => (
                    <th key={ci} className="px-3 py-2 text-left font-semibold text-xs text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
                      {parseInline(cell, `th-${key}-${ci}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyRows.map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50/50 dark:bg-gray-800/50'}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 border-b border-gray-100 dark:border-gray-800">
                        {parseInline(cell, `td-${key}-${ri}-${ci}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }
      // Less than 2 lines - rewind and treat as paragraph
      i -= tableLines.length;
    }

    if (line.trim() === '') { i++; continue; }

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
      nodes.push(
        <p key={key++} className="text-sm leading-relaxed my-1">
          {parseInline(paraLines.join('\n'), `p-${key}`)}
        </p>
      );
    }
  }

  const style = maxLines > 0 ? {
    display: '-webkit-box',
    WebkitLineClamp: maxLines,
    WebkitBoxOrient: 'vertical' as const,
    overflow: 'hidden',
  } : {};

  return (
    <div className={`markdown-body text-gray-700 dark:text-gray-300 ${className}`} style={style}>
      {nodes}
    </div>
  );
}
