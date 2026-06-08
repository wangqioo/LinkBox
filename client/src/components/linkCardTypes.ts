export interface Tag {
  id: number;
  name: string;
  color: string;
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
}

export interface LinkCardProps {
  link: LinkItem;
  allTags: Tag[];
  onUpdate: (id: number, data: Record<string, any>) => void;
  onDelete: (id: number) => void;
  onSummarize?: (id: number) => Promise<void>;
  onExtract?: (id: number) => Promise<void>;
  onNoteUpdated?: (id: number, html: string) => void;
  isProcessing?: boolean;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: number) => void;
}
