import { FileText, Image, Link2, Mic, Paperclip, Video } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ContentType } from './addLinkModalTypes';

export type ItemType = 'link' | 'article' | 'video' | 'image' | 'text' | 'audio' | 'file' | 'document' | string;

const ITEM_TYPE_LABELS: Record<string, string> = {
  link: '链接',
  article: '文章',
  video: '视频',
  image: '图片',
  text: '笔记',
  audio: '录音',
  file: '文件',
  document: '文件',
};

const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  link: '链接',
  video: '视频',
  image: '图片',
  text: '文字',
  audio: '录音',
  file: '文件',
};

const CONTENT_TYPE_ICONS: Record<ContentType, LucideIcon> = {
  link: Link2,
  video: Video,
  image: Image,
  text: FileText,
  audio: Mic,
  file: Paperclip,
};

export function getItemTypeLabel(itemType: ItemType) {
  return ITEM_TYPE_LABELS[itemType] || '';
}

export function getContentTypeLabel(contentType: ContentType) {
  return CONTENT_TYPE_LABELS[contentType];
}

export function isLinkLikeItemType(itemType: ItemType) {
  return itemType === 'link' || itemType === 'article' || itemType === 'video';
}

export const ADD_ITEM_TABS: { key: ContentType; label: string; icon: LucideIcon }[] = (
  ['link', 'video', 'image', 'text', 'audio', 'file'] as ContentType[]
).map(key => ({ key, label: getContentTypeLabel(key), icon: CONTENT_TYPE_ICONS[key] }));

export const ITEM_TYPE_FILTERS: { key: string; label: string; icon: LucideIcon | null }[] = [
  { key: '', label: '全部', icon: null },
  ...ADD_ITEM_TABS.map(tab => ({ key: tab.key, label: tab.label, icon: tab.icon })),
];
