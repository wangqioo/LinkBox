export interface Tag {
  id: number;
  name: string;
  color: string;
}

export interface ProcessingStatus {
  state: string;
  stage: string;
  label: string;
  canRetry: boolean;
  failedJobId: number | null;
  lastError: string;
  updatedAt: string;
  activeJob?: {
    id: number;
    type: string;
    label: string;
    status: string;
    attempts: number;
    maxAttempts: number;
    lastError: string;
    updatedAt: string;
  } | null;
}

export interface LinkItem {
  id: number;
  type?: string;
  url: string;
  title: string;
  description: string;
  thumbnail: string;
  comment: string;
  content?: string;
  image_path?: string;
  summary?: string;
  content_md?: string;
  html_note?: string;
  has_content_md?: number;
  has_html_note?: number;
  imported_at: string;
  tags: Tag[];
  status?: string;
  processing?: ProcessingStatus;
}

export interface LinkCardProps {
  link: LinkItem;
  allTags: Tag[];
  onUpdate: (id: number, data: Record<string, any>) => Promise<void> | void;
  onDelete: (id: number) => Promise<void> | void;
  onSummarize?: (id: number) => Promise<void>;
  onExtract?: (id: number) => Promise<void>;
  onRetryProcessing?: (id: number) => Promise<void>;
  onNoteUpdated?: (id: number, html: string) => void;
  isProcessing?: boolean;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: number) => void;
}
