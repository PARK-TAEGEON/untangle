import type { WorkspaceData, WorkspaceTopic } from "./workspace";
import { emptyCardState, isAcceptedUnfinished } from "./card-state";
import type { CardState, SavedCard } from "./card-state";
import type { CardFeedback } from "./card-types";
import { validateNudge } from "./schemas";

export const WORKSPACE_STORAGE_KEY = "untangle.workspace.v1";
export const SAMPLE_WORKSPACE_STORAGE_KEY = "untangle.sample.workspace.v1";
export const WORKSPACE_MODE_STORAGE_KEY = "untangle.workspace.mode.v1";

export class WorkspaceStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceStorageError";
  }
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const nullableString = (value: unknown) => value === null || typeof value === "string";
const isoDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
const isoTimestamp = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));

function isSavedCard(value: unknown): value is SavedCard {
  if (!record(value) || !validateNudge(value.nudge)) return false;
  return typeof value.key === "string" && typeof value.content === "string"
    && ["pending", "accepted", "snoozed", "completed", "dismissed"].includes(value.status as string)
    && isoTimestamp(value.created_at)
    && (value.accepted_at === null || isoTimestamp(value.accepted_at))
    && (value.snoozed_until === null || isoDate(value.snoozed_until))
    && (value.resolved_at === null || isoTimestamp(value.resolved_at))
    && (value.status !== "accepted" || value.accepted_at !== null)
    && (value.status !== "snoozed" || value.snoozed_until !== null);
}

function isFeedback(value: unknown): value is CardFeedback {
  return record(value) && typeof value.topic_id === "string" && typeof value.title === "string" && typeof value.action === "string"
    && ["continue", "unblock", "expand", "new_project"].includes(value.type as string)
    && ["completed", "dismissed", "snoozed"].includes(value.result as string) && nullableString(value.note);
}

function isCardState(value: unknown, topicIds: Set<string>): value is CardState {
  if (!record(value) || !Array.isArray(value.items) || !value.items.every(isSavedCard)
    || !Array.isArray(value.feedback) || value.feedback.length > 20 || !value.feedback.every(isFeedback)) return false;
  const nextKey = value.next_key;
  const accepted = value.items.filter(isAcceptedUnfinished);
  return (value.generated_date === null || isoDate(value.generated_date)) && nullableString(value.error)
    && (value.request_id === undefined || value.request_id === null || (typeof value.request_id === "string" && value.request_id.length > 0))
    && typeof nextKey === "number" && Number.isSafeInteger(nextKey) && nextKey >= 1
    && new Set(value.items.map((card) => card.key)).size === value.items.length
    && value.items.every((card) => { const match = /^card-(\d+)$/.exec(card.key); return !match || Number(match[1]) < nextKey; })
    && new Set(accepted.map((card) => card.nudge.topic_id)).size === accepted.length
    && value.items.every((card) => topicIds.has(card.nudge.topic_id) || (card.nudge.type === "new_project" && card.nudge.topic_id === "new" && card.status !== "accepted"));
}

function isTopic(value: unknown): value is WorkspaceTopic {
  if (!record(value)) return false;
  const stringFields = ["id", "name", "one_liner", "suggested_reason"];
  const nullableFields = ["theme", "goal", "status_text", "blockers", "deadline", "deadline_label", "deadline_text", "updated_at"];
  const listFields = ["outputs", "recent_decisions", "next_steps", "collaborators", "related", "merged_from"];
  return stringFields.every((key) => typeof value[key] === "string")
    && nullableFields.every((key) => nullableString(value[key]))
    && listFields.every((key) => strings(value[key]))
    && ["school", "personal", "work", "career", "other"].includes(value.category as string)
    && ["in_progress", "stalled", "done", "idea_only", "unknown"].includes(value.progress as string)
    && ["recent_2w", "recent_1m", "older", "unknown"].includes(value.last_touched as string)
    && ["active", "later", "remove"].includes(value.suggested_state as string)
    && (value.state === "active" || value.state === "later")
    && typeof value.starred === "boolean"
    && (value.notes === undefined || strings(value.notes))
    && (value.manual_order === null || (typeof value.manual_order === "number" && Number.isFinite(value.manual_order)))
    && strings(value.sources) && value.sources.every((source) => ["chatgpt", "claude", "other"].includes(source));
}

/** Validate local persistence separately from the unchanged import schema (theme may be null here). */
function isWorkspace(value: unknown): value is WorkspaceData {
  if (!record(value) || value.version !== 1 || !record(value.profile)) return false;
  const profile = value.profile;
  if (typeof profile.summary !== "string" || !nullableString(profile.work_style)
    || !["roles", "interests", "current_focus", "tools"].every((key) => strings(profile[key]))) return false;
  if (!Array.isArray(value.topics) || !value.topics.every(isTopic)) return false;
  if (!Array.isArray(value.themes) || !value.themes.every((theme) => record(theme) && typeof theme.name === "string" && typeof theme.collapsed === "boolean")) return false;
  if (!strings(value.removed_names) || !nullableString(value.selected_topic_id) || typeof value.later_collapsed !== "boolean") return false;
  const removedNames = value.removed_names;
  if (value.topics.filter((topic) => topic.starred).length > 3) return false;
  if (value.topics.some((topic) => removedNames.includes(topic.name))) return false;
  if (new Set(value.topics.map((topic) => topic.id)).size !== value.topics.length) return false;
  const themeNames = new Set(value.themes.map((theme) => theme.name));
  if (themeNames.size !== value.themes.length) return false;
  if (!value.topics.every((topic) => topic.theme === null || themeNames.has(topic.theme))) return false;
  if (value.selected_topic_id !== null && !value.topics.some((topic) => topic.id === value.selected_topic_id)) return false;
  if (value.cards !== undefined && !isCardState(value.cards, new Set(value.topics.map((topic) => topic.id)))) return false;
  if (value.sample !== undefined && (!record(value.sample)
    || !["game-developer", "student"].includes(value.sample.persona as string)
    || typeof value.sample.next_round !== "number" || !Number.isSafeInteger(value.sample.next_round) || value.sample.next_round < 0
    || !isoDate(value.sample.baseline_date))) return false;
  return true;
}

export function loadWorkspace(storage: Pick<Storage, "getItem">, key = WORKSPACE_STORAGE_KEY): WorkspaceData | null {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    throw new WorkspaceStorageError("브라우저 저장소를 열지 못했어요. 저장소 설정을 확인해 주세요.");
  }
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new WorkspaceStorageError("저장된 자료를 읽지 못했어요. 기존 자료는 그대로 보관했어요.");
  }
  if (!isWorkspace(value)) {
    throw new WorkspaceStorageError("저장된 자료의 형식을 읽지 못했어요. 기존 자료는 그대로 보관했어요.");
  }
  return {
    ...value,
    topics: value.topics.map((topic) => ({ ...topic, notes: topic.notes ?? [] })),
    cards: { ...(value.cards ?? emptyCardState()), request_id: value.cards?.request_id ?? null },
  };
}

export function saveWorkspace(storage: Pick<Storage, "setItem">, workspace: WorkspaceData, key = WORKSPACE_STORAGE_KEY): void {
  if (!isWorkspace(workspace)) {
    throw new WorkspaceStorageError("자료 형식을 확인하지 못해 저장하지 않았어요.");
  }
  try {
    storage.setItem(key, JSON.stringify(workspace));
  } catch {
    throw new WorkspaceStorageError("이 브라우저에 저장하지 못했어요. 저장 공간과 브라우저 설정을 확인해 주세요.");
  }
}
