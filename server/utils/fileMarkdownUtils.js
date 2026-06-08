export function decodeXmlEntities(str) {
  return String(str || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function formatImageBlock(url, description) {
  if (description) {
    return `![image](${url})\n\n> 图片描述：${description}`;
  }
  return `![image](${url})`;
}

export function extractHtmlText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findImagePlaceholders(markdown) {
  const placeholderRegex = /__IMG_PLACEHOLDER__([^_]+(?:_[^_]+)*)__END__/g;
  const matches = [];
  let match;
  while ((match = placeholderRegex.exec(String(markdown || ''))) !== null) {
    matches.push({ full: match[0], url: match[1] });
  }
  return matches;
}

export function replaceImagePlaceholdersWithDescriptions(markdown, descriptions) {
  let result = String(markdown || '');
  for (const match of findImagePlaceholders(result)) {
    const desc = descriptions[match.url] || '';
    result = result.replace(match.full, formatImageBlock(match.url, desc));
  }
  return result;
}
