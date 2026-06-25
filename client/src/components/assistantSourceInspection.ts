import type { AssistantRetrievalMetadata } from '../api/client';

export interface AssistantInspectionRow {
  label: string;
  value: string;
}

export function formatAssistantScore(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '';
  return value.toFixed(3);
}

export function formatAssistantHeadingPath(value: unknown) {
  if (Array.isArray(value)) return value.filter(Boolean).join(' > ');
  return typeof value === 'string' ? value : '';
}

export function assistantSourceInspectionRows(retrieval?: AssistantRetrievalMetadata | null): AssistantInspectionRow[] {
  if (!retrieval) return [];

  const rows: AssistantInspectionRow[] = [];
  if (retrieval.sourceKind) rows.push({ label: '来源', value: retrieval.sourceKind });
  if (Array.isArray(retrieval.retrieval_modes) && retrieval.retrieval_modes.length) {
    rows.push({ label: '命中', value: retrieval.retrieval_modes.join(' + ') });
  }
  const headingPath = formatAssistantHeadingPath(retrieval.heading_path);
  if (headingPath) rows.push({ label: '章节', value: headingPath });
  const score = formatAssistantScore(retrieval.score);
  if (score) rows.push({ label: '分数', value: score });
  const combined = formatAssistantScore(retrieval.combined_score);
  if (combined) rows.push({ label: '综合', value: combined });
  const embedding = formatAssistantScore(retrieval.embedding_score);
  if (embedding) rows.push({ label: '语义', value: embedding });
  if (retrieval.rerank_mode) {
    const rerankScore = formatAssistantScore(retrieval.rerank_score);
    rows.push({
      label: '重排',
      value: rerankScore ? `${retrieval.rerank_mode} ${rerankScore}` : retrieval.rerank_mode,
    });
  }
  if (retrieval.chunk_type) rows.push({ label: '切块', value: retrieval.chunk_type });

  return rows;
}
