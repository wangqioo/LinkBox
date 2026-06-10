import { api, type UploadProgress } from '../api/client';
import { useToast } from '../context/ToastContext';
import type { LinkPageItem } from './linksPageTypes';

interface UseLinkActionsOptions {
  fetchLinks: () => Promise<void>;
  fetchTags: () => Promise<void>;
  mergeLink: (id: number, patch: Partial<LinkPageItem>) => void;
  startPolling: (id: number) => void;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return '请稍后重试';
}

export function useLinkActions({
  fetchLinks,
  fetchTags,
  mergeLink,
  startPolling,
}: UseLinkActionsOptions) {
  const toast = useToast();

  const refreshLinksAndTags = async () => {
    await fetchLinks();
    await fetchTags();
  };

  const handleAddLink = async (data: any) => {
    try {
      const added = await api.addLink(data);
      await refreshLinksAndTags();
      if (added?.id) startPolling(added.id);
      toast.success('链接已添加', '后台正在提取正文和生成摘要');
    } catch (error) {
      toast.error('添加链接失败', getErrorMessage(error));
      throw error;
    }
  };

  const handleAddText = async (data: any) => {
    try {
      await api.addText(data);
      await refreshLinksAndTags();
      toast.success('笔记已保存');
    } catch (error) {
      toast.error('保存笔记失败', getErrorMessage(error));
      throw error;
    }
  };

  const handleAddImage = async (formData: FormData, onProgress?: (p: UploadProgress) => void) => {
    try {
      await api.addImage(formData, onProgress);
      await refreshLinksAndTags();
      toast.success('图片已保存');
    } catch (error) {
      toast.error('上传图片失败', getErrorMessage(error));
      throw error;
    }
  };

  const handleAddAudio = async (formData: FormData, onProgress?: (p: UploadProgress) => void) => {
    try {
      await api.addAudio(formData, onProgress);
      await refreshLinksAndTags();
      toast.success('录音已保存');
    } catch (error) {
      toast.error('上传录音失败', getErrorMessage(error));
      throw error;
    }
  };

  const handleAddFile = async (formData: FormData, onProgress?: (p: UploadProgress) => void) => {
    try {
      const added = await api.addFile(formData, onProgress);
      await refreshLinksAndTags();
      if (added?.id) startPolling(added.id);
      toast.success('文件已添加', '后台正在解析文件内容');
    } catch (error) {
      toast.error('上传文件失败', getErrorMessage(error));
      throw error;
    }
  };

  const handleUpdate = async (id: number, data: Record<string, any>) => {
    try {
      await api.updateLink(id, data);
      await refreshLinksAndTags();
      toast.success('收藏已更新');
    } catch (error) {
      toast.error('更新收藏失败', getErrorMessage(error));
      throw error;
    }
  };

  const handleSummarize = async (id: number) => {
    try {
      const updated = await api.summarizeLink(id);
      mergeLink(id, updated);
      toast.success('摘要已更新');
    } catch (error) {
      toast.error('生成摘要失败', getErrorMessage(error));
      throw error;
    }
  };

  const handleExtract = async (id: number) => {
    try {
      const result = await api.extractContent(id);
      mergeLink(id, { content_md: result.content_md });
      toast.success('正文已提取');
    } catch (error) {
      toast.error('提取正文失败', getErrorMessage(error));
      throw error;
    }
  };

  const handleRetryProcessing = async (id: number) => {
    try {
      const updated = await api.retryLinkProcessing(id);
      mergeLink(id, updated);
      startPolling(id);
      toast.success('已重新加入处理队列');
    } catch (error) {
      toast.error('重试处理失败', getErrorMessage(error));
      throw error;
    }
  };

  const handleNoteUpdated = (id: number, html: string) => {
    mergeLink(id, { html_note: html });
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除这条收藏？')) return;
    try {
      await api.deleteLink(id);
      await refreshLinksAndTags();
      toast.success('收藏已删除');
    } catch (error) {
      toast.error('删除收藏失败', getErrorMessage(error));
    }
  };

  const handleImport = async (items: any[]) => {
    try {
      await api.importLinks(items);
      await fetchLinks();
      toast.success('导入已完成', `已导入 ${items.length} 条链接`);
    } catch (error) {
      toast.error('导入失败', getErrorMessage(error));
      throw error;
    }
  };

  return {
    handleAddLink,
    handleAddText,
    handleAddImage,
    handleAddAudio,
    handleAddFile,
    handleUpdate,
    handleSummarize,
    handleExtract,
    handleRetryProcessing,
    handleNoteUpdated,
    handleDelete,
    handleImport,
  };
}
