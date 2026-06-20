export const ITEM_TYPE_LABELS = {
  image: '图片',
  video: '视频',
  document: '文档',
  audio: '音频',
  link: '链接',
  article: '文章',
  text: '文字',
  other: '其他',
};

export const ITEM_TYPE_ICONS = {
  image: '🖼',
  video: '🎬',
  document: '📄',
  audio: '🎵',
  link: '🔗',
  article: '📖',
  text: '💬',
  other: '📦',
};

export const ITEM_TYPE_BACKGROUNDS = {
  image: 'rgba(139,114,255,.15)',
  video: 'rgba(255,110,122,.15)',
  document: 'rgba(94,234,181,.15)',
  audio: 'rgba(255,170,92,.15)',
  link: 'rgba(100,170,255,.15)',
  article: 'rgba(100,170,255,.15)',
  text: 'rgba(139,114,255,.15)',
  other: 'rgba(255,255,255,.08)',
};

export const ITEM_ICON_BACKGROUND_CLASSES = {
  image: 'ico-purple',
  video: 'ico-red',
  document: 'ico-teal',
  audio: 'ico-orange',
  link: 'ico-blue',
  article: 'ico-blue',
  other: 'ico-gray',
};

export function fileLabel(type) {
  return ITEM_TYPE_LABELS[type] || ITEM_TYPE_LABELS.other;
}

export function fileIcon(type) {
  return ITEM_TYPE_ICONS[type] || ITEM_TYPE_ICONS.other;
}

export function fileTypeBackground(type) {
  return ITEM_TYPE_BACKGROUNDS[type] || ITEM_TYPE_BACKGROUNDS.other;
}

export function iconBackgroundClass(type) {
  return ITEM_ICON_BACKGROUND_CLASSES[type] || ITEM_ICON_BACKGROUND_CLASSES.other;
}

export function isLinkLikeType(type) {
  return ['link', 'article', 'video'].includes(type);
}

export function commentPreviewText(comment) {
  return String(comment || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');
}

export function shouldCloseCommentSheet({ saving = false, force = false } = {}) {
  return Boolean(force) || !saving;
}
