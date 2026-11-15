import type { SavedCard } from "../lib/card-state";
import type { WorkspaceData } from "../lib/workspace";
import { topicThreadStyle } from "./ui";

const KNOT = "M2 14c3-10 9 8 5-2s8-9 7 0 6 6 5 0c-1-5 4-4 5 0h18";
const STRAIGHT = "M2 14h40";

export function TodayThreads({ cards, workspace }: { cards: SavedCard[]; workspace: WorkspaceData }) {
  if (cards.length === 0) return null;
  return <div className="today-threads" role="list" aria-label="오늘의 실"><span className="today-threads-label" aria-hidden="true">오늘의 실</span>{cards.map((card) => {
    const topic = workspace.topics.find((item) => item.id === card.nudge.topic_id);
    const themeIndex = topic ? workspace.themes.findIndex((theme) => theme.name === topic.theme) : -1;
    const completed = card.status === "completed";
    const label = `${card.nudge.title}: ${completed ? "완료" : "아직"}`;
    return <span key={`${card.key}:${card.created_at}`} className="today-thread" role="listitem" style={topicThreadStyle(themeIndex)}
      data-card-key={card.key} data-completed={String(completed)} data-thread-state={completed ? "completed" : "pending"} aria-label={label} title={label}>
      <svg viewBox="0 0 44 24" fill="none" aria-hidden="true"><path d={completed ? STRAIGHT : KNOT} /></svg>
    </span>;
  })}</div>;
}
