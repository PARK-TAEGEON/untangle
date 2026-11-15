"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { applyGeneratedCards, buildWorkspaceCardInput, failCardGeneration, getCardState, markCardGeneration, shouldGenerateCards } from "../lib/card-state";
import type { Nudge } from "../lib/card-types";
import { todayInSeoul } from "../lib/dates";
import { useWorkspace } from "./workspace-provider";
import { advanceSampleCards } from "../lib/sample-mode";
import { saveTodayRoster } from "../lib/today-roster";
import type { WorkspaceData } from "../lib/workspace";

// Route changes and StrictMode effect replay must not cancel a paid request already started.
// Only promises live here; persisted request IDs determine whether their result is still current.
const activeRequests = new Map<string, Promise<void>>();

/** A persisted token alone may belong to an interrupted document, rather than a live request. */
export function isWorkspaceCardRequestActive(requestId: string | null | undefined): boolean {
  return Boolean(requestId && activeRequests.has(requestId));
}

/** Only the initial/daily visit and an explicit button may start a generation. */
export function useCards(enabled = true) {
  const { workspace, ready, update, mode } = useWorkspace();
  const [loading, setLoading] = useState(false);
  const [today, setToday] = useState(todayInSeoul);
  const current = useRef(workspace);
  const busy = useRef(false);
  const activeToken = useRef<string | null>(null);
  const activeSource = useRef(workspace);
  const mounted = useRef(false);
  current.current = workspace;

  useEffect(() => {
    mounted.current = true;
    const onFocus = () => setToday(todayInSeoul());
    window.addEventListener("focus", onFocus);
    const onVisible = () => { if (document.visibilityState === "visible") onFocus(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const generate = useCallback(async (manual = false) => {
    const source = current.current;
    const date = todayInSeoul();
    setToday(date);
    if (!enabled || !source || source.topics.length === 0 || busy.current || (!manual && !shouldGenerateCards(source, date))) return;
    if (mode === "sample" || source.sample) {
      let applied: WorkspaceData | null = null;
      const saved = source.sample && update((previous) => {
        if (!previous.sample) return previous;
        const next = advanceSampleCards(previous, new Date().toISOString(), date);
        if (next !== previous) applied = next;
        return next;
      });
      if (saved && applied) saveTodayRoster(applied, date);
      return;
    }
    const requestId = crypto.randomUUID();
    // Persist the attempt before awaiting, including failures and a successful empty result.
    if (!update((previous) => markCardGeneration(previous, date, requestId))) return;
    activeSource.current = source;
    busy.current = true;
    activeToken.current = requestId;
    setLoading(true);
    const task = Promise.resolve().then(async () => {
      let failure = "초안을 준비하지 못했어요. 다시 시도해 주세요.";
      try {
        const input = buildWorkspaceCardInput(source, date);
        const response = await fetch("/api/cards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
        const body = await response.json() as { nudges?: Nudge[]; error?: string };
        if (!response.ok || !Array.isArray(body.nudges)) {
          if (typeof body.error === "string") failure = body.error;
          throw new Error(failure);
        }
        let applied: WorkspaceData | null = null;
        const saved = update((previous) => {
          const next = applyGeneratedCards(previous, body.nudges!, new Date().toISOString(), date, requestId);
          if (next !== previous) applied = next;
          return next;
        });
        if (saved && applied) saveTodayRoster(applied, date);
      } catch {
        update((previous) => failCardGeneration(previous, failure, requestId));
      }
    }).finally(() => activeRequests.delete(requestId));
    activeRequests.set(requestId, task);
    try { await task; } finally {
      if (activeToken.current === requestId) {
        busy.current = false;
        activeToken.current = null;
        if (mounted.current) setLoading(false);
      }
    }
  }, [update, mode, enabled]);

  const requestId = workspace ? getCardState(workspace).request_id : null;
  useEffect(() => {
    if (activeToken.current !== null && activeToken.current !== requestId && workspace !== activeSource.current) {
      activeToken.current = null;
      busy.current = false;
      setLoading(false);
    }
    if (!ready || !requestId || mode === "sample" || workspace?.sample) return;
    const task = activeRequests.get(requestId);
    if (!task) {
      // A full reload can interrupt fetch. Keep its token so another live tab can still finish it.
      update((previous) => getCardState(previous).request_id === requestId && !getCardState(previous).error
        ? { ...previous, cards: { ...getCardState(previous), error: "초안 준비를 끝내지 못했어요. 다시 시도해 주세요." } } : previous);
      return;
    }
    busy.current = true;
    activeToken.current = requestId;
    setLoading(true);
    void task.finally(() => {
      if (activeToken.current === requestId) {
        busy.current = false;
        activeToken.current = null;
        if (mounted.current) setLoading(false);
      }
    });
  }, [ready, requestId, update, mode, workspace?.sample]);

  useEffect(() => { if (enabled && ready && workspace && !loading && shouldGenerateCards(workspace, today)) void generate(); }, [enabled, ready, workspace, today, loading, generate]);
  return { loading, today: workspace?.sample?.baseline_date ?? today, generate: () => generate(true) };
}
