import type { Profile } from "./types";

export type NudgeType = "continue" | "unblock" | "expand" | "new_project";

export interface CardFeedback {
  topic_id: string;
  type: NudgeType;
  title: string;
  action: string;
  result: "completed" | "dismissed" | "snoozed";
  note: string | null;
}

export interface CardTopic {
  id: string;
  name: string;
  theme: string;
  starred: boolean;
  days_left: number | null;
  deadline_label: string | null;
  deadline_text: string | null;
  goal: string | null;
  status_text: string | null;
  outputs: string[];
  recent_decisions: string[];
  blockers: string | null;
  next_steps: string[];
}

/** The exact user-message shape in docs/nudge_prompt.md §②. */
export interface CardInput {
  today: string;
  profile: Pick<Profile, "roles" | "interests" | "current_focus" | "work_style">;
  topics: CardTopic[];
  feedback: CardFeedback[];
}

export interface CardInputOptions {
  feedback?: readonly CardFeedback[];
  starredTopicIds?: readonly string[];
  /** Topics with an accepted, unfinished card are excluded by the app. */
  excludedTopicIds?: readonly string[];
}

export interface Nudge {
  id: string;
  slot: "focus" | "explore";
  topic_id: string;
  new_topic_name: string | null;
  type: NudgeType;
  title: string;
  action: string;
  est_minutes: number;
  why_now: string;
  evidence: Array<{ source: "profile" | "topic" | "feedback"; fact: string }>;
  head_start: {
    kind: "draft" | "outline" | "checklist" | "question";
    content: string;
    options: Array<{ id: string; label: string; value: string }>;
  };
  first_step: string;
}

export interface CardValidationResult {
  nudges: Nudge[];
  rejected: Array<{ id: string | null; reasons: string[] }>;
  /** Canonical response-schema result, before the app's semantic rules. */
  schemaValid: boolean;
  /** Only a nonempty candidate set that was entirely discarded gets a retry. */
  shouldRetry: boolean;
}
