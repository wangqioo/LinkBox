export interface LinkPageTag {
  id: number;
  name: string;
  color: string;
  link_count: number;
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
  imported_at: string;
  tags: LinkPageTag[];
  status?: string;
  content_md?: string;
  html_note?: string;
}
