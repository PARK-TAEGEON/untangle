// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCards } from "../components/use-cards";
import { useWorkspace, WorkspaceProvider } from "../components/workspace-provider";
import { applyGeneratedCards, getCardState, markCardGeneration } from "../lib/card-state";
import type { Nudge } from "../lib/card-types";
import { parseExport } from "../lib/parse";
import { saveWorkspace, SAMPLE_WORKSPACE_STORAGE_KEY, WORKSPACE_MODE_STORAGE_KEY, WORKSPACE_STORAGE_KEY } from "../lib/storage";
import { confirmOnboarding, removeTopic } from "../lib/workspace";
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

function workspace(): WorkspaceData {
  return confirmOnboarding(parseExport(`## 나
- 하는 일/역할: 가상 학생
## 테마: 학교
### 가상 팀플
- 한 줄 설명: 가상 발표 작업
- 진행 여부: 진행 중
- 내가 말했던 다음 할 일: 초안 확인
### 가상 개인 프로젝트
- 한 줄 설명: 가상 코드 실험
- 진행 여부: 진행 중
- 내가 말했던 다음 할 일: 코드 확인`, { today: TODAY }), {}, null, NOW);
}

function deferred() {
  let resolve!: (response: Response) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Response>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let root: Root;
let container: HTMLDivElement;
let latest: ReturnType<typeof useCards>;
let store: ReturnType<typeof useWorkspace>;
let generationEnabled = true;
const fetchMock = vi.fn<typeof fetch>();

function Capture() { store = useWorkspace(); return null; }
function Probe() { latest = useCards(generationEnabled); return createElement("span", null, String(latest.loading)); }
function App({ show }: { show: boolean }) {
  return createElement(WorkspaceProvider, null, createElement(Capture), show ? createElement(Probe) : null);
}
async function render(show = true) {
  await act(async () => { root.render(createElement(StrictMode, null, createElement(App, { show }))); });
}
async function resolve(request: ReturnType<typeof deferred>, nudges: Nudge[] = [card]) {
  await act(async () => { request.resolve(Response.json({ nudges })); await request.promise; });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.localStorage.clear();
  saveWorkspace(window.localStorage, workspace());
  fetchMock.mockReset();
  generationEnabled = true;
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

describe("useCards request lifetime", () => {
  it("preserves one automatic fetch through StrictMode replay when mounted after provider hydration", async () => {
    const request = deferred();
    fetchMock.mockReturnValue(request.promise);
    await render(false);
    expect(store.ready).toBe(true);
    await render(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(latest.loading).toBe(true);
    expect(getCardState(store.workspace!).generated_date).toBe(TODAY);
    expect(getCardState(store.workspace!).request_id).toEqual(expect.any(String));
    await resolve(request);
    expect(latest.loading).toBe(false);
    expect(getCardState(store.workspace!).items).toHaveLength(1);
    expect(getCardState(store.workspace!).request_id).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reattaches to a paid in-flight request after navigation without cancelling or fetching again", async () => {
    const request = deferred();
    fetchMock.mockReturnValue(request.promise);
    await render();
    await render(false);
    await render(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(latest.loading).toBe(true);
    await resolve(request);
    expect(latest.loading).toBe(false);
    expect(getCardState(store.workspace!).items).toHaveLength(1);
  });

  it("saves completion during route absence and uses the cache on return", async () => {
    const request = deferred();
    fetchMock.mockReturnValue(request.promise);
    await render();
    await render(false);
    await resolve(request);
    expect(getCardState(store.workspace!).items).toHaveLength(1);
    await render(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(latest.loading).toBe(false);
  });

  it("keeps a valid response after an unrelated topic is deleted during the request", async () => {
    const request = deferred();
    fetchMock.mockReturnValue(request.promise);
    await render();
    await act(async () => { store.update((previous) => removeTopic(previous, "t2")); });
    await resolve(request);
    expect(store.workspace!.topics).toHaveLength(1);
    expect(getCardState(store.workspace!).items[0]?.nudge.topic_id).toBe("t1");
  });

  it("ignores old success after re-import, then starts the new workspace's automatic request", async () => {
    const oldRequest = deferred();
    const newRequest = deferred();
    fetchMock.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
    await render();
    const replacement = workspace();
    replacement.topics[0].goal = "바뀐 가상 목표";
    await act(async () => { store.replace(replacement); });
    await resolve(oldRequest, [{ ...card, head_start: { ...card.head_start, content: "이전 작업 초안" } }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.workspace!.topics[0].goal).toBe("바뀐 가상 목표");
    expect(getCardState(store.workspace!).items).toEqual([]);
    await resolve(newRequest, [{ ...card, head_start: { ...card.head_start, content: "새 작업 초안" } }]);
    expect(getCardState(store.workspace!).items[0].content).toBe("새 작업 초안");
  });

  it("retains an error and same-day attempt cache after a failed request", async () => {
    const request = deferred();
    fetchMock.mockReturnValue(request.promise);
    await render();
    await act(async () => { request.reject(new Error("network failure with private details")); });
    expect(getCardState(store.workspace!).error).toBe("초안을 준비하지 못했어요. 다시 시도해 주세요.");
    expect(getCardState(store.workspace!).request_id).toBeNull();
    await render(false);
    await render(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows a retry message after an interrupted full reload without another automatic API call", async () => {
    saveWorkspace(window.localStorage, markCardGeneration(workspace(), TODAY, "interrupted-request-from-an-old-document"));
    await render();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getCardState(store.workspace!).error).toContain("다시 시도");
    const request = deferred();
    fetchMock.mockReturnValue(request.promise);
    await act(async () => { void latest.generate(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await resolve(request, []);
    expect(getCardState(store.workspace!).error).toBeNull();
  });

  it("updates the local date on manual generation after midnight without waiting for window focus", async () => {
    saveWorkspace(window.localStorage, applyGeneratedCards(workspace(), [], NOW, TODAY));
    await render();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.setSystemTime("2026-11-12T16:00:00.000Z"); // 01:00 on the 13th in Seoul.
    const request = deferred();
    fetchMock.mockReturnValue(request.promise);
    await act(async () => { void latest.generate(); });
    expect(latest.today).toBe("2026-11-13");
    const init = fetchMock.mock.calls[0][1]!;
    expect(JSON.parse(String(init.body)).today).toBe("2026-11-13");
    await resolve(request, []);
  });
});

describe("isolated offline sample mode", () => {
  it("keeps personal data byte-for-byte while sample actions and both persona switches call no API", async () => {
    const personal = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    await render(false);
    await act(async () => { expect(store.startSample("game-developer")).toBe(true); });
    await render(true);
    expect(store.mode).toBe("sample");
    expect(getCardState(store.workspace!).items).toHaveLength(3);
    const firstRound = getCardState(store.workspace!).items.map((card) => card.content);
    await act(async () => { await latest.generate(); });
    expect(getCardState(store.workspace!).items.map((card) => card.content)).not.toEqual(firstRound);
    await act(async () => { expect(store.startSample("student")).toBe(true); });
    expect(getCardState(store.workspace!).items).toHaveLength(2);
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(personal);
    expect(window.localStorage.getItem(SAMPLE_WORKSPACE_STORAGE_KEY)).toContain('"persona":"student"');
    expect(window.localStorage.getItem(WORKSPACE_MODE_STORAGE_KEY)).toBe("sample");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("restores sample edits and chosen persona after a complete provider remount without API calls", async () => {
    await render(false);
    await act(async () => { store.startSample("student"); });
    await render(true);
    await act(async () => { store.update((previous) => ({ ...previous, topics: previous.topics.map((topic, index) => index === 0 ? { ...topic, starred: true } : topic) })); });
    const before = structuredClone(store.workspace!);
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    await render(true);
    expect(store.mode).toBe("sample");
    expect(store.workspace).toEqual(before);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses another recorded round after the date changes and restores personal data on exit", async () => {
    const personal = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    await render(false);
    await act(async () => { store.startSample("game-developer"); });
    await render(true);
    const first = getCardState(store.workspace!).items.map((card) => card.content);
    vi.setSystemTime("2026-11-12T16:00:00.000Z");
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(getCardState(store.workspace!).generated_date).toBe("2026-11-13");
    expect(getCardState(store.workspace!).items.map((card) => card.content)).not.toEqual(first);
    expect(latest.today).toBe(TODAY);
    // Dashboard pauses generation before navigating to /start, so exit cannot start a personal request.
    generationEnabled = false;
    await render(true);
    await act(async () => { expect(store.exitSample()).toBe(true); });
    expect(store.mode).toBe("personal");
    expect(store.workspace!.sample).toBeUndefined();
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(personal);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
