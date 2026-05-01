export type ProjectStatus = 'Draft' | 'Formatting' | 'Review Required' | 'Completed';

export interface Project {
  id: string;
  user_id: string;
  title: string;
  author_name: string;
  genre: string;
  status: ProjectStatus;
  attention_required: boolean;
  word_count: number;
  created_at: string;
  updated_at: string;
}

export interface DocumentInfo {
  id: string;
  project_id: string;
  original_filename: string;
  storage_path: string;
  chapter_count: number;
}
