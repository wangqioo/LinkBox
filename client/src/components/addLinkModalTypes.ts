import type { UploadProgress } from '../api/client';

export interface Tag {
  id: number;
  name: string;
  color: string;
}

export type ContentType = 'link' | 'image' | 'text' | 'audio' | 'file';

export interface AddLinkModalProps {
  open: boolean;
  tags: Tag[];
  onClose: () => void;
  onAddLink: (data: { url: string; comment?: string; tag_ids?: number[]; imported_at?: string }) => Promise<void>;
  onAddText: (data: { title: string; content: string; comment?: string; tag_ids?: number[]; imported_at?: string }) => Promise<void>;
  onAddImage: (formData: FormData, onProgress?: (p: UploadProgress) => void) => Promise<void>;
  onAddAudio: (formData: FormData, onProgress?: (p: UploadProgress) => void) => Promise<void>;
  onAddFile: (formData: FormData, onProgress?: (p: UploadProgress) => void) => Promise<void>;
}
