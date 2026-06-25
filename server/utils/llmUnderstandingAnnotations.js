import { createHash } from 'crypto';

export const LLM_UNDERSTANDING_PROMPT_VERSION = 'linkbox-understanding-v1';
export const LLM_UNDERSTANDING_ANNOTATION_TYPE = 'llm_understanding';

function hashText(text) {
  return createHash('sha256').update(String(text || '')).digest('hex');
}

function normalizeStringArray(value, limit = 12) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeTimeline(value, limit = 12) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => ({
      date: String(item?.date || '').trim(),
      event: String(item?.event || '').trim(),
      evidence: String(item?.evidence || '').trim(),
    }))
    .filter(item => item.date || item.event || item.evidence)
    .slice(0, limit);
}

export function buildUnderstandingAnnotationPrompt({
  title = '',
  markdown = '',
  promptVersion = LLM_UNDERSTANDING_PROMPT_VERSION,
} = {}) {
  const clippedMarkdown = String(markdown || '').slice(0, 12000);
  return [
    `Prompt version: ${promptVersion}`,
    'You are enriching a LinkBox canonical Markdown document.',
    'Return only valid JSON with keys: questions, contradictions, timeline, project_summary.',
    'questions: string[] of useful follow-up questions.',
    'contradictions: string[] of possible conflicts or uncertainties.',
    'timeline: array of {date,event,evidence}.',
    'project_summary: short string grounded in the document.',
    '',
    `Title: ${title}`,
    '',
    'Markdown:',
    clippedMarkdown,
  ].join('\n');
}

export function parseUnderstandingAnnotationJson(text) {
  const raw = JSON.parse(String(text || '{}'));
  return {
    questions: normalizeStringArray(raw.questions),
    contradictions: normalizeStringArray(raw.contradictions),
    timeline: normalizeTimeline(raw.timeline),
    project_summary: String(raw.project_summary || '').trim(),
  };
}

export function storeUnderstandingAnnotation(db, {
  documentId,
  markdown = '',
  annotation,
  model = '',
  promptVersion = LLM_UNDERSTANDING_PROMPT_VERSION,
} = {}) {
  if (!db) throw new Error('storeUnderstandingAnnotation requires a database');
  if (!documentId) throw new Error('storeUnderstandingAnnotation requires a document id');
  const normalized = typeof annotation === 'string'
    ? parseUnderstandingAnnotationJson(annotation)
    : parseUnderstandingAnnotationJson(JSON.stringify(annotation || {}));
  const payload = {
    prompt_version: promptVersion,
    source_hash: hashText(markdown),
    annotation: normalized,
  };
  const result = db.prepare(`
    INSERT INTO document_annotations (document_id, type, content_json, model)
    VALUES (?, ?, ?, ?)
  `).run(documentId, LLM_UNDERSTANDING_ANNOTATION_TYPE, JSON.stringify(payload), model);

  return {
    id: result.lastInsertRowid,
    document_id: documentId,
    type: LLM_UNDERSTANDING_ANNOTATION_TYPE,
    content_json: JSON.stringify(payload),
    model,
  };
}
