"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { completedDate, completedSteps } from "../lib/history";
import type { CompletedStep } from "../lib/history";
import { AppChrome } from "./app-chrome";
import { useWorkspace } from "./workspace-provider";

export function Done() {
  const { workspace, ready } = useWorkspace();
  const router = useRouter();
  useEffect(() => { if (ready && !workspace) router.replace("/start"); }, [ready, workspace, router]);
  if (!ready || !workspace) return <main className="app-loading" role="status">지나온 걸음을 불러오고 있어요.</main>;
  const groups = new Map<string, CompletedStep[]>();
  for (const step of completedSteps(workspace)) {
    const date = completedDate(step.completed_at);
    groups.set(date, [...(groups.get(date) ?? []), step]);
  }
  return <AppChrome active="done"><main className="done-page"><header className="done-heading"><h1>지나온 걸음</h1><p className="muted">마친 한 걸음을 날짜별로 모았어요.</p></header>
    {groups.size === 0 ? <section className="done-empty"><h2>아직 지나온 걸음이 없어요.</h2><p className="muted">카드를 마치면 이곳에 남아요.</p></section> : [...groups].map(([date, steps]) => <section className="done-date-group" key={date}><h2><time dateTime={date}>{new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(new Date(`${date}T00:00:00+09:00`))}</time></h2><ul className="done-list">{steps.map((step) => <li className="done-step" key={step.id}><p className="done-topic">{step.topic_name}</p><h3>{step.title}</h3>{step.note && <p className="done-note">{step.note}</p>}</li>)}</ul></section>)}
  </main></AppChrome>;
}
