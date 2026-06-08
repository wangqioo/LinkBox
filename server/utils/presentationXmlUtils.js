import { decodeXmlEntities } from './fileMarkdownUtils.js';

export function presentationParagraphLines(slideXml) {
  const paragraphs = slideXml.split(/<\/a:p>/);
  return paragraphs
    .map(paragraph => {
      const texts = [];
      const textRegex = /<a:t>([^<]*)<\/a:t>/g;
      let match;

      while ((match = textRegex.exec(paragraph)) !== null) {
        texts.push(match[1]);
      }

      return decodeXmlEntities(texts.join(''));
    })
    .filter(line => line.trim());
}

export function slideToMarkdown(slideNumber, lines, imageLines = []) {
  if (!lines.length && !imageLines.length) return '';

  const heading = `### Slide ${slideNumber}${lines.length ? ': ' + lines[0] : ''}`;
  const body = lines.slice(1).map(line => '- ' + line).join('\n');
  const imageMarkdown = imageLines.join('\n\n');

  return [heading, body, imageMarkdown].filter(Boolean).join('\n\n');
}
