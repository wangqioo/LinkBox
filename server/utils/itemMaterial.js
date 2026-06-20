export function materialForItem(item = {}) {
  const content = item.item_content || {};
  const textContent = item.content || content.text_content || '';
  const extractedMarkdown = item.content_md || content.extracted_markdown || '';
  const summary = item.summary || content.summary || '';
  const htmlNote = item.html_note || content.html_note || '';
  const primaryAssetUrl = item.image_path || item.thumbnail || '';
  const thumbnailUrl = item.thumbnail || item.image_path || '';

  return {
    textContent,
    extractedMarkdown,
    summary,
    htmlNote,
    primaryAssetUrl,
    thumbnailUrl,
    hasExtractedMarkdown: Boolean(String(extractedMarkdown || '').trim()),
    hasHtmlNote: Boolean(String(htmlNote || '').trim()),
  };
}

export function attachItemMaterial(item = {}) {
  return {
    ...item,
    material: materialForItem(item),
  };
}
