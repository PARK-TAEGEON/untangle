"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { visibleCards } from "../lib/card-state";
import { deadlineCaption, todayInSeoul } from "../lib/dates";
import { selectTopic } from "../lib/workspace";
import { AppChrome } from "./app-chrome";
import { TopicMenu, useTopicActions } from "./topic-actions";
import { TopicFieldEditor } from "./topic-field-editor";
import { CardSkeleton, TopicName, topicThreadStyle } from "./ui";
import { useTopicCards } from "./use-topic-cards";
import { useWorkspaceCards, WorkspaceSmallCard } from "./workspace-cards";
import { useWorkspace } from "./workspace-provider";

function ContextSection({ title, text, items }: { title: string; text?: string | null; items?: string[] }) {
  return <section className="detail-section"><h2>{title}</h2>{items ? (items.length > 0 ? <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="muted">아직 정리된 내용이 없어요.</p>) : <p className={text ? "" : "muted"}>{text || "아직 정리된 내용이 없어요."}</p>}</section>;
}

export function TopicBoard({ topicId }: { topicId: string }) {
  const { workspace, ready, update } = useWorkspace();
  const { onAction, notice, hasUndo } = useTopicActions();
  const { finishing, renderExpanded } = useWorkspaceCards();
  const { loading, error, generate } = useTopicCards(topicId);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const router = useRouter();
  const topic = workspace?.topics.find((item) => item.id === topicId);
  useEffect(() => { if (ready && !workspace) router.replace("/start"); else if (ready && workspace && !topic && !hasUndo) router.replace("/topics"); }, [ready, workspace, topic, hasUndo, router]);
  useEffect(() => { if (ready && topic) update((previous) => selectTopic(previous, topic.id, new Date().toISOString())); }, [ready, topic?.id, update]);
  if (!ready || !workspace) return <main className="app-loading" role="status">토픽을 불러오고 있어요.</main>;
  if (!topic) return <AppChrome active="topics"><main className="topic-board-page"><Link href="/topics" className="button button-quiet">← 토픽 목록으로</Link><p role="status">이 토픽은 목록에서 빠졌어요.</p></main>{notice}</AppChrome>;
  const today = workspace.sample?.baseline_date ?? todayInSeoul();
  const cards = visibleCards(workspace, today).filter((card) => card.nudge.topic_id === topicId);
  const finishingHere = finishing?.nudge.topic_id === topicId ? finishing : null;
  const hero = finishingHere ?? cards.find((card) => card.key === selectedKey) ?? cards[0];
  const remaining = cards.filter((card) => card.key !== hero?.key);
  const themeIndex = workspace.themes.findIndex((theme) => theme.name === topic.theme);
  const caption = deadlineCaption(topic.deadline, today);
  const sources = topic.sources.filter((source) => source !== "other").map((source) => source === "chatgpt" ? "ChatGPT" : "Claude");
  return <AppChrome active="topics"><main className="topic-board-page" style={topicThreadStyle(themeIndex)}>
    <Link href="/topics" className="button button-quiet back-link">← 토픽 목록으로</Link>
    <header className="topic-board-header"><div className="detail-eyebrow"><span className="chip">{topic.theme ?? "따로 뺀 토픽"}</span><span className="chip">{topic.state === "active" ? "활성" : "나중에"}</span></div><div className="topic-board-title"><h1><TopicName name={topic.name} themeIndex={themeIndex} starred={topic.starred} /></h1><TopicMenu topic={topic} workspace={workspace} onAction={onAction} /></div><p className="topic-one-liner">{topic.one_liner}</p>{caption && <p className="deadline-note">{caption} · {topic.deadline}{topic.deadline_label ? ` · ${topic.deadline_label}` : ""}</p>}</header>
    <section id="topic-card-main" className="topic-board-cards" aria-label="이 토픽의 한 걸음"><header className="section-heading"><h2>이 토픽의 한 걸음</h2></header>
      {error && <p className="app-error" role="alert">{error}</p>}
      {hero ? renderExpanded(hero) : loading ? <CardSkeleton /> : <div className="topic-card-empty"><p>필요할 때 이 토픽에서 이어갈 한 걸음을 받아보세요.</p><button type="button" className="button button-primary" onClick={() => void generate()}>이 토픽의 한 걸음 받기</button></div>}
      {remaining.length > 0 && <div className="today-card-list">{remaining.map((card) => <WorkspaceSmallCard key={card.key} card={card} onClick={() => { setSelectedKey(card.key); document.getElementById("topic-card-main")?.scrollIntoView({ block: "start", behavior: "auto" }); }} />)}</div>}
    </section>
    <div className="topic-board-context">
      <TopicFieldEditor key={`${topicId}-status`} topicId={topicId} field="status_text" title="지금 상태" value={topic.status_text} />
      <TopicFieldEditor key={`${topicId}-steps`} topicId={topicId} field="next_steps" title="다음 할 일" value={topic.next_steps} />
      <ContextSection title="막힌 점" text={topic.blockers} />
      <details className="topic-more-context animated-disclosure"><summary>더 보기</summary><div className="disclosure-content"><div className="topic-more-sections">
        <ContextSection title="목표" text={topic.goal} /><ContextSection title="지금까지 만든 것" items={topic.outputs} /><ContextSection title="최근 결정" items={topic.recent_decisions} />
        {topic.related.length > 0 && <ContextSection title="관련 대화 주제" items={topic.related} />}{sources.length > 0 && <ContextSection title="출처" items={sources} />}{topic.deadline_text && <ContextSection title="그 밖의 일정" text={topic.deadline_text} />}{Boolean(topic.notes?.length) && <ContextSection title="남겨둔 메모" items={topic.notes} />}
      </div></div></details>
    </div>
  </main>{notice}</AppChrome>;
}
