import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { LinkPageItem, LinkPageTag } from './linksPageTypes';
import { buildLinkQueryParams, isItemProcessing, isItemSettled, sortLikeMobile } from './linksPageUtils';

interface UseLinksDataOptions {
  pageSize: number;
  search: string;
  activeTag: string;
  activeType: string;
  dateFrom: string;
  dateTo: string;
}

export function useLinksData({
  pageSize,
  search,
  activeTag,
  activeType,
  dateFrom,
  dateTo,
}: UseLinksDataOptions) {
  const [links, setLinks] = useState<LinkPageItem[]>([]);
  const [tags, setTags] = useState<LinkPageTag[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [processingIds, setProcessingIds] = useState<Set<number>>(new Set());

  const fetchLinks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getLinks(buildLinkQueryParams({
        page,
        pageSize,
        search,
        activeTag,
        activeType,
        dateFrom,
        dateTo,
      }));
      setLinks([...data.links].sort(sortLikeMobile));
      setTotal(data.total);
    } catch {
      // Keep the existing page-level behavior: transient list failures do not break the view.
    } finally {
      setLoading(false);
    }
  }, [activeTag, activeType, dateFrom, dateTo, page, pageSize, search]);

  const fetchTags = useCallback(async () => {
    try {
      setTags(await api.getTags());
    } catch {
      // Tags are secondary metadata; keep the content list usable if loading fails.
    }
  }, []);

  const mergeLink = useCallback((id: number, patch: Partial<LinkPageItem>) => {
    setLinks(prev => prev.map(link => link.id === id ? { ...link, ...patch } : link));
  }, []);

  const startPolling = useCallback((id: number) => {
    setProcessingIds(prev => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });

    const interval = window.setInterval(async () => {
      try {
        const updated = await api.getLink(id);
        setLinks(prev => prev.map(link => link.id === id ? { ...link, ...updated } : link));
        if (isItemSettled(updated)) {
          window.clearInterval(interval);
          setProcessingIds(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }
      } catch {
        // Keep polling; transient network failures are common on local devices.
      }
    }, 3000);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [activeTag, activeType, dateFrom, dateTo, search]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  useEffect(() => {
    links.forEach(link => {
      if (isItemProcessing(link) && !processingIds.has(link.id)) {
        startPolling(link.id);
      }
    });
  }, [links, processingIds, startPolling]);

  return {
    links,
    tags,
    total,
    page,
    setPage,
    loading,
    processingIds,
    mergeLink,
    fetchLinks,
    fetchTags,
    startPolling,
  };
}
