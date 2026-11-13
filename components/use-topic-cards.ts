"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyTopicGeneratedCards, buildTopicCardInput, clearTopicCardGeneration,
  getCardState, getTopicCardRequestId, markTopicCardGeneration,
} from "../lib/card-state";
import type { CardInput, Nudge } from "../lib/card-types";
import { todayInSeoul } from "../lib/dates";
import { advanceSampleTopicCards } from "../lib/sample-mode";
import { isWorkspaceCardRequestActive } from "./use-cards";
import { useWorkspace } from "./workspace-provider";

interface ActiveRequest { promise: Promise<void>; error: string | null }
const activeRequests = new Map<string, ActiveRequest>();
const failureMessage = "초안을 준비하지 못했어요. 다시 시도해 주세요.";

/** No automatic generation: the board calls generate only in response to its button. */
export function useTopicCards(topicId: string): { loading: boolean; error: string | null; generate: () => Promise<void> } {
  const { workspace, ready, update } = useWorkspace();
  const current = useRef(workspace);
  current.current = workspace;
  const mounted = useRef(false);
  const selectedTopic = useRef(topicId);
  selectedTopic.current = topicId;
  const activeToken = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const requestId = workspace ? getTopicCardRequestId(workspace, topicId) : null;
  useEffect(() => { setError(null); activeToken.current = null; }, [topicId]);
  useEffect(() => {
    const request = requestId === null ? undefined : activeRequests.get(requestId);
    setLoading(Boolean(request));
    if (!request) return;
    activeToken.current = requestId;
    let observing = true;
    void request.promise.finally(() => {
      if (observing) { setLoading(false); setError(request.error); }
    });
    return () => { observing = false; };
  }, [topicId, requestId]);

  const generate = useCallback(async () => {
    if (!ready || !current.current) return;
    let input: CardInput | undefined;
    let sourceIsSample = false;
    let existing: ActiveRequest | undefined;
    let existingToken: string | null = null;
    let problem: string | null = null;
    const token = crypto.randomUUID();
    const saved = update((previous) => {
      try {
        const date = previous.sample?.baseline_date ?? todayInSeoul();
        input = buildTopicCardInput(previous, topicId, date);
        const previousToken = getTopicCardRequestId(previous, topicId);
        existing = previousToken === null ? undefined : activeRequests.get(previousToken);
        if (existing) { existingToken = previousToken; return previous; }
        if (isWorkspaceCardRequestActive(getCardState(previous).request_id)) {
          problem = "오늘 초안 준비를 마친 뒤 다시 시도해 주세요.";
          return previous;
        }
        sourceIsSample = Boolean(previous.sample);
        return markTopicCardGeneration(previous, topicId, token);
      } catch (cause) {
        problem = cause instanceof Error ? cause.message : failureMessage;
        return previous;
      }
    });
    if (problem || !saved || !input) {
      setError(problem ?? "초안을 저장할 수 없어요. 브라우저 저장소를 확인해 주세요.");
      return;
    }
    if (existing) {
      activeToken.current = existingToken;
      setLoading(true);
      await existing.promise;
      if (mounted.current && selectedTopic.current === topicId && activeToken.current === existingToken) { setLoading(false); setError(existing.error); }
      return;
    }
    activeToken.current = token;
    setLoading(true);
    setError(null);
    const requestInput = input;
    const request: ActiveRequest = { promise: Promise.resolve(), error: null };
    const task = Promise.resolve().then(async () => {
      try {
        if (sourceIsSample) {
          if (!update((previous) => getTopicCardRequestId(previous, topicId) === token
            ? advanceSampleTopicCards(previous, topicId, new Date().toISOString(), token) : previous)) {
            request.error = "초안을 저장할 수 없어요. 브라우저 저장소를 확인해 주세요.";
          }
          return;
        }
        const response = await fetch("/api/cards", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestInput),
        });
        const body = await response.json() as { nudges?: Nudge[]; error?: string };
        if (!response.ok || !Array.isArray(body.nudges)) {
          request.error = typeof body.error === "string" ? body.error : failureMessage;
          throw new Error(request.error);
        }
        if (!update((previous) => applyTopicGeneratedCards(previous, topicId, body.nudges!, new Date().toISOString(), token))) {
          request.error = "초안을 저장할 수 없어요. 브라우저 저장소를 확인해 주세요.";
        }
      } catch {
        request.error ??= failureMessage;
        let relevant = false;
        update((previous) => {
          relevant = getTopicCardRequestId(previous, topicId) === token;
          return clearTopicCardGeneration(previous, topicId, token);
        });
        if (!relevant) request.error = null;
      }
    }).finally(() => { activeRequests.delete(token); });
    request.promise = task;
    activeRequests.set(token, request);
    try {
      await task;
    } finally {
      if (mounted.current && selectedTopic.current === topicId && activeToken.current === token) { setLoading(false); setError(request.error); }
    }
  }, [ready, topicId, update]);

  return { loading, error, generate };
}
