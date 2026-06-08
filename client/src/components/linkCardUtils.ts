export const proxyImage = (url: string) => {
  if (!url || url.startsWith('/')) return url;
  return '/api/links/image-proxy?url=' + encodeURIComponent(url);
};

export const getLinkDomain = (url: string) => {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return '';
  }
};

export const formatLinkDate = (date: string) => {
  try {
    return new Date(date).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return date;
  }
};

export const getItemTypeLabel = (itemType: string) => {
  if (itemType === 'image') return '图片';
  if (itemType === 'text') return '笔记';
  if (itemType === 'audio') return '录音';
  if (itemType === 'file') return '文件';
  return '';
};
