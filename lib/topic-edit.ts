import type { WorkspaceData } from "./workspace";

export type EditableTopicField = "status_text" | "next_steps";

/** Save only the explicit edit; other topics, preferences and saved cards stay intact. */
export function editTopicField(workspace: WorkspaceData, topicId: string, field: EditableTopicField, value: string): WorkspaceData {
  if (!workspace.topics.some((topic) => topic.id === topicId)) throw new Error("이 토픽을 찾지 못했어요.");
  const edited = field === "next_steps"
    ? { next_steps: value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) }
    : { status_text: value.trim() || null };
  return { ...workspace, topics: workspace.topics.map((topic) => topic.id === topicId ? { ...topic, ...edited } : topic) };
}
