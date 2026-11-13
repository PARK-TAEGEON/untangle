"use client";

import { useEffect, useRef, useState } from "react";
import { acceptCard, answerCard, completeCard, continueAcceptedCard, dismissCard, isAcceptedUnfinished, isStaleAccepted, snoozeCard, updateCardContent } from "../lib/card-state";
import type { SavedCard } from "../lib/card-state";
import { todayInSeoul } from "../lib/dates";
import type { WorkspaceData } from "../lib/workspace";
import { ProposalCard, SmallProposal } from "./proposal-card";
import { useWorkspace } from "./workspace-provider";

function cardTopic(workspace: WorkspaceData | null, card: SavedCard) {
  return workspace?.topics.find((topic) => topic.id === card.nudge.topic_id);
}

export function WorkspaceSmallCard({ card, onClick, selected = false }: { card: SavedCard; onClick: () => void; selected?: boolean }) {
  const { workspace } = useWorkspace();
  const topic = cardTopic(workspace, card);
  const themeIndex = topic ? workspace?.themes.findIndex((theme) => theme.name === topic.theme) ?? -1 : -1;
  return <SmallProposal nudge={card.nudge} topic={topic} themeIndex={themeIndex} accepted={isAcceptedUnfinished(card)} stale={isStaleAccepted(card, new Date().toISOString())} selected={selected} onClick={onClick} />;
}

/** Both pages use the same saved card and actions, including the short completion animation. */
export function useWorkspaceCards() {
  const { workspace, update } = useWorkspace();
  const [finishing, setFinishing] = useState<SavedCard | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  function finish(card: SavedCard, change: (previous: WorkspaceData) => WorkspaceData) {
    if (!update(change)) return;
    setFinishing(card);
    if (timer.current) clearTimeout(timer.current);
    const value = getComputedStyle(document.documentElement).getPropertyValue("--motion-thread").trim();
    const duration = value.endsWith("ms") ? Number.parseFloat(value) : Number.parseFloat(value) * 1000;
    timer.current = setTimeout(() => setFinishing(null), Number.isFinite(duration) ? duration : 500);
  }
  function renderExpanded(card: SavedCard) {
    const topic = cardTopic(workspace, card);
    const themeIndex = topic ? workspace?.themes.findIndex((theme) => theme.name === topic.theme) ?? -1 : -1;
    return <ProposalCard key={card.key} nudge={card.nudge} topic={topic} themeIndex={themeIndex} content={card.content} accepted={isAcceptedUnfinished(card)} stale={isStaleAccepted(card, new Date().toISOString())} finishing={finishing?.key === card.key}
      onContentChange={(content) => update((previous) => updateCardContent(previous, card.key, content))}
      onAccept={() => update((previous) => acceptCard(previous, card.key, new Date().toISOString()))}
      onComplete={(note) => finish(card, (previous) => completeCard(previous, card.key, note, new Date().toISOString()))}
      onSnooze={() => update((previous) => snoozeCard(previous, card.key, previous.sample?.baseline_date ?? todayInSeoul()))}
      onDismiss={() => update((previous) => dismissCard(previous, card.key, new Date().toISOString()))}
      onAnswer={(id) => finish(card, (previous) => answerCard(previous, card.key, id, new Date().toISOString()))}
      onContinue={() => update((previous) => continueAcceptedCard(previous, card.key, new Date().toISOString()))} />;
  }
  return { finishing, renderExpanded };
}
