import { decodeXmlEntities } from './fileMarkdownUtils.js';
import { markdownTable, parseXmlAttributes } from './officeXmlUtils.js';

export function parseSharedStrings(sharedStringsXml) {
  const strings = [];
  const textRegex = /<t[^>]*>([^<]*)<\/t>/g;
  let match;

  while ((match = textRegex.exec(sharedStringsXml)) !== null) {
    strings.push(decodeXmlEntities(match[1]));
  }

  return strings;
}

export function parseSheetNames(workbookXml) {
  const names = [];
  const sheetRegex = /<sheet\b[^>]*\/?>|<sheet\b[^>]*>/g;
  let match;

  while ((match = sheetRegex.exec(workbookXml)) !== null) {
    const attrs = parseXmlAttributes(match[0]);
    if (attrs.name) names.push(attrs.name);
  }

  return names;
}

export function worksheetRows(sheetXml, sharedStrings = []) {
  const rows = [];
  const rowRegex = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    const cells = [];
    const cellRegex = /<c([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      cells.push(cellValue(cellMatch[1], cellMatch[2], sharedStrings));
    }

    if (cells.some(Boolean)) rows.push(cells);
  }

  return rows;
}

export function sheetRowsToMarkdown(rows, sheetName) {
  if (!rows.length) return '';
  return '### ' + (sheetName || 'Sheet') + '\n\n' + markdownTable(rows);
}

function cellValue(attrsText, innerXml, sharedStrings) {
  const attrs = parseXmlAttributes(attrsText);

  if (attrs.t === 'inlineStr') {
    const textMatch = innerXml.match(/<t[^>]*>([^<]*)<\/t>/);
    return textMatch ? decodeXmlEntities(textMatch[1]) : '';
  }

  const valueMatch = innerXml.match(/<v>([^<]*)<\/v>/);
  if (!valueMatch) return '';

  if (attrs.t === 's') {
    return sharedStrings[parseInt(valueMatch[1], 10)] || '';
  }

  return valueMatch[1];
}
