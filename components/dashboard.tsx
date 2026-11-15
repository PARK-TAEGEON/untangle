"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getCardState, isAcceptedUnfinished, visibleCards } from "../lib/card-state";
import { AppChrome } from "./app-chrome";
import { CardEmpty, CardSkeleton } from "./ui";
import { useCards } from "./use-cards";
import { useWorkspaceCards, WorkspaceSmallCard } from "./workspace-cards";
import { useWorkspace } from "./workspace-provider";
import { usePreferences } from "./use-preferences";

export function Dashboard() {
  const { cardLimit } = usePreferences();
  const { workspace, ready, update } = useWorkspace();
  const [leavingSample, setLeavingSample] = useState(false);
  const { today, loading, generate } = useCards(!leavingSample && Boolean(workspace?.topics.length));
  const { finishing, renderExpanded } = useWorkspaceCards();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const router = useRouter();
  useEffect(() => { if (ready && (!workspace || workspace.topics.length === 0)) router.replace("/welcome"); }, [ready, workspace, router]);
  if (!ready || !workspace || workspace.topics.length === 0) return <main className="app-loading" role="status">저장한 프로젝트를 불러오고 있어요.</main>;
  const cards = visibleCards(workspace, today);
  const hero = finishing ?? cards.find((card) => card.key === selectedKey) ?? cards.find((card) => card.nudge.slot === "focus" && !isAcceptedUnfinished(card)) ?? cards[0];
  const remaining = cards.filter((card) => card.key !== hero?.key).slice(0, cardLimit - 1);
  const error = getCardState(workspace).error;

  function promote(key: string) {
    setSelectedKey(key);
    if (error) update((previous) => ({ ...previous, cards: { ...getCardState(previous), error: null } }));
    document.getElementById("home-main")?.scrollIntoView({ block: "start", behavior: "auto" });
  }

  return <AppChrome active="today" onBeforeSampleExit={() => setLeavingSample(true)} onSampleExitFailed={() => setLeavingSample(false)}>
    <main id="home-main" className="today-page">
      <div className="home-intro"><div className="home-title"><h1 lang="en">One thread at a time.</h1></div><button type="button" className="button button-secondary" disabled={loading} onClick={() => void generate()}>{loading ? "준비하고 있어요" : "새 제안 받기"}</button></div>
      <div className={`today-columns${remaining.length > 0 || (error && cards.length > 0) ? " has-aside" : ""}`}>
        <div className="today-primary">{loading ? <CardSkeleton /> : error ? <CardEmpty failed message={error} onGenerate={() => void generate()} /> : hero ? renderExpanded(hero) : <CardEmpty onGenerate={() => void generate()} />}</div>
        {(remaining.length > 0 || (error && cards.length > 0)) && <aside className="today-other-cards">
          {!error && remaining.length > 0 && <section className="today-card-list" aria-label="다른 한 걸음"><header className="section-heading"><h2>다른 한 걸음</h2><span className="count-chip">{remaining.length}</span></header>{remaining.map((card) => <WorkspaceSmallCard key={card.key} card={card} onClick={() => promote(card.key)} />)}</section>}
          {error && cards.length > 0 && <section className="today-card-list" aria-label="저장된 제안"><h2>저장된 제안</h2>{cards.slice(0, cardLimit).map((card) => <WorkspaceSmallCard key={card.key} card={card} onClick={() => promote(card.key)} />)}</section>}
        </aside>}
      </div>
    </main>
  </AppChrome>;
}
