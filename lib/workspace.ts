import type { ExportData, Profile, SuggestedState, Topic } from "./types";
import { emptyCardState, getCardState } from "./card-state";
import type { CardState } from "./card-state";
import type { SampleMode } from "./sample-mode";
import { archiveCompletedSteps, completedSteps } from "./history";
import type { CompletedStep } from "./history";

export interface WorkspaceTopic extends Omit<Topic, "theme"> {
  theme: string | null;
  state: "active" | "later";
  starred: boolean;
  manual_order: number | null;
  updated_at: string | null;
  notes?: string[];
}

export interface WorkspaceTheme {
  name: string;
  collapsed: boolean;
}

export interface WorkspaceData {
  version: 1;
  profile: Profile;
  topics: WorkspaceTopic[];
  themes: WorkspaceTheme[];
  removed_names: string[];
  selected_topic_id: string | null;
  later_collapsed: boolean;
  cards?: CardState;
  sample?: SampleMode;
  completed_steps?: CompletedStep[];
}

function groupTopics<T extends Pick<Topic, "name" | "sources">>(topics: readonly T[], key: (topic: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const topic of topics) {
    const identity = key(topic);
    const group = groups.get(identity) ?? [];
    group.push(topic);
    groups.set(identity, group);
  }
  return groups;
}

/** Restore preferences only when a previous topic has a unique counterpart in this import. */
export function matchPreviousTopics(data: ExportData, existing: WorkspaceData | null): Map<string, WorkspaceTopic> {
  const matches = new Map<string, WorkspaceTopic>();
  if (existing === null) return matches;
  const identity = (topic: Pick<Topic, "name" | "sources">) => JSON.stringify([topic.name, [...topic.sources].sort()]);
  const oldNames = groupTopics(existing.topics, (topic) => topic.name);
  const newNames = groupTopics(data.topics, (topic) => topic.name);
  const oldIdentities = groupTopics(existing.topics, identity);
  const newIdentities = groupTopics(data.topics, identity);
  for (const topic of data.topics) {
    const oldByName = oldNames.get(topic.name) ?? [];
    if (oldByName.length === 1 && newNames.get(topic.name)?.length === 1) {
      matches.set(topic.id, oldByName[0]);
      continue;
    }
    const key = identity(topic);
    const oldByIdentity = oldIdentities.get(key) ?? [];
    if (oldByIdentity.length === 1 && newIdentities.get(key)?.length === 1) {
      matches.set(topic.id, oldByIdentity[0]);
    }
  }
  return matches;
}

/** An import replaces the visible list while retaining explicit user preferences and deletions. */
export function confirmOnboarding(
  data: ExportData,
  decisions: Record<string, SuggestedState>,
  existing: WorkspaceData | null,
  now: string,
): WorkspaceData {
  const removedNames = new Set(existing?.removed_names ?? []);
  const previousMatches = matchPreviousTopics(data, existing);
  const candidates = data.topics.filter((topic) => !removedNames.has(topic.name)).map((topic) => {
    const previous = previousMatches.get(topic.id);
    return { topic, previous, choice: decisions[topic.id] ?? previous?.state ?? topic.suggested_state };
  });
  const retained = candidates.filter(({ choice }) => choice !== "remove");
  const retainedNames = new Set(retained.map(({ topic }) => topic.name));
  for (const { topic, choice } of candidates) {
    if (choice === "remove" && !retainedNames.has(topic.name)) {
      removedNames.add(topic.name);
    }
  }

  // A current review choice targets an ID, so keeping another same-name item remains possible.
  const topics: WorkspaceTopic[] = retained.map(({ topic, previous, choice }) => {
    return {
      ...topic,
      theme: previous ? previous.theme : topic.theme,
      state: choice === "active" ? "active" : "later",
      starred: previous?.starred ?? false,
      manual_order: previous?.manual_order ?? null,
      updated_at: previous ? previous.updated_at : now,
      notes: [...(previous?.notes ?? [])],
    };
  });

  // A duplicate name can occur across sources; restoring stars must still respect the global limit.
  let starred = 0;
  for (const topic of topics) {
    if (topic.starred && ++starred > 3) topic.starred = false;
  }
  const names = [...new Set([...data.themes, ...topics.flatMap((topic) => topic.theme === null ? [] : [topic.theme])])];
  const themes = names.map((name) => ({
    name,
    collapsed: existing?.themes.find((theme) => theme.name === name)?.collapsed ?? false,
  }));
  const selectedId = existing?.selected_topic_id ?? null;
  return {
    version: 1,
    profile: data.profile,
    topics,
    themes,
    removed_names: [...removedNames],
    selected_topic_id: selectedId === null ? null : retained.find(({ previous }) => previous?.id === selectedId)?.topic.id ?? null,
    later_collapsed: existing?.later_collapsed ?? true,
    cards: emptyCardState(),
    completed_steps: existing ? completedSteps(existing) : [],
  };
}

function changeTopic(workspace: WorkspaceData, id: string, change: (topic: WorkspaceTopic) => WorkspaceTopic): WorkspaceData {
  if (!workspace.topics.some((topic) => topic.id === id)) return workspace;
  return { ...workspace, topics: workspace.topics.map((topic) => topic.id === id ? change(topic) : topic) };
}

export function removeTopic(workspace: WorkspaceData, id: string): WorkspaceData {
  const topic = workspace.topics.find((item) => item.id === id);
  if (!topic) return workspace;
  workspace = archiveCompletedSteps(workspace);
  const remaining = workspace.topics.filter((item) => item.id !== id);
  const cards = getCardState(workspace);
  return {
    ...workspace,
    topics: remaining,
    removed_names: remaining.some((item) => item.name === topic.name)
      ? workspace.removed_names
      : [...new Set([...workspace.removed_names, topic.name])],
    selected_topic_id: workspace.selected_topic_id === id ? null : workspace.selected_topic_id,
    cards: { ...cards, items: cards.items.filter((card) => card.nudge.topic_id !== id), feedback: cards.feedback.filter((feedback) => feedback.topic_id !== id) },
  };
}

/** User choices are independent of the parser's initial classification and have no active-topic cap. */
export function setTopicState(workspace: WorkspaceData, id: string, state: WorkspaceTopic["state"]): WorkspaceData {
  return changeTopic(workspace, id, (topic) => ({ ...topic, state }));
}

export function toggleStar(workspace: WorkspaceData, id: string): WorkspaceData {
  const topic = workspace.topics.find((item) => item.id === id);
  if (!topic) return workspace;
  if (!topic.starred && workspace.topics.filter((item) => item.starred).length >= 3) {
    throw new Error("별은 최대 3개까지 표시할 수 있어요.");
  }
  return changeTopic(workspace, id, (item) => ({ ...item, starred: !item.starred }));
}

export function moveTopicTheme(workspace: WorkspaceData, id: string, theme: string | null): WorkspaceData {
  if (!workspace.topics.some((topic) => topic.id === id)) return workspace;
  const next = changeTopic(workspace, id, (topic) => ({ ...topic, theme }));
  return theme !== null && !next.themes.some((item) => item.name === theme)
    ? { ...next, themes: [...next.themes, { name: theme, collapsed: false }] }
    : next;
}

export function setThemeCollapsed(workspace: WorkspaceData, name: string, collapsed: boolean): WorkspaceData {
  if (!workspace.themes.some((theme) => theme.name === name)) return workspace;
  return { ...workspace, themes: workspace.themes.map((theme) => theme.name === name ? { ...theme, collapsed } : theme) };
}

export function setLaterCollapsed(workspace: WorkspaceData, collapsed: boolean): WorkspaceData {
  return { ...workspace, later_collapsed: collapsed };
}

export function selectTopic(workspace: WorkspaceData, id: string | null, now: string): WorkspaceData {
  if (id === null) return { ...workspace, selected_topic_id: null };
  if (!workspace.topics.some((topic) => topic.id === id)) return workspace;
  return {
    ...changeTopic(workspace, id, (topic) => ({ ...topic, updated_at: now })),
    selected_topic_id: id,
  };
}

/** Return a copy; missing dates sort last and equal values retain their original order. */
export function sortTopics(topics: readonly WorkspaceTopic[]): WorkspaceTopic[] {
  return topics.map((topic, index) => ({ topic, index })).sort((a, b) => (
    (a.topic.deadline ?? "9999").localeCompare(b.topic.deadline ?? "9999")
    || (b.topic.updated_at ?? "").localeCompare(a.topic.updated_at ?? "")
    || (a.topic.manual_order ?? Number.MAX_SAFE_INTEGER) - (b.topic.manual_order ?? Number.MAX_SAFE_INTEGER)
    || a.index - b.index
  )).map(({ topic }) => topic);
}
