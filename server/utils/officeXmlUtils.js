import { decodeXmlEntities } from './fileMarkdownUtils.js';

export function parseXmlAttributes(tag) {
  const attrs = {};
  const attrRegex = /([\w:-]+)="([^"]*)"/g;
  let match;
  while ((match = attrRegex.exec(tag)) !== null) {
    attrs[match[1]] = decodeXmlEntities(match[2]);
  }
  return attrs;
}

export function parseRelationshipsByTypeSuffix(relsXml, typeSuffix) {
  const relationships = {};
  const relationshipRegex = /<Relationship\b[^>]*\/?>/g;
  let match;

  while ((match = relationshipRegex.exec(relsXml)) !== null) {
    const attrs = parseXmlAttributes(match[0]);
    if (attrs.Id && attrs.Target && attrs.Type?.endsWith(typeSuffix)) {
      relationships[attrs.Id] = attrs.Target;
    }
  }

  return relationships;
}

export function parseImageRelationships(relsXml) {
  return parseRelationshipsByTypeSuffix(relsXml, '/image');
}

export function extractDrawingEmbedRefs(fragment) {
  const refs = [];
  const blipRegex = /<a:blip\b[^>]*>/g;
  let match;

  while ((match = blipRegex.exec(fragment)) !== null) {
    const attrs = parseXmlAttributes(match[0]);
    if (attrs['r:embed']) refs.push(attrs['r:embed']);
  }

  return refs;
}

export function extractWordText(fragment) {
  const texts = [];
  const textRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  let match;

  while ((match = textRegex.exec(fragment)) !== null) {
    texts.push(match[1]);
  }

  return decodeXmlEntities(texts.join(''));
}

export function markdownTable(rows) {
  if (!rows.length) return '';

  const maxCols = Math.max(...rows.map(row => row.length));
  const padded = rows.map(row => [...row, ...Array(Math.max(0, maxCols - row.length)).fill('')]);
  const header = '| ' + padded[0].join(' | ') + ' |';
  const separator = '| ' + padded[0].map(() => '---').join(' | ') + ' |';
  const body = padded.slice(1).map(row => '| ' + row.join(' | ') + ' |').join('\n');

  return header + '\n' + separator + (body ? '\n' + body : '');
}

export function wordTableToMarkdown(tblXml) {
  const rows = [];
  const rowRegex = /<w:tr[\s>][\s\S]*?<\/w:tr>/g;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(tblXml)) !== null) {
    const cells = [];
    const cellRegex = /<w:tc[\s>][\s\S]*?<\/w:tc>/g;
    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowMatch[0])) !== null) {
      const paras = cellMatch[0].split(/<\/w:p>/);
      const cellTexts = paras.map(paragraph => extractWordText(paragraph).trim()).filter(Boolean);
      cells.push(cellTexts.join(' '));
    }

    if (cells.length) rows.push(cells);
  }

  return markdownTable(rows);
}
