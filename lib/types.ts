/** Domain types mirror docs/topic_schema.json without adding parser metadata. */
export type Source = "chatgpt" | "claude" | "other";
export type Category = "school" | "personal" | "work" | "career" | "other";
export type Progress = "in_progress" | "stalled" | "done" | "idea_only" | "unknown";
export type LastTouched = "recent_2w" | "recent_1m" | "older" | "unknown";
export type SuggestedState = "active" | "later" | "remove";

export interface Profile {
  summary: string;
  roles: string[];
  interests: string[];
  current_focus: string[];
  tools: string[];
  work_style: string | null;
}

export interface Topic {
  id: string;
  name: string;
  one_liner: string;
  theme: string;
  category: Category;
  progress: Progress;
  last_touched: LastTouched;
  goal: string | null;
  status_text: string | null;
  outputs: string[];
  recent_decisions: string[];
  blockers: string | null;
  next_steps: string[];
  deadline: string | null;
  deadline_label: string | null;
  deadline_text: string | null;
  collaborators: string[];
  related: string[];
  sources: Source[];
  merged_from: string[];
  suggested_state: SuggestedState;
  suggested_reason: string;
}

/** This is the object validated by topic_schema.json. */
export interface ExportData {
  profile: Profile;
  themes: string[];
  topics: Topic[];
}

export interface ParseQuality {
  ok: boolean;
  projects: number;
  recognized: number;
  ratio: number;
}

/** quality is local parsing metadata, not part of the export schema. */
export interface ParseResult extends ExportData {
  quality: ParseQuality;
}

export interface ParseOptions {
  source?: Source;
  today?: string;
}
