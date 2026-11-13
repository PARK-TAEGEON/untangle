"use client";

import { useEffect, useRef, useState } from "react";
import { restoreRemovedTopic, snapshotTopicRemoval } from "../lib/card-state";
import { moveTopicTheme, removeTopic, setTopicState, toggleStar } from "../lib/workspace";
import type { WorkspaceData, WorkspaceTopic } from "../lib/workspace";
import { useWorkspace } from "./workspace-provider";
import { LineIcon } from "./icons";

export type TopicAction = (topic: WorkspaceTopic, action: "delete" | "later") => void;
interface UndoNotice { id: number; message: string; restore: (workspace: WorkspaceData) => WorkspaceData }

export function useTopicActions() {
  const { update } = useWorkspace();
  const [undo, setUndo] = useState<UndoNotice | null>(null);
  const nextNotice = useRef(0);
  useEffect(() => { if (!undo) return; const timer = setTimeout(() => setUndo(null), 5000); return () => clearTimeout(timer); }, [undo]);
  const onAction: TopicAction = (topic, action) => {
    let restore: UndoNotice["restore"] | null = null;
    const saved = update((previous) => {
      const actual = previous.topics.find((item) => item.id === topic.id);
      if (!actual) return previous;
      if (action === "delete") {
        const snapshot = snapshotTopicRemoval(previous, topic.id);
        if (snapshot) restore = (latest) => restoreRemovedTopic(latest, snapshot);
        return removeTopic(previous, topic.id);
      }
      restore = (latest) => setTopicState(latest, topic.id, actual.state);
      return setTopicState(previous, topic.id, "later");
    });
    if (saved && restore) setUndo({ id: ++nextNotice.current, message: `'${topic.name}'을 ${action === "delete" ? "삭제했어요." : "나중으로 옮겼어요."}`, restore });
  };
  const notice = undo ? <div className="undo-toast" role="status"><span>{undo.message}</span><button type="button" className="button button-quiet" onClick={() => { if (update(undo.restore)) setUndo(null); }}>되돌리기</button></div> : null;
  return { onAction, notice, hasUndo: undo !== null };
}

export function TopicMenu({ topic, workspace, onAction }: { topic: WorkspaceTopic; workspace: WorkspaceData; onAction: TopicAction }) {
  const { update } = useWorkspace();
  const starLimit = !topic.starred && workspace.topics.filter((item) => item.starred).length >= 3;
  return <details className="topic-menu">
    <summary className="icon-button" aria-label={`${topic.name} 메뉴`} title="토픽 메뉴" data-tooltip="토픽 메뉴"><LineIcon name="more" /></summary>
    <div className="topic-menu-panel">
      <button type="button" aria-pressed={topic.starred} disabled={starLimit} title={starLimit ? "별은 최대 3개까지 표시할 수 있어요." : undefined} onClick={() => update((previous) => toggleStar(previous, topic.id))}>{topic.starred ? "별 해제" : "별 표시"}{starLimit ? " (최대 3개)" : ""}</button>
      <button type="button" onClick={() => topic.state === "active" ? onAction(topic, "later") : update((previous) => setTopicState(previous, topic.id, "active"))}>{topic.state === "active" ? "나중에" : "다시 활성"}</button>
      <label className="menu-theme-label">테마 옮기기<select aria-label={`${topic.name} 테마 옮기기`} value={topic.theme ?? ""} onChange={(event) => update((previous) => moveTopicTheme(previous, topic.id, event.target.value || null))}><option value="">따로 뺀 토픽</option>{workspace.themes.map((theme) => <option key={theme.name} value={theme.name}>{theme.name}</option>)}</select></label>
      <button type="button" disabled={topic.theme === null} onClick={() => update((previous) => moveTopicTheme(previous, topic.id, null))}>따로 빼기</button>
      <button type="button" onClick={() => onAction(topic, "delete")}>삭제</button>
      <p className="menu-help">삭제한 토픽은 다시 가져와도 숨겨져요.</p>
    </div>
  </details>;
}
