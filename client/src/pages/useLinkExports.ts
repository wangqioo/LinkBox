import { api } from '../api/client';
import { useToast } from '../context/ToastContext';

interface UseLinkExportsOptions {
  showFilters: boolean;
  selectedIds: Set<number>;
  closeExportMenu: () => void;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function useLinkExports({
  showFilters,
  selectedIds,
  closeExportMenu,
}: UseLinkExportsOptions) {
  const toast = useToast();
  const selectedScope = showFilters && selectedIds.size > 0 ? selectedIds : null;
  const exportScopeText = selectedScope ? `选中 ${selectedScope.size} 条收藏` : '全部收藏';

  const handleExportJson = async () => {
    closeExportMenu();
    try {
      const data = await api.exportLinks();
      const filtered = selectedScope
        ? {
            ...data,
            links: data.links.filter((link: any) => selectedScope.has(link.id)),
            linkTags: data.linkTags.filter((linkTag: any) => selectedScope.has(linkTag.link_id)),
          }
        : data;
      downloadBlob(
        new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' }),
        `linkbox-export-${new Date().toISOString().slice(0, 10)}.json`,
      );
      toast.success('JSON 导出已生成', exportScopeText);
    } catch (error: any) {
      toast.error('JSON 导出失败', error?.message || '请稍后重试');
    }
  };

  const handleExportSummaries = async () => {
    closeExportMenu();
    try {
      const token = localStorage.getItem('linkbox_token');
      const ids = selectedScope ? Array.from(selectedScope).join(',') : '';
      const url = `/api/links/export/summaries${ids ? `?ids=${ids}` : ''}`;
      const response = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || '摘要导出失败');
      }

      const blob = await response.blob();
      downloadBlob(blob, `linkbox-summaries-${new Date().toISOString().slice(0, 10)}.md`);
      toast.success('Markdown 导出已生成', exportScopeText);
    } catch (error: any) {
      toast.error('Markdown 导出失败', error?.message || '请稍后重试');
    }
  };

  return {
    handleExportJson,
    handleExportSummaries,
  };
}
