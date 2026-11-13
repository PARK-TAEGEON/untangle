import type { Nudge } from "./card-types";
import type { WorkspaceTopic } from "./workspace";

/** Assemble the specified handoff locally, including the latest edited source. */
export function buildHandoff(topic: Pick<WorkspaceTopic, "name" | "one_liner" | "status_text"> | undefined, nudge: Nudge, content: string): string {
  return `[프로젝트] ${topic?.name ?? nudge.new_topic_name ?? "새 프로젝트"}: ${topic?.one_liner ?? nudge.action}\n[지금 상태] ${topic?.status_text ?? "아직 시작 전"}\n[하려는 일] ${nudge.title}: ${nudge.action}\n[준비된 초안]\n${content}\n\n이 초안에서 이어서 도와줘.`;
}
