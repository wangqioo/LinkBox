import { useMemo, useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { parseBlocks, parseInlineTokens } from './markdownParser';
import type { MarkdownBlock, MarkdownInline } from './markdownParser';

interface Props {
  content: string;
  className?: string;
  maxLines?: number;
}

function renderInlineToken(token: MarkdownInline, key: string): ReactNode {
  switch (token.kind) {
    case 'text':
      return token.text;
    case 'image':
      return <img key={key} src={token.url} alt={token.alt}
        className="max-w-full rounded my-1 block" loading="lazy"
        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />;
    case 'link':
      return <a key={key} href={token.href} target="_blank" rel="noopener noreferrer"
        className="text-indigo-600 dark:text-indigo-400 underline underline-offset-2 break-all">{token.text}</a>;
    case 'code':
      return <code key={key}
        className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-[0.85em] font-mono">{token.text}</code>;
    case 'strong':
      return <strong key={key}>{token.text}</strong>;
    case 'em':
      return <em key={key}>{token.text}</em>;
    case 'citation':
      return <span key={key}
        className="inline-flex items-center rounded bg-indigo-50 dark:bg-indigo-950 px-1.5 py-0.5 text-[0.85em] font-medium text-indigo-600 dark:text-indigo-300">
        资料{token.number}
      </span>;
  }
}

function parseInline(text: string, keyBase: string): ReactNode[] {
  return parseInlineTokens(text).map((token, index) => renderInlineToken(token, `${keyBase}-${token.kind}-${index}`));
}

// ---------------------------------------------------------------------------
// Render a single block — called ONCE per block, result stored in cache
// ---------------------------------------------------------------------------
function renderBlock(block: MarkdownBlock, key: number): ReactNode {
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
        <ol key={key} start={block.start} className="list-decimal list-inside my-1.5 space-y-0.5">
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
