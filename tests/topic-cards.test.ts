// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTopicCards } from "../components/use-topic-cards";
import { useCards } from "../components/use-cards";
import { useWorkspace, WorkspaceProvider } from "../components/workspace-provider";
import {
  acceptCard, applyGeneratedCards, applyTopicGeneratedCards, buildTopicCardInput, buildWorkspaceCardInput,
  getCardState, getTopicCardRequestId, markTopicCardGeneration, restoreRemovedTopic, snapshotTopicRemoval,
  snoozeCard, updateCardContent,
} from "../lib/card-state";
import type { Nudge } from "../lib/card-types";
import { parseExport } from "../lib/parse";
import { loadWorkspace, saveWorkspace, WORKSPACE_STORAGE_KEY } from "../lib/storage";
import { confirmOnboarding, removeTopic, selectTopic, setTopicState } from "../lib/workspace";
import type { WorkspaceData } from "../lib/workspace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const TODAY = "2026-11-12";
const NOW = "2026-11-12T12:00:00.000Z";
const card: Nudge = {
  id: "n1", slot: "focus", topic_id: "t1", new_topic_name: null, type: "continue",
  title: "초안 확인하기", action: "준비된 초안을 확인해 주세요.", est_minutes: 5,
  why_now: "다음 할 일이 초안 확인이에요.", evidence: [{ source: "topic", fact: "다음 할 일은 초안 확인" }],
  head_start: { kind: "draft", content: "가상 초안", options: [] }, first_step: "첫 줄을 확인해 주세요.",
};
function workspace(count = 4): WorkspaceData {
  const parsed = parseExport(`## 나
- 하는 일/역할: 가상 학생
## 테마: 학교
${Array.from({ length: count }, (_, index) => `### 가상 작업 ${index + 1}
- 한 줄 설명: 가상 발표 작업
- 진행 여부: 진행 중
- 내가 말했던 다음 할 일: 초안 확인`).join("\n")}`, { today: TODAY });
  return confirmOnboarding(parsed, Object.fromEntries(parsed.topics.map((topic) => [topic.id, "active"])), null, NOW);
}
function withCards(): WorkspaceData {
  let state = applyGeneratedCards(workspace(), Array.from({ length: 4 }, (_, index) => ({ ...card, id: `n${index + 1}`, topic_id: `t${index + 1}` })), NOW, TODAY);
  state = acceptCard(state, "card-2", NOW);
  state = snoozeCard(state, "card-3", TODAY);
  return updateCardContent(state, "card-4", "내가 고친 다른 토픽의 초안");
}

describe("topic-only input and merges", () => {
  it("narrows before the canonical cap while retaining profile and feedback", () => {
    const state = workspace(11);
    expect(buildWorkspaceCardInput(state, TODAY).topics).toHaveLength(9);
    const input = buildTopicCardInput(state, "t11", TODAY);
    expect(input.topics.map((topic) => topic.id)).toEqual(["t11"]);
    expect(input.profile).toEqual(buildWorkspaceCardInput(state, TODAY).profile);
    expect(input.feedback).toEqual(buildWorkspaceCardInput(state, TODAY).feedback);
  });

  it("retains accepted-unfinished exclusion for explicit requests", () => {
    let state = acceptCard(applyGeneratedCards(workspace(), [card], NOW, TODAY), "card-1", NOW);
    state = snoozeCard(state, "card-1", TODAY);
    expect(() => buildTopicCardInput(state, "t1", TODAY)).toThrow("진행 중인 카드");
    expect(() => buildTopicCardInput(state, "missing", TODAY)).toThrow("찾지 못했어요");
  });

  it("requests and saves a later topic without changing classification or automatic eligibility", () => {
    const state = setTopicState(workspace(), "t1", "later");
    const original = state.topics[0];
    const input = buildTopicCardInput(state, "t1", TODAY);
    expect(input.topics.map((topic) => topic.id)).toEqual(["t1"]);
    expect(state.topics[0]).toBe(original);
    expect(buildWorkspaceCardInput(state, TODAY).topics.some((topic) => topic.id === "t1")).toBe(false);
    const next = applyTopicGeneratedCards(markTopicCardGeneration(state, "t1", "later-request"), "t1", [card], NOW, "later-request");
    expect(getCardState(next).items).toMatchObject([{ nudge: { topic_id: "t1" }, status: "pending" }]);
    expect(next.topics[0].state).toBe("later");
    expect(next.topics[0].suggested_state).toBe(original.suggested_state);
    expect(buildWorkspaceCardInput(next, TODAY).topics.some((topic) => topic.id === "t1")).toBe(false);
  });

  it.each([["active", "later"], ["later", "active"]] as const)("drops a late result after topic state changes from %s to %s", (before, after) => {
    const state = setTopicState(withCards(), "t1", before);
    const changed = setTopicState(markTopicCardGeneration(state, "t1", "old-state"), "t1", after);
    const next = applyTopicGeneratedCards(changed, "t1", [card], NOW, "old-state");
    expect(getCardState(next)).toBe(getCardState(changed));
    expect(getTopicCardRequestId(next, "t1")).toBeNull();
  });

  it("replaces only target pending cards and preserves daily metadata, feedback and other card references", () => {
    const state = withCards();
    state.cards!.error = "오늘 생성의 기존 안내";
    state.cards!.request_id = "unrelated-global-token";
    const original = getCardState(state);
    const marked = markTopicCardGeneration(state, "t1", "topic-request");
    const next = applyTopicGeneratedCards(marked, "t1", [
      { ...card, head_start: { ...card.head_start, content: "새 토픽 초안" } },
      { ...card, topic_id: "t4" },
      { ...card, topic_id: "new", type: "new_project", slot: "explore", new_topic_name: "다른 새 토픽" },
    ], NOW, "topic-request");
    const result = getCardState(next);
    expect(result.items.filter((item) => item.nudge.topic_id === "t1")).toMatchObject([{ key: "card-5", content: "새 토픽 초안" }]);
    for (const other of original.items.slice(1)) expect(result.items.find((item) => item.key === other.key)).toBe(other);
    expect(result.feedback).toBe(original.feedback);
    expect(result.generated_date).toBe(original.generated_date);
    expect(result.error).toBe(original.error);
    expect(result.request_id).toBe(original.request_id);
    expect(result.next_key).toBe(6);
    expect(getTopicCardRequestId(next, "t1")).toBeNull();
  });

  it("accepts a normal empty result and retains the target's snoozed card", () => {
    let state = applyGeneratedCards(workspace(), [card, { ...card, id: "n2" }], NOW, TODAY);
    state = snoozeCard(state, "card-2", TODAY);
    const snoozed = getCardState(state).items[1];
    const next = applyTopicGeneratedCards(markTopicCardGeneration(state, "t1", "empty"), "t1", [], NOW, "empty");
    expect(getCardState(next).items).toEqual([snoozed]);
    expect(getCardState(next).next_key).toBe(3);
  });

  it.each(["edit", "accept", "snooze"])("drops a late result after a target card %s", (action) => {
    let state = markTopicCardGeneration(applyGeneratedCards(workspace(), [card], NOW, TODAY), "t1", "old");
    if (action === "edit") state = updateCardContent(state, "card-1", "작성 중인 내 초안");
    if (action === "accept") state = acceptCard(state, "card-1", NOW);
    if (action === "snooze") state = snoozeCard(state, "card-1", TODAY);
    const previous = getCardState(state);
    const next = applyTopicGeneratedCards(state, "t1", [{ ...card, action: "늦은 응답" }], NOW, "old");
    expect(getCardState(next)).toBe(previous);
    expect(getTopicCardRequestId(next, "t1")).toBeNull();
  });

  it("drops suggestions generated from a topic context that has since changed", () => {
    const marked = markTopicCardGeneration(withCards(), "t1", "old");
    const changed = { ...marked, topics: marked.topics.map((topic) => topic.id === "t1" ? { ...topic, goal: "새로 정한 목표" } : topic) };
    const next = applyTopicGeneratedCards(changed, "t1", [card], NOW, "old");
    expect(getCardState(next)).toBe(getCardState(changed));
    expect(getTopicCardRequestId(next, "t1")).toBeNull();
  });

  it("survives navigation but never revives a deleted/restored or reloaded topic", () => {
    const marked = markTopicCardGeneration(withCards(), "t1", "old");
    const selected = selectTopic(marked, "t1", NOW);
    expect(getTopicCardRequestId(selected, "t1")).toBe("old");
    const snapshot = snapshotTopicRemoval(selected, "t1")!;
    const restored = restoreRemovedTopic(removeTopic(selected, "t1"), snapshot);
    expect(applyTopicGeneratedCards(restored, "t1", [card], NOW, "old")).toBe(restored);
    saveWorkspace(window.localStorage, marked);
    const loaded = loadWorkspace(window.localStorage)!;
    expect(getTopicCardRequestId(loaded, "t1")).toBeNull();
    expect(applyTopicGeneratedCards(loaded, "t1", [card], NOW, "old")).toBe(loaded);
  });
});

function deferred() {
  let resolve!: (response: Response) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Response>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let root: Root;
let container: HTMLDivElement;
let latest: ReturnType<typeof useTopicCards>;
let globalCards: ReturnType<typeof useCards>;
let store: ReturnType<typeof useWorkspace>;
const fetchMock = vi.fn<typeof fetch>();
function Capture() { store = useWorkspace(); return null; }
function Probe({ topicId }: { topicId: string }) { latest = useTopicCards(topicId); return null; }
function GlobalProbe() { globalCards = useCards(); return null; }
function App({ show, topicId, global }: { show: boolean; topicId: string; global: boolean }) {
  return createElement(WorkspaceProvider, null, createElement(Capture), show ? createElement(Probe, { topicId }) : null, global ? createElement(GlobalProbe) : null);
}
async function render(show = true, topicId = "t1", global = false) {
  await act(async () => { root.render(createElement(StrictMode, null, createElement(App, { show, topicId, global }))); });
}
async function start() { await act(async () => { void latest.generate(); }); }
async function resolve(request: ReturnType<typeof deferred>, nudges: Nudge[] = [card]) {
  await act(async () => { request.resolve(Response.json({ nudges })); await request.promise; });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.localStorage.clear();
  saveWorkspace(window.localStorage, withCards());
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("explicit topic request lifetime", () => {
  it("clears imported topic guards and ignores an old response while a newer explicit request stays loading", async () => {
    const oldRequest = deferred();
    const newRequest = deferred();
    fetchMock.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
    await render();
    await start();
    expect(latest.loading).toBe(true);
    await act(async () => { expect(store.restore(withCards())).toBe(true); });
    expect(latest.loading).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await start();
    expect(latest.loading).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await resolve(oldRequest, [{ ...card, title: "옛 요청의 카드" }]);
    expect(latest.loading).toBe(true);
    expect(store.workspace?.cards?.items.some((item) => item.nudge.title === "옛 요청의 카드")).toBe(false);
    await resolve(newRequest, [{ ...card, title: "새 요청의 카드" }]);
    expect(latest.loading).toBe(false);
    expect(store.workspace?.cards?.items.some((item) => item.nudge.title === "새 요청의 카드")).toBe(true);
  });
  it("never fetches on mount, navigation or date change", async () => {
    await render();
    await render(false);
    vi.setSystemTime("2026-11-13T12:00:00.000Z");
    await render(true, "t4");
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends exactly one topic on duplicate clicks and preserves other cards and daily metadata", async () => {
    const request = deferred();
    fetchMock.mockReturnValue(request.promise);
    await render();
    const before = getCardState(store.workspace!);
    await act(async () => { void latest.generate(); void latest.generate(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(latest.loading).toBe(true);
    const init = fetchMock.mock.calls[0][1]!;
    const input = JSON.parse(String(init.body));
    expect(input.topics.map((topic: { id: string }) => topic.id)).toEqual(["t1"]);
    expect(input.feedback).toEqual(before.feedback);
    await resolve(request);
    expect(latest.loading).toBe(false);
    expect(latest.error).toBeNull();
    const after = getCardState(store.workspace!);
    expect(after.generated_date).toBe(before.generated_date);
    expect(after.feedback).toBe(before.feedback);
    expect(after.items.filter((item) => item.nudge.topic_id !== "t1")).toEqual(before.items.slice(1));
  });

  it("reattaches after navigation and saves a response while the board is absent", async () => {
    const request = deferred();
    fetchMock.mockReturnValue(request.promise);
    await render();
    await start();
    await render(false);
    await render(true);
    expect(latest.loading).toBe(true);
    await start();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await render(false);
    await resolve(request);
    expect(getCardState(store.workspace!).items.find((item) => item.nudge.topic_id === "t1")?.key).toBe("card-5");
    await render();
    expect(latest.loading).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats empty results as success without another call", async () => {
    const request = deferred();
    fetchMock.mockReturnValue(request.promise);
    await render();
    await start();
    await resolve(request, []);
    expect(getCardState(store.workspace!).items.some((item) => item.nudge.topic_id === "t1")).toBe(false);
    expect(latest.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not call the API for a topic with accepted unfinished work", async () => {
    await render();
    await act(async () => { store.update((previous) => snoozeCard(acceptCard(previous, "card-1", NOW), "card-1", TODAY)); });
    await start();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(latest.error).toContain("진행 중인 카드");
  });

  it("generates one later topic only on click and keeps it excluded from automatic input", async () => {
    const request = deferred();
    fetchMock.mockReturnValue(request.promise);
    const saved = setTopicState(withCards(), "t1", "later");
    saveWorkspace(window.localStorage, saved);
    await render();
    expect(fetchMock).not.toHaveBeenCalled();
    await start();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const input = JSON.parse(String(fetchMock.mock.calls[0][1]!.body));
    expect(input.topics.map((topic: { id: string }) => topic.id)).toEqual(["t1"]);
    await resolve(request);
    expect(latest.error).toBeNull();
    expect(getCardState(store.workspace!).items.filter((item) => item.nudge.topic_id === "t1")).toMatchObject([{ key: "card-5" }]);
    expect(store.workspace!.topics[0].state).toBe("later");
    expect(store.workspace!.topics[0].suggested_state).toBe(saved.topics[0].suggested_state);
    expect(buildWorkspaceCardInput(store.workspace!, TODAY).topics.some((topic) => topic.id === "t1")).toBe(false);
    expect(getCardState(store.workspace!).generated_date).toBe(TODAY);
  });

  it("blocks only a live global request, without sending a second request", async () => {
    const request = deferred();
    fetchMock.mockReturnValue(request.promise);
    await render(true, "t1", true);
    await act(async () => { void globalCards.generate(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await start();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(latest.error).toContain("오늘 초안");
    await resolve(request);
  });

  it("allows topic generation after an interrupted global request without altering its cached fields", async () => {
    const saved = withCards();
    saved.cards = { ...getCardState(saved), request_id: "old-document-request", error: "중단된 오늘 생성 안내" };
    saveWorkspace(window.localStorage, saved);
    const request = deferred();
    fetchMock.mockReturnValue(request.promise);
    await render();
    await start();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await resolve(request);
    expect(latest.error).toBeNull();
    expect(getCardState(store.workspace!)).toMatchObject({ request_id: "old-document-request", error: "중단된 오늘 생성 안내", generated_date: TODAY });
  });

  it("does not restore a deleted topic", async () => {
    const request = deferred();
    fetchMock.mockReturnValue(request.promise);
    await render();
    await start();
    await act(async () => { store.update((previous) => removeTopic(previous, "t1")); });
    await resolve(request);
    expect(store.workspace!.topics.some((topic) => topic.id === "t1")).toBe(false);
    expect(getCardState(store.workspace!).items.some((item) => item.nudge.topic_id === "t1")).toBe(false);
  });

  it("keeps a target card accepted during the request", async () => {
    const request = deferred();
    fetchMock.mockReturnValue(request.promise);
    await render();
    await start();
    await act(async () => { store.update((previous) => acceptCard(previous, "card-1", NOW)); });
    await resolve(request);
    expect(getCardState(store.workspace!).items.filter((item) => item.nudge.topic_id === "t1")).toMatchObject([{ key: "card-1", status: "accepted" }]);
  });

  it("stores the original topic's result after switching boards without changing the new board", async () => {
    const request = deferred();
    fetchMock.mockReturnValue(request.promise);
    await render();
    await start();
    const otherCard = getCardState(store.workspace!).items.find((item) => item.nudge.topic_id === "t4");
    await render(true, "t4");
    expect(latest.loading).toBe(false);
    await resolve(request);
    expect(getCardState(store.workspace!).items.find((item) => item.nudge.topic_id === "t1")?.key).toBe("card-5");
    expect(getCardState(store.workspace!).items.find((item) => item.nudge.topic_id === "t4")).toBe(otherCard);
    expect(latest.loading).toBe(false);
    expect(latest.error).toBeNull();
  });

  it("never mixes a personal request response into sample mode", async () => {
    const request = deferred();
    fetchMock.mockReturnValue(request.promise);
    await render();
    await start();
    await act(async () => { store.startSample("student"); });
    const sample = getCardState(store.workspace!);
    await resolve(request, [{ ...card, action: "개인 기록의 응답" }]);
    expect(store.mode).toBe("sample");
    expect(getCardState(store.workspace!)).toBe(sample);
    expect(getCardState(store.workspace!).items.some((item) => item.nudge.action === "개인 기록의 응답")).toBe(false);
  });

  it("does not fetch when the initial request marker cannot be saved", async () => {
    await render();
    const write = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
    try {
      await start();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(latest.error).toContain("저장");
    } finally { write.mockRestore(); }
  });

  it("permits a new request after re-import and ignores the older response", async () => {
    const oldRequest = deferred(), newRequest = deferred();
    fetchMock.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
    await render();
    await start();
    await act(async () => { store.replace(workspace()); });
    await start();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await resolve(oldRequest, [{ ...card, action: "이전 응답" }]);
    expect(latest.loading).toBe(true);
    expect(getCardState(store.workspace!).items).toEqual([]);
    await resolve(newRequest, [{ ...card, action: "현재 응답" }]);
    expect(latest.loading).toBe(false);
    expect(getCardState(store.workspace!).items[0].nudge.action).toBe("현재 응답");
  });

  it("reports a safe failure without changing cache or cards, then allows an explicit retry", async () => {
    const request = deferred();
    fetchMock.mockReturnValueOnce(request.promise);
    await render();
    const before = getCardState(store.workspace!);
    await start();
    await act(async () => { request.reject(new Error("private upstream details")); });
    expect(latest.error).toBe("초안을 준비하지 못했어요. 다시 시도해 주세요.");
    expect(getCardState(store.workspace!)).toBe(before);
    const retry = deferred();
    fetchMock.mockReturnValueOnce(retry.promise);
    await start();
    await resolve(retry, []);
    expect(latest.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["game-developer", "student"] as const)("uses only the selected %s sample topic and preserves personal storage with zero fetch", async (persona) => {
    await render(false);
    const personal = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    await act(async () => { store.startSample(persona); });
    const target = getCardState(store.workspace!).items.find((item) => item.nudge.topic_id !== "new")!.nudge.topic_id;
    await render(true, target);
    const before = getCardState(store.workspace!);
    const others = before.items.filter((item) => item.nudge.topic_id !== target);
    await act(async () => { await latest.generate(); });
    const after = getCardState(store.workspace!);
    for (const other of others) expect(after.items.find((item) => item.key === other.key)).toBe(other);
    expect(after.generated_date).toBe(before.generated_date);
    expect(after.feedback).toBe(before.feedback);
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(personal);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(latest.error).toBeNull();
  });

  it("allows a later sample topic request with zero fetch and unchanged classification", async () => {
    await render(false);
    const personal = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    await act(async () => { store.startSample("game-developer"); });
    const target = getCardState(store.workspace!).items.find((item) => item.nudge.topic_id !== "new")!.nudge.topic_id;
    await act(async () => { store.update((previous) => setTopicState(previous, target, "later")); });
    const suggested = store.workspace!.topics.find((topic) => topic.id === target)!.suggested_state;
    const before = getCardState(store.workspace!);
    await render(true, target);
    await act(async () => { await latest.generate(); });
    const after = getCardState(store.workspace!);
    expect(store.workspace!.topics.find((topic) => topic.id === target)).toMatchObject({ state: "later", suggested_state: suggested });
    expect(buildWorkspaceCardInput(store.workspace!, TODAY).topics.some((topic) => topic.id === target)).toBe(false);
    expect(after.generated_date).toBe(before.generated_date);
    expect(after.feedback).toBe(before.feedback);
    for (const other of before.items.filter((item) => item.nudge.topic_id !== target)) expect(after.items.find((item) => item.key === other.key)).toBe(other);
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(personal);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(latest.error).toBeNull();
  });
});
