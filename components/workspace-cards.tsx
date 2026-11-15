"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { acceptCard, answerCard, completeCard, continueAcceptedCard, dismissCard, getCardState, isAcceptedUnfinished, isStaleAccepted, snoozeCard, updateCardContent } from "../lib/card-state";
import type { SavedCard } from "../lib/card-state";
import { todayInSeoul } from "../lib/dates";
import type { WorkspaceData } from "../lib/workspace";
import { ProposalCard, SmallProposal } from "./proposal-card";
import { useWorkspace } from "./workspace-provider";
import { FocusCard } from "./focus-card";

function cardTopic(workspace: WorkspaceData | null, card: SavedCard) {
  return workspace?.topics.find((topic) => topic.id === card.nudge.topic_id);
}

export function WorkspaceSmallCard({ card, onClick, selected = false }: { card: SavedCard; onClick: () => void; selected?: boolean }) {
  const { workspace } = useWorkspace();
  const topic = cardTopic(workspace, card);
  const themeIndex = topic ? workspace?.themes.findIndex((theme) => theme.name === topic.theme) ?? -1 : -1;
  return <SmallProposal cardKey={card.key} nudge={card.nudge} topic={topic} themeIndex={themeIndex} accepted={isAcceptedUnfinished(card)} stale={isStaleAccepted(card, new Date().toISOString())} selected={selected} onClick={onClick} />;
}

function motionDuration(property: "--motion-fast" | "--motion-thread"): number {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return 0;
  const value = getComputedStyle(document.documentElement).getPropertyValue(property).trim();
  const duration = value.endsWith("ms") ? Number.parseFloat(value) : Number.parseFloat(value) * 1000;
  return Number.isFinite(duration) ? Math.min(300, Math.max(0, duration)) : 200;
}

interface PendingExit {
  card: SavedCard;
  kind: "snooze" | "dismiss";
  timer: ReturnType<typeof setTimeout> | null;
  commit: () => void;
}

interface FocusSession { expected: SavedCard; trigger: HTMLElement | null }

/** Both pages use the same saved card and actions, including the short completion animation. */
export function useWorkspaceCards() {
  const { workspace, update } = useWorkspace();
  const [finishing, setFinishing] = useState<SavedCard | null>(null);
  const [leaving, setLeaving] = useState<PendingExit | null>(null);
  const [focus, setFocus] = useState<FocusSession | null>(null);
  const [focusError, setFocusError] = useState<string | null>(null);
  const focusedCard = focus && workspace ? getCardState(workspace).items.find((card) => card === focus.expected && isAcceptedUnfinished(card)
    && workspace.topics.some((topic) => topic.id === card.nudge.topic_id)) ?? null : null;
  useEffect(() => { if (focus && !focusedCard) setFocus(null); }, [focus, focusedCard]);
  const pendingExit = useRef<PendingExit | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const flush = () => pendingExit.current?.commit();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      if (timer.current) clearTimeout(timer.current);
      // Navigation must not cancel an action already chosen during the brief exit.
      flush();
    };
  }, []);
  function finish(card: SavedCard, change: (previous: WorkspaceData) => WorkspaceData) {
    if (pendingExit.current) return;
    if (!update(change)) return;
    setFinishing(card);
    if (timer.current) clearTimeout(timer.current);
    const duration = motionDuration("--motion-thread");
    if (duration === 0) setFinishing(null);
    else timer.current = setTimeout(() => setFinishing(null), duration);
  }
  function leave(card: SavedCard, kind: PendingExit["kind"]) {
    if (pendingExit.current || finishing) return;
    const pending: PendingExit = { card, kind, timer: null, commit: () => {} };
    pending.commit = () => {
      if (pendingExit.current !== pending) return;
      pendingExit.current = null;
      if (pending.timer) clearTimeout(pending.timer);
      update((previous) => {
        // A replacement/import or another tab's changed card takes precedence.
        if (getCardState(previous).items.find((item) => item.key === card.key) !== card) return previous;
        return kind === "snooze"
          ? snoozeCard(previous, card.key, previous.sample?.baseline_date ?? todayInSeoul())
          : dismissCard(previous, card.key, new Date().toISOString());
      });
      setLeaving(null);
    };
    pendingExit.current = pending;
    const duration = motionDuration("--motion-fast");
    if (duration === 0) pending.commit();
    else {
      setLeaving(pending);
      pending.timer = setTimeout(pending.commit, duration);
    }
  }
  function startFocus(card: SavedCard) {
    if (pendingExit.current || finishing) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let accepted: SavedCard | undefined;
    const saved = update((previous) => {
      if (getCardState(previous).items.find((item) => item.key === card.key) !== card) return previous;
      const next = acceptCard(previous, card.key, new Date().toISOString());
      accepted = getCardState(next).items.find((item) => item.key === card.key && isAcceptedUnfinished(item));
      return next;
    });
    if (saved && accepted) { setFocusError(null); setFocus({ expected: accepted, trigger }); }
  }
  function resumeFocus(card: SavedCard) {
    if (pendingExit.current || finishing || !isAcceptedUnfinished(card)) return;
    setFocusError(null);
    setFocus({ expected: card, trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null });
  }
  function changeFocus(change: (previous: WorkspaceData, key: string) => WorkspaceData, completing = false) {
    if (!focus) return;
    let changed: SavedCard | undefined;
    const saved = update((previous) => {
      if (getCardState(previous).items.find((item) => item.key === focus.expected.key) !== focus.expected) return previous;
      const next = change(previous, focus.expected.key);
      changed = getCardState(next).items.find((item) => item.key === focus.expected.key);
      return next;
    });
    if (!saved) { setFocusError(completing ? "완료를 저장하지 못했어요. 다시 시도해 주세요." : "초안을 저장하지 못했어요. 다시 시도해 주세요."); return; }
    if (!changed) { setFocus(null); return; }
    focus.expected = changed;
    setFocusError(null);
    if (completing && changed.status === "completed") setFocus(null);
  }
  function renderExpanded(card: SavedCard) {
    const topic = cardTopic(workspace, card);
    const themeIndex = topic ? workspace?.themes.findIndex((theme) => theme.name === topic.theme) ?? -1 : -1;
    return <Fragment key={card.key}><ProposalCard cardKey={card.key} nudge={card.nudge} topic={topic} themeIndex={themeIndex} content={card.content} accepted={isAcceptedUnfinished(card)} stale={isStaleAccepted(card, new Date().toISOString())} finishing={finishing?.key === card.key} leaving={leaving?.card.key === card.key ? leaving.kind : undefined}
      onContentChange={(content) => update((previous) => updateCardContent(previous, card.key, content))}
      onAccept={() => startFocus(card)}
      onComplete={(note) => finish(card, (previous) => completeCard(previous, card.key, note, new Date().toISOString()))}
      onSnooze={() => leave(card, "snooze")}
      onDismiss={() => leave(card, "dismiss")}
      onAnswer={(id) => finish(card, (previous) => answerCard(previous, card.key, id, new Date().toISOString()))}
      onContinue={() => update((previous) => continueAcceptedCard(previous, card.key, new Date().toISOString()))}
      onFocus={() => resumeFocus(card)} />
      {focus && focusedCard && focusedCard.key === card.key && <FocusCard card={focusedCard} trigger={focus.trigger} error={focusError}
        onChange={(content) => changeFocus((previous, key) => updateCardContent(previous, key, content))}
        onComplete={(content) => changeFocus((previous, key) => completeCard(updateCardContent(previous, key, content), key, null, new Date().toISOString()), true)}
        onExit={() => setFocus(null)} />}
    </Fragment>;
  }
  return { finishing: focusedCard ?? leaving?.card ?? finishing, renderExpanded };
}
