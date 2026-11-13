import type { CardFeedback, CardInput, Nudge } from "./card-types";
import type { WorkspaceData, WorkspaceTopic } from "./workspace";

export type SavedCardStatus = "pending" | "accepted" | "snoozed" | "completed" | "dismissed";

export interface SavedCard {
  key: string;
  nudge: Nudge;
  content: string;
  status: SavedCardStatus;
  created_at: string;
  accepted_at: string | null;
  snoozed_until: string | null;
  resolved_at: string | null;
}

export interface CardState {
  items: SavedCard[];
  feedback: CardFeedback[];
  /** The last attempted local calendar date, including failures and valid empty results. */
  generated_date: string | null;
  error: string | null;
  next_key: number;
  /** Guards an in-flight result against re-imports and newer explicit requests. */
  request_id?: string | null;
}

/** Snoozing an accepted card hides it temporarily without ending the accepted work. */
export function isAcceptedUnfinished(card: SavedCard): boolean {
  return card.status === "accepted" || (card.status === "snoozed" && card.accepted_at !== null);
}

export function emptyCardState(): CardState {
  return { items: [], feedback: [], generated_date: null, error: null, next_key: 1, request_id: null };
}

export function getCardState(workspace: WorkspaceData): CardState {
  return workspace.cards ?? emptyCardState();
}

const DAY_MS = 86_400_000;
function calendarTime(date: string): number {
  const value = Date.parse(`${date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) {
    throw new Error("날짜 형식을 확인해 주세요.");
  }
  return value;
}

export function shouldGenerateCards(workspace: WorkspaceData, today: string): boolean {
  calendarTime(today);
  return getCardState(workspace).generated_date !== today;
}

/** Save this result synchronously before fetching so refreshes cannot repeat an automatic attempt. */
export function markCardGeneration(workspace: WorkspaceData, today: string, requestId: string | null = null): WorkspaceData {
  calendarTime(today);
  return { ...workspace, cards: { ...getCardState(workspace), generated_date: today, error: null, request_id: requestId } };
}

export function applyGeneratedCards(workspace: WorkspaceData, nudges: readonly Nudge[], now: string, today: string, requestId?: string): WorkspaceData {
  calendarTime(today);
  const state = getCardState(workspace);
  if (requestId !== undefined && state.request_id !== requestId) return workspace;
  let nextKey = state.next_key;
  const accepted = new Set(state.items.filter(isAcceptedUnfinished).map((card) => card.nudge.topic_id));
  const newCards: SavedCard[] = nudges.filter((nudge) => nudge.topic_id === "new" || (!accepted.has(nudge.topic_id) && workspace.topics.some((topic) => topic.id === nudge.topic_id))).map((nudge) => ({
    key: `card-${nextKey++}`,
    nudge: structuredClone(nudge),
    content: nudge.head_start.content,
    status: "pending",
    created_at: now,
    accepted_at: null,
    snoozed_until: null,
    resolved_at: null,
  }));
  return {
    ...workspace,
    cards: {
      ...state,
      // Snoozed originals remain stored; their next-day return never requires generation.
      items: [...state.items.filter((card) => card.status !== "pending"), ...newCards],
      generated_date: today,
      error: null,
      next_key: nextKey,
      request_id: null,
    },
  };
}

export function failCardGeneration(workspace: WorkspaceData, message: string, requestId?: string): WorkspaceData {
  const state = getCardState(workspace);
  if (requestId !== undefined && state.request_id !== requestId) return workspace;
  return { ...workspace, cards: { ...state, error: message, request_id: null } };
}

export function buildWorkspaceCardInput(workspace: WorkspaceData, today: string): CardInput {
  const todayTime = calendarTime(today);
  const state = getCardState(workspace);
  const accepted = new Set(state.items.filter(isAcceptedUnfinished).map((card) => card.nudge.topic_id));
  const eligible = workspace.topics.filter((topic) => topic.state === "active" && !accepted.has(topic.id));
  eligible.sort((a, b) => Number(b.starred) - Number(a.starred)
    || (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999")
    || (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
  return {
    today,
    profile: {
      roles: [...workspace.profile.roles],
      interests: [...workspace.profile.interests],
      current_focus: [...workspace.profile.current_focus],
      work_style: workspace.profile.work_style,
    },
    topics: eligible.slice(0, 9).map((topic) => ({
      id: topic.id,
      name: topic.name,
      theme: topic.theme ?? "따로 뺀 토픽",
      starred: topic.starred,
      days_left: topic.deadline === null ? null : (calendarTime(topic.deadline) - todayTime) / DAY_MS,
      deadline_label: topic.deadline_label,
      deadline_text: topic.deadline_text,
      goal: topic.goal,
      status_text: topic.status_text,
      outputs: [...topic.outputs],
      recent_decisions: [...topic.recent_decisions],
      blockers: topic.blockers,
      next_steps: [...topic.next_steps],
    })),
    feedback: state.feedback.slice(-20).map((feedback) => ({ ...feedback })),
  };
}

/** Topic requests stay in memory: JSON exports and persisted workspace schemas remain unchanged. */
const topicRequest = Symbol("untangle.topic-card-request");
interface TopicRequestGuard { id: string; cards: readonly SavedCard[]; context: string }
type RequestTopic = WorkspaceTopic & { [topicRequest]?: TopicRequestGuard };

function topicRequestContext(topic: WorkspaceTopic): string {
  // Opening a board changes updated_at; navigation alone must not discard a paid result.
  const { updated_at: _updatedAt, manual_order: _order, ...context } = topic;
  return JSON.stringify(context);
}

export function getTopicCardRequestId(workspace: WorkspaceData, topicId: string): string | null {
  return (workspace.topics.find((topic) => topic.id === topicId) as RequestTopic | undefined)?.[topicRequest]?.id ?? null;
}

/** Explicit requests may use later topics without changing their saved or suggested classification. */
export function buildTopicCardInput(workspace: WorkspaceData, topicId: string, today: string): CardInput {
  const topic = workspace.topics.find((item) => item.id === topicId);
  if (!topic) throw new Error("이 토픽을 찾지 못했어요.");
  if (getCardState(workspace).items.some((card) => card.nudge.topic_id === topicId && isAcceptedUnfinished(card))) {
    throw new Error("이 토픽에는 진행 중인 카드가 있어요. 먼저 마치거나 정리해 주세요.");
  }
  // Reuse the canonical mapping after narrowing before its nine-topic cap. Only this input copy is active.
  return buildWorkspaceCardInput({ ...workspace, topics: [{ ...topic, state: "active" }] }, today);
}

export function markTopicCardGeneration(workspace: WorkspaceData, topicId: string, requestId: string): WorkspaceData {
  const cards = getCardState(workspace).items.filter((card) => card.nudge.topic_id === topicId);
  return {
    ...workspace,
    topics: workspace.topics.map((topic) => topic.id === topicId
      ? { ...topic, [topicRequest]: { id: requestId, cards, context: topicRequestContext(topic) } } : topic),
  };
}

export function clearTopicCardGeneration(workspace: WorkspaceData, topicId: string, requestId: string): WorkspaceData {
  if (getTopicCardRequestId(workspace, topicId) !== requestId) return workspace;
  return {
    ...workspace,
    topics: workspace.topics.map((topic) => {
      if (topic.id !== topicId) return topic;
      const { [topicRequest]: _request, ...rest } = topic as RequestTopic;
      return rest;
    }),
  };
}

/** Replace this topic's untouched pending suggestions, retaining all daily cache and feedback fields. */
export function applyTopicGeneratedCards(workspace: WorkspaceData, topicId: string, nudges: readonly Nudge[], now: string, requestId: string): WorkspaceData {
  const topic = workspace.topics.find((item) => item.id === topicId) as RequestTopic | undefined;
  const guard = topic?.[topicRequest];
  if (!topic || !guard || guard.id !== requestId) return workspace;
  const next = clearTopicCardGeneration(workspace, topicId, requestId);
  const state = getCardState(workspace);
  const currentCards = state.items.filter((card) => card.nudge.topic_id === topicId);
  // A newer edit, lifecycle action or global result takes precedence over this response.
  if (topicRequestContext(topic) !== guard.context || currentCards.some(isAcceptedUnfinished)
    || currentCards.length !== guard.cards.length || currentCards.some((card, index) => card !== guard.cards[index])) return next;
  let nextKey = state.next_key;
  const newCards: SavedCard[] = nudges.filter((nudge) => nudge.topic_id === topicId).map((nudge) => ({
    key: `card-${nextKey++}`, nudge: structuredClone(nudge), content: nudge.head_start.content,
    status: "pending", created_at: now, accepted_at: null, snoozed_until: null, resolved_at: null,
  }));
  return {
    ...next,
    cards: {
      ...state,
      items: [...state.items.filter((card) => card.nudge.topic_id !== topicId || card.status !== "pending"), ...newCards],
      next_key: nextKey,
    },
  };
}

export function visibleCards(workspace: WorkspaceData, today: string): SavedCard[] {
  calendarTime(today);
  return getCardState(workspace).items.filter((card) => card.status === "pending" || card.status === "accepted"
    || (card.status === "snoozed" && card.snoozed_until !== null && card.snoozed_until <= today));
}

function changeCard(workspace: WorkspaceData, key: string, change: (card: SavedCard) => SavedCard): WorkspaceData {
  const state = getCardState(workspace);
  if (!state.items.some((card) => card.key === key)) return workspace;
  return { ...workspace, cards: { ...state, items: state.items.map((card) => card.key === key ? change(card) : card) } };
}

const actionable = (card: SavedCard) => card.status === "pending" || card.status === "accepted" || card.status === "snoozed";

export function updateCardContent(workspace: WorkspaceData, key: string, content: string): WorkspaceData {
  return changeCard(workspace, key, (card) => actionable(card) ? { ...card, content } : card);
}

export function acceptCard(workspace: WorkspaceData, key: string, now: string): WorkspaceData {
  const state = getCardState(workspace);
  const card = state.items.find((item) => item.key === key);
  if (!card || card.status === "accepted" || !actionable(card)) return workspace;
  let next = workspace;
  let topicId = card.nudge.topic_id;
  if (card.nudge.type === "new_project" && topicId === "new") {
    let suffix = 1;
    topicId = `new-topic-${suffix}`;
    while (workspace.topics.some((topic) => topic.id === topicId)) topicId = `new-topic-${++suffix}`;
    const name = card.nudge.new_topic_name?.trim();
    if (!name) throw new Error("새 토픽 이름을 확인해 주세요.");
    const topic: WorkspaceTopic = {
      id: topicId, name, one_liner: card.nudge.action, theme: null,
      category: "personal", progress: "in_progress", last_touched: "recent_2w",
      goal: null, status_text: null, outputs: [], recent_decisions: [], blockers: null,
      next_steps: [card.nudge.action], deadline: null, deadline_label: null, deadline_text: null,
      collaborators: [], related: [], sources: [], merged_from: [],
      suggested_state: "active", suggested_reason: "수락한 새 프로젝트",
      state: "active", starred: false, manual_order: null, updated_at: now, notes: [],
    };
    next = { ...workspace, topics: [...workspace.topics, topic], removed_names: workspace.removed_names.filter((removed) => removed !== name) };
  }
  if (!next.topics.some((topic) => topic.id === topicId)) return workspace;
  if (state.items.some((item) => item.key !== key && isAcceptedUnfinished(item) && item.nudge.topic_id === topicId)) {
    throw new Error("이 토픽에는 진행 중인 카드가 있어요.");
  }
  return changeCard(next, key, (item) => ({ ...item, nudge: { ...item.nudge, topic_id: topicId }, status: "accepted", accepted_at: now, snoozed_until: null }));
}

function recordFeedback(workspace: WorkspaceData, key: string, result: CardFeedback["result"], note: string | null): WorkspaceData {
  const state = getCardState(workspace);
  const card = state.items.find((item) => item.key === key);
  if (!card) return workspace;
  const feedback: CardFeedback = {
    topic_id: card.nudge.topic_id, type: card.nudge.type, title: card.nudge.title,
    action: card.nudge.action, result, note,
  };
  return { ...workspace, cards: { ...state, feedback: [...state.feedback, feedback].slice(-20) } };
}

export function completeCard(workspace: WorkspaceData, key: string, note: string | null, now: string): WorkspaceData {
  const card = getCardState(workspace).items.find((item) => item.key === key);
  if (!card || !actionable(card)) return workspace;
  const next = changeCard(workspace, key, (item) => ({ ...item, status: "completed", resolved_at: now, snoozed_until: null }));
  return recordFeedback(next, key, "completed", note?.trim() || null);
}

export function dismissCard(workspace: WorkspaceData, key: string, now: string): WorkspaceData {
  const card = getCardState(workspace).items.find((item) => item.key === key);
  if (!card || !actionable(card)) return workspace;
  const next = changeCard(workspace, key, (item) => ({ ...item, status: "dismissed", resolved_at: now, snoozed_until: null }));
  return recordFeedback(next, key, "dismissed", null);
}

export function snoozeCard(workspace: WorkspaceData, key: string, today: string): WorkspaceData {
  const card = getCardState(workspace).items.find((item) => item.key === key);
  if (!card || !actionable(card)) return workspace;
  const until = new Date(calendarTime(today) + DAY_MS).toISOString().slice(0, 10);
  const next = changeCard(workspace, key, (item) => ({ ...item, status: "snoozed", snoozed_until: until }));
  return recordFeedback(next, key, "snoozed", null);
}

export function answerCard(workspace: WorkspaceData, key: string, optionId: string, now: string): WorkspaceData {
  const card = getCardState(workspace).items.find((item) => item.key === key);
  if (!card || !actionable(card) || card.nudge.type !== "unblock") return workspace;
  const option = card.nudge.head_start.options.find((item) => item.id === optionId);
  if (!option) throw new Error("선택한 답을 확인해 주세요.");
  const next = {
    ...workspace,
    topics: workspace.topics.map((topic) => topic.id === card.nudge.topic_id ? { ...topic, notes: [...(topic.notes ?? []), option.value] } : topic),
  };
  return completeCard(next, key, option.value, now);
}

export function isStaleAccepted(card: SavedCard, now: string): boolean {
  return isAcceptedUnfinished(card) && card.accepted_at !== null
    && Date.parse(now) - Date.parse(card.accepted_at) >= 48 * 60 * 60 * 1000;
}

export function continueAcceptedCard(workspace: WorkspaceData, key: string, now: string): WorkspaceData {
  return changeCard(workspace, key, (card) => isAcceptedUnfinished(card)
    ? { ...card, status: "accepted", accepted_at: now, snoozed_until: null } : card);
}

export interface RemovedTopicSnapshot {
  topic: WorkspaceTopic;
  index: number;
  cards: SavedCard[];
  feedback: CardFeedback[];
  was_selected: boolean;
}

export function snapshotTopicRemoval(workspace: WorkspaceData, id: string): RemovedTopicSnapshot | null {
  const index = workspace.topics.findIndex((topic) => topic.id === id);
  if (index < 0) return null;
  const state = getCardState(workspace);
  return structuredClone({
    topic: workspace.topics[index], index,
    cards: state.items.filter((card) => card.nudge.topic_id === id),
    feedback: state.feedback.filter((feedback) => feedback.topic_id === id),
    was_selected: workspace.selected_topic_id === id,
  });
}

/** Restore only the deleted topic and its cards, preserving unrelated changes made after deletion. */
export function restoreRemovedTopic(workspace: WorkspaceData, snapshot: RemovedTopicSnapshot): WorkspaceData {
  if (workspace.topics.some((topic) => topic.id === snapshot.topic.id)) return workspace;
  const state = getCardState(workspace);
  const topic = structuredClone(snapshot.topic);
  if (workspace.topics.filter((item) => item.starred).length >= 3) topic.starred = false;
  const topics = [...workspace.topics];
  topics.splice(Math.min(snapshot.index, topics.length), 0, topic);
  return {
    ...workspace, topics,
    themes: topic.theme !== null && !workspace.themes.some((theme) => theme.name === topic.theme)
      ? [...workspace.themes, { name: topic.theme, collapsed: false }] : workspace.themes,
    removed_names: workspace.removed_names.filter((name) => name !== topic.name),
    selected_topic_id: snapshot.was_selected && workspace.selected_topic_id === null ? topic.id : workspace.selected_topic_id,
    cards: {
      ...state,
      items: [...state.items, ...structuredClone(snapshot.cards).filter((card) => !state.items.some((item) => item.key === card.key))],
      feedback: [...structuredClone(snapshot.feedback), ...state.feedback].slice(-20),
    },
  };
}
