import type { LinkPageItem } from './linksPageTypes';

export function sortLikeMobile(a: LinkPageItem, b: LinkPageItem) {
  return b.id - a.id;
}

export function isItemProcessing(item: LinkPageItem) {
  return item.status === 'processing' || ['queued', 'running', 'processing'].includes(item.processing?.state || '');
}

export function isItemSettled(item: LinkPageItem) {
  return ['done', 'error'].includes(item.status || '') || ['done', 'failed'].includes(item.processing?.state || '');
}

export function buildLinkQueryParams({
  page,
  pageSize,
  search,
  activeTag,
  activeType,
  dateFrom,
  dateTo,
}: {
  page: number;
  pageSize: number;
  search: string;
  activeTag: string;
  activeType: string;
  dateFrom: string;
  dateTo: string;
}) {
  const params: Record<string, string> = { page: String(page), limit: String(pageSize) };
  if (search) params.search = search;
  if (activeTag) params.tag = activeTag;
  if (activeType) params.type = activeType;
  if (dateFrom) params.from = dateFrom;
  if (dateTo) params.to = dateTo;
  return params;
}
