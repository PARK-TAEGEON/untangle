"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toggleStar } from "../lib/workspace";
import type { WorkspaceTopic } from "../lib/workspace";
import { IconButton } from "./icons";
import { topicThreadStyle } from "./ui";
import { useWorkspace } from "./workspace-provider";

const NOTICE_EVENT = "untangle:topic-star-notice";
interface StarNotice { id: number; text: string }

/** Tile and menu share the canonical three-star rule and the same nonblocking limit notice. */
export function useTopicStar(topicId: string) {
  const { workspace, update } = useWorkspace();
  const owner = useId();
  const sequence = useRef(0);
  const [message, setMessage] = useState<StarNotice | null>(null);
  useEffect(() => {
    const otherNotice = (event: Event) => { if ((event as CustomEvent<string>).detail !== owner) setMessage(null); };
    window.addEventListener(NOTICE_EVENT, otherNotice);
    return () => window.removeEventListener(NOTICE_EVENT, otherNotice);
  }, [owner]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  function showLimit() {
    window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: owner }));
    setMessage({ id: ++sequence.current, text: "별은 세 개까지예요" });
  }

  function toggle(): boolean {
    const topic = workspace?.topics.find((item) => item.id === topicId);
    if (!topic) return false;
    if (!topic.starred && workspace!.topics.filter((item) => item.starred).length >= 3) { showLimit(); return false; }
    let limited = false;
    let changed = false;
    const saved = update((previous) => {
      const actual = previous.topics.find((item) => item.id === topicId);
      if (!actual) return previous;
      // Check the provider's latest state too, for quick actions before a rerender.
      if (!actual.starred && previous.topics.filter((item) => item.starred).length >= 3) { limited = true; return previous; }
      changed = true;
      return toggleStar(previous, topicId);
    });
    if (limited) { showLimit(); return false; }
    if (saved && changed) {
      window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: owner }));
      setMessage(null);
    }
    return saved && changed;
  }

  const notice = message && typeof document !== "undefined"
    ? createPortal(<p key={message.id} className="topic-star-notice" role="status">{message.text}</p>, document.body) : null;
  return { toggle, notice };
}

export function TopicStarButton({ topic, themeIndex }: { topic: WorkspaceTopic; themeIndex: number }) {
  const { toggle, notice } = useTopicStar(topic.id);
  return <><IconButton icon="star" className="topic-star-button" style={topicThreadStyle(themeIndex)}
    label={`${topic.name} ${topic.starred ? "별 해제" : "별 표시"}`} aria-pressed={topic.starred} onClick={toggle} />{notice}</>;
}
