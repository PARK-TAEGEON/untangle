"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { deadlineCaption, todayInSeoul } from "../lib/dates";
import { selectTopic, setLaterCollapsed, setThemeCollapsed, sortTopics, toggleStar } from "../lib/workspace";
import type { WorkspaceData, WorkspaceTopic } from "../lib/workspace";
import { AppChrome } from "./app-chrome";
import { IconButton } from "./icons";
import { TopicMenu, useTopicActions } from "./topic-actions";
import type { TopicAction } from "./topic-actions";
import { TopicName } from "./ui";
import { useWorkspace } from "./workspace-provider";

function TopicTile({ topic, workspace, today, onAction }: { topic: WorkspaceTopic; workspace: WorkspaceData; today: string; onAction: TopicAction }) {
  const { update } = useWorkspace();
  const themeIndex = workspace.themes.findIndex((theme) => theme.name === topic.theme);
  const caption = deadlineCaption(topic.deadline, today);
  const sources = topic.sources.filter((source) => source !== "other").map((source) => source === "chatgpt" ? "ChatGPT" : "Claude").join(" · ");
  const starLimit = !topic.starred && workspace.topics.filter((item) => item.starred).length >= 3;
  return <li className="topic-tile"><Link className="topic-tile-link" href={`/topics/${encodeURIComponent(topic.id)}`} onClick={() => update((previous) => selectTopic(previous, topic.id, new Date().toISOString()))}>
    <TopicName name={topic.name} themeIndex={themeIndex} /><p className="topic-tile-description">{topic.one_liner}</p>
    {(caption || sources) && <span className="topic-tile-meta">{caption && <span>{caption}</span>}{sources && <span>{sources}</span>}</span>}
  </Link><div className="topic-tile-actions"><IconButton icon="star" label={`${topic.name} ${topic.starred ? "별 해제" : starLimit ? "별 표시 (최대 3개)" : "별 표시"}`} aria-pressed={topic.starred} disabled={starLimit} onClick={() => update((previous) => toggleStar(previous, topic.id))} /><TopicMenu topic={topic} workspace={workspace} onAction={onAction} /></div></li>;
}

export function Topics() {
  const { workspace, ready, update } = useWorkspace();
  const { onAction, notice } = useTopicActions();
  const router = useRouter();
  useEffect(() => { if (ready && !workspace) router.replace("/start"); }, [ready, workspace, router]);
  if (!ready || !workspace) return <main className="app-loading" role="status">저장한 토픽을 불러오고 있어요.</main>;
  const today = workspace.sample?.baseline_date ?? todayInSeoul();
  const active = workspace.topics.filter((topic) => topic.state === "active");
  const later = sortTopics(workspace.topics.filter((topic) => topic.state === "later"));
  const themes = workspace.themes.filter((theme) => active.some((topic) => topic.theme === theme.name));
  const separate = sortTopics(active.filter((topic) => topic.theme === null));
  return <AppChrome active="topics"><main className="topics-page">
    <header className="topics-heading"><div><p className="eyebrow">각자의 속도로 이어가는 일</p><h1>나의 토픽</h1></div><span className="count-chip">활성 {active.length}</span></header>
    {workspace.topics.length === 0 && <section className="topics-empty"><h2>아직 담긴 토픽이 없어요.</h2><p>대화에서 진행하던 일을 가져와 보세요.</p><Link href="/start" className="button button-primary">대화에서 가져오기</Link></section>}
    <div className="topics-groups">{themes.map((theme) => {
      const members = sortTopics(active.filter((topic) => topic.theme === theme.name));
      const index = workspace.themes.findIndex((item) => item.name === theme.name);
      return <section className={`theme-box thread-color-${index % 8 + 1}`} key={theme.name}><h2 className="theme-box-header"><button type="button" className="group-toggle" aria-expanded={!theme.collapsed} onClick={() => update((previous) => setThemeCollapsed(previous, theme.name, !theme.collapsed))}><span aria-hidden="true">{theme.collapsed ? "+" : "−"}</span><span>{theme.name}</span><span className="group-count">{members.length}</span></button></h2>{!theme.collapsed && <ul className="topics-grid theme-topic-list">{members.map((topic) => <TopicTile key={topic.id} topic={topic} workspace={workspace} today={today} onAction={onAction} />)}</ul>}</section>;
    })}{separate.length > 0 && <section className="theme-box"><h2 className="theme-box-header">따로 뺀 토픽 <span className="count-chip">{separate.length}</span></h2><ul className="topics-grid theme-topic-list">{separate.map((topic) => <TopicTile key={topic.id} topic={topic} workspace={workspace} today={today} onAction={onAction} />)}</ul></section>}</div>
    <section className="topics-later"><button className="group-toggle" type="button" aria-expanded={!workspace.later_collapsed} onClick={() => update((previous) => setLaterCollapsed(previous, !previous.later_collapsed))}><span aria-hidden="true">{workspace.later_collapsed ? "+" : "−"}</span><span>나중에</span><span className="group-count">{later.length}</span></button>{!workspace.later_collapsed && (later.length > 0 ? <ul className="topics-grid theme-topic-list">{later.map((topic) => <TopicTile key={topic.id} topic={topic} workspace={workspace} today={today} onAction={onAction} />)}</ul> : <p className="muted">나중에 볼 토픽이 없어요.</p>)}</section>
  </main>{notice}</AppChrome>;
}
