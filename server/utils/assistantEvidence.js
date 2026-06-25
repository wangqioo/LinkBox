function snippetForSource(source) {
  return String(source.chunk_text || source.summary || source.content_md || source.content || source.description || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function retrievalModes(source) {
  if (Array.isArray(source.retrieval_modes)) return source.retrieval_modes;
  return source.retrieval_mode ? [source.retrieval_mode] : [];
}

function supportReasonForSource(source) {
  const modes = retrievalModes(source);
  const pieces = [];
  if (modes.length) pieces.push(`matched by ${modes.join(', ')}`);
  if (source.heading_path) pieces.push(`in ${source.heading_path}`);
  if (!pieces.length && source.sourceKind) pieces.push(`from ${source.sourceKind}`);
  return pieces.join(' ') || 'retrieved as relevant context';
}

export function buildEvidenceNotebook(sources = []) {
  const items = sources.map((source, index) => {
    const sourceIndex = Number(source.source_index || index + 1);
    return {
      citation: `[资料${sourceIndex}]`,
      sourceId: source.link_id || source.item_id || source.id,
      title: source.title || source.url || `资料 ${source.link_id || source.item_id || source.id}`,
      url: source.url || '',
      sourceKind: source.sourceKind || source.source_kind || (source.document_id ? 'document' : 'legacy'),
      retrievalModes: retrievalModes(source),
      score: Number(source.score ?? source.combined_score ?? 0),
      headingPath: source.heading_path || '',
      snippet: snippetForSource(source),
      importedAt: source.imported_at,
      supportReason: supportReasonForSource(source),
    };
  }).filter(item => item.snippet || item.title);

  return {
    status: items.length ? 'ready' : 'empty',
    items,
  };
}

export function evidenceSupportStatus(notebook) {
  if (!notebook?.items?.length) return 'insufficient';
  return notebook.items.some(item => item.snippet) ? 'supported' : 'partial';
}
