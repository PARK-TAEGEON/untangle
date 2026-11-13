import type { WorkspaceData } from "./workspace";

/** App-only history; this never becomes part of the parser or LLM schema. */
export interface CompletedStep {
  id: string;
  card_key: string;
  title: string;
  topic_id: string;
  topic_name: string;
  note: string | null;
  completed_at: string;
}

export function completedSteps(workspace: WorkspaceData): CompletedStep[] {
  const steps = new Map((workspace.completed_steps ?? []).map((step) => [step.id, { ...step }]));
  for (const card of workspace.cards?.items ?? []) {
    if (card.status !== "completed" || card.resolved_at === null) continue;
    const id = JSON.stringify([card.key, card.nudge.topic_id, card.resolved_at]);
    if (steps.has(id)) continue;
    const feedback = [...(workspace.cards?.feedback ?? [])].reverse().find((item) => item.result === "completed"
      && item.topic_id === card.nudge.topic_id && item.title === card.nudge.title
      && item.action === card.nudge.action && item.type === card.nudge.type);
    steps.set(id, {
      id, card_key: card.key, title: card.nudge.title, topic_id: card.nudge.topic_id,
      topic_name: workspace.topics.find((topic) => topic.id === card.nudge.topic_id)?.name ?? card.nudge.new_topic_name ?? "삭제한 토픽",
      note: feedback?.note ?? null, completed_at: card.resolved_at,
    });
  }
  return [...steps.values()].sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at));
}

/** Capture legacy completed cards before a topic deletion or another import clears them. */
export function archiveCompletedSteps(workspace: WorkspaceData): WorkspaceData {
  return { ...workspace, completed_steps: completedSteps(workspace) };
}

export function completedDate(timestamp: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp));
}
