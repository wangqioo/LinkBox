export interface LinkPageTag {
  id: number;
  name: string;
  color: string;
  link_count: number;
}

export interface LinkPageProcessingStatus {
  state: string;
  stage: string;
  label: string;
  canRetry: boolean;
  failedJobId: number | null;
  lastError: string;
  updatedAt: string;
}

export interface LinkPageItem {
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
  imported_at: string;
  tags: LinkPageTag[];
  status?: string;
  content_md?: string;
  html_note?: string;
  has_content_md?: number;
  has_html_note?: number;
  processing?: LinkPageProcessingStatus;
}
