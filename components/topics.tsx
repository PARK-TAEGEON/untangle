"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
  const starLimit = !topic.starred && workspace.topics.filter((item) => item.starred).length >= 3;
  return <li className="topic-tile"><Link className="topic-tile-link" href={`/topics/${encodeURIComponent(topic.id)}`} onClick={() => update((previous) => selectTopic(previous, topic.id, new Date().toISOString()))}>
    <TopicName name={topic.name} themeIndex={themeIndex} /><p className="topic-tile-description">{topic.one_liner}</p>
    {caption && <span className="topic-tile-meta"><span>{caption}</span></span>}
  </Link><div className="topic-tile-actions"><IconButton icon="star" label={`${topic.name} ${topic.starred ? "별 해제" : starLimit ? "별 표시 (최대 3개)" : "별 표시"}`} aria-pressed={topic.starred} disabled={starLimit} onClick={() => update((previous) => toggleStar(previous, topic.id))} /><TopicMenu topic={topic} workspace={workspace} onAction={onAction} /></div></li>;
}

export function Topics() {
  const { workspace, ready, update } = useWorkspace();
  const [query, setQuery] = useState("");
  const { onAction, notice } = useTopicActions();
  const router = useRouter();
  useEffect(() => { if (ready && !workspace) router.replace("/start"); }, [ready, workspace, router]);
  if (!ready || !workspace) return <main className="app-loading" role="status">저장한 토픽을 불러오고 있어요.</main>;
  const today = workspace.sample?.baseline_date ?? todayInSeoul();
  const search = query.trim().normalize("NFC").toLowerCase();
  const searching = search.length > 0;
  const matches = (topic: WorkspaceTopic) => !searching || [topic.name, topic.one_liner].some((text) => text.normalize("NFC").toLowerCase().includes(search));
  const active = workspace.topics.filter((topic) => topic.state === "active" && matches(topic));
  const later = sortTopics(workspace.topics.filter((topic) => topic.state === "later" && matches(topic)));
  const themes = workspace.themes.filter((theme) => active.some((topic) => topic.theme === theme.name));
  const separate = sortTopics(active.filter((topic) => topic.theme === null));
  const laterExpanded = searching || !workspace.later_collapsed;
  return <AppChrome active="topics"><main className={`topics-page${searching ? " topics-searching" : ""}`}>
    <header className="topics-heading"><div><p className="eyebrow">각자의 속도로 이어가는 일</p><h1>현재 토픽</h1></div><span className="count-chip" role="status">{searching ? `검색 결과 ${active.length + later.length}` : `활성 ${active.length}`}</span></header>
    <div className="topic-search"><label htmlFor="topic-search-input">토픽 검색</label><div className="topic-search-controls"><input id="topic-search-input" type="search" aria-label="토픽 검색" placeholder="이름이나 한 줄 설명으로 검색" value={query} autoComplete="off" onChange={(event) => setQuery(event.target.value)} />{query.length > 0 && <button type="button" className="button button-quiet" onClick={() => setQuery("")}>검색 지우기</button>}</div></div>
    {workspace.topics.length === 0 && !searching && <section className="topics-empty"><h2>아직 담긴 토픽이 없어요.</h2><p>대화에서 진행하던 일을 가져와 보세요.</p><Link href="/start" className="button button-primary">대화에서 가져오기</Link></section>}
    {searching && active.length + later.length === 0 && <section className="topics-empty"><h2>찾는 토픽이 없어요.</h2><p>다른 이름이나 설명으로 검색해 보세요.</p></section>}
    <div className="topics-groups">{themes.map((theme) => {
      const members = sortTopics(active.filter((topic) => topic.theme === theme.name));
      const index = workspace.themes.findIndex((item) => item.name === theme.name);
      const expanded = searching || !theme.collapsed;
      return <section className={`theme-box thread-color-${index % 8 + 1}`} key={theme.name}><h2 className="theme-box-header"><button type="button" className="group-toggle" aria-expanded={expanded} disabled={searching} onClick={() => update((previous) => setThemeCollapsed(previous, theme.name, !theme.collapsed))}><span aria-hidden="true">{expanded ? "−" : "+"}</span><span>{theme.name}</span><span className="group-count">{members.length}</span></button></h2>{expanded && <ul className="topics-grid theme-topic-list">{members.map((topic) => <TopicTile key={topic.id} topic={topic} workspace={workspace} today={today} onAction={onAction} />)}</ul>}</section>;
    })}{separate.length > 0 && <section className="theme-box"><h2 className="theme-box-header">따로 뺀 토픽 <span className="count-chip">{separate.length}</span></h2><ul className="topics-grid theme-topic-list">{separate.map((topic) => <TopicTile key={topic.id} topic={topic} workspace={workspace} today={today} onAction={onAction} />)}</ul></section>}</div>
    {(!searching || later.length > 0) && <section className="topics-later"><button className="group-toggle" type="button" aria-expanded={laterExpanded} disabled={searching} onClick={() => update((previous) => setLaterCollapsed(previous, !previous.later_collapsed))}><span aria-hidden="true">{laterExpanded ? "−" : "+"}</span><span>나중에</span><span className="group-count">{later.length}</span></button>{laterExpanded && (later.length > 0 ? <ul className="topics-grid theme-topic-list">{later.map((topic) => <TopicTile key={topic.id} topic={topic} workspace={workspace} today={today} onAction={onAction} />)}</ul> : <p className="muted">나중에 볼 토픽이 없어요.</p>)}</section>}
  </main>{notice}</AppChrome>;
}
