// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCards } from "../components/use-cards";
import { useTopicCards } from "../components/use-topic-cards";
import { useWorkspace, WorkspaceProvider } from "../components/workspace-provider";
import { APP_DATA_KEYS, APP_DATA_RESET_KEY, clearKnownAppData } from "../lib/app-data";
import { applyGeneratedCards } from "../lib/card-state";
import type { Nudge } from "../lib/card-types";
import { parseExport } from "../lib/parse";
import { saveWorkspace, SAMPLE_WORKSPACE_STORAGE_KEY, WORKSPACE_STORAGE_KEY } from "../lib/storage";
import { confirmOnboarding } from "../lib/workspace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const NOW = "2026-11-15T03:00:00.000Z";
const TODAY = "2026-11-15";
const card: Nudge = { id: "n1", slot: "focus", topic_id: "t1", new_topic_name: null, type: "continue", title: "가상 초안 확인하기", action: "첫 줄 확인", est_minutes: 5, why_now: "다음 할 일", evidence: [{ source: "topic", fact: "초안 확인" }], head_start: { kind: "draft", content: "가상 초안", options: [] }, first_step: "첫 줄 확인" };
function workspace() {
  return confirmOnboarding(parseExport(`## 나
- 하는 일/역할: 가상 개발자
## 테마: 개발
### 가상 작업
- 한 줄 설명: 가상 초안 확인
- 진행 여부: 진행 중
- 내가 말했던 다음 할 일: 초안 확인`, { today: TODAY }), {}, null, NOW);
}
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((yes) => { resolve = yes; });
  return { promise, resolve };
}
let root: Root;
let container: HTMLDivElement;
let store: ReturnType<typeof useWorkspace>;
let globalCards: ReturnType<typeof useCards>;
let topicCards: ReturnType<typeof useTopicCards>;
let generateGlobally = false;
const fetchMock = vi.fn<typeof fetch>();
function Probe() { store = useWorkspace(); globalCards = useCards(generateGlobally); topicCards = useTopicCards("t1"); return null; }
async function render() { await act(async () => { root.render(createElement(WorkspaceProvider, null, createElement(Probe))); }); }
async function resolve(request: ReturnType<typeof deferred>) { await act(async () => { request.resolve(Response.json({ nudges: [card] })); await request.promise; }); }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  window.localStorage.clear(); saveWorkspace(window.localStorage, workspace());
  generateGlobally = false; fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("provider-owned clearing and late requests", () => {
  it("clears current memory and app keys while retaining unrelated storage", async () => {
    window.localStorage.setItem("other-app", "keep"); window.localStorage.setItem("untangle.unknown.v1", "keep");
    await render();
    await act(async () => { expect(store.clearAppData()).toBe(true); });
    expect(store.workspace).toBeNull(); expect(store.mode).toBe("personal");
    for (const key of APP_DATA_KEYS) expect(window.localStorage.getItem(key)).toBeNull();
    expect(window.localStorage.getItem(APP_DATA_RESET_KEY)).toContain('"ready"');
    expect(window.localStorage.getItem("other-app")).toBe("keep");
    expect(window.localStorage.getItem("untangle.unknown.v1")).toBe("keep");
  });

  it("does not revive deleted data from a global API response, even after a new workspace is created", async () => {
    generateGlobally = true; const request = deferred(); fetchMock.mockReturnValue(request.promise);
    await render(); expect(globalCards.loading).toBe(true);
    await act(async () => { expect(store.clearAppData()).toBe(true); });
    expect(globalCards.loading).toBe(false);
    const fresh = applyGeneratedCards(workspace(), [{ ...card, title: "새 자료의 카드" }], NOW, TODAY);
    await act(async () => { expect(store.replace(fresh)).toBe(true); });
    await resolve(request);
    expect(store.workspace?.cards?.items[0].nudge.title).toBe("새 자료의 카드");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not revive deleted data from a topic API response", async () => {
    const request = deferred(); fetchMock.mockReturnValue(request.promise);
    await render(); await act(async () => { void topicCards.generate(); });
    expect(topicCards.loading).toBe(true);
    await act(async () => { expect(store.clearAppData()).toBe(true); });
    expect(topicCards.loading).toBe(false);
    await resolve(request);
    expect(store.workspace).toBeNull(); expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull();
  });

  it("blocks another tab's late API response before its storage event arrives", async () => {
    generateGlobally = true; const request = deferred(); fetchMock.mockReturnValue(request.promise);
    await render();
    clearKnownAppData(window.localStorage, "other-tab-reset");
    // Same-document helper calls emit no storage event, modeling a stale tab before delivery.
    expect(store.workspace).not.toBeNull();
    await resolve(request);
    expect(store.workspace).toBeNull(); expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull();
  });

  it("keeps the provider's existing records after a fully rolled-back clear failure", async () => {
    await render(); const previous = store.workspace; const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    const originalRemove = window.localStorage.removeItem.bind(window.localStorage);
    const remove = vi.spyOn(window.localStorage, "removeItem").mockImplementation((key) => { if (key === WORKSPACE_STORAGE_KEY) throw new Error("blocked"); originalRemove(key); });
    await act(async () => { expect(store.clearAppData()).toBe(false); });
    remove.mockRestore();
    expect(store.workspace).toBe(previous); expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(raw);
    expect(store.error).toContain("기존 자료는 그대로");
  });

  it("blocks writes after a partial rollback failure and allows a later successful retry", async () => {
    window.localStorage.setItem(SAMPLE_WORKSPACE_STORAGE_KEY, "remaining sample snapshot");
    await render();
    const originalRemove = window.localStorage.removeItem.bind(window.localStorage);
    const originalSet = window.localStorage.setItem.bind(window.localStorage);
    const remove = vi.spyOn(window.localStorage, "removeItem").mockImplementation((key) => { if (key === SAMPLE_WORKSPACE_STORAGE_KEY) throw new Error("blocked removal"); originalRemove(key); });
    const set = vi.spyOn(window.localStorage, "setItem").mockImplementation((key, value) => { if (key === WORKSPACE_STORAGE_KEY) throw new Error("blocked rollback"); originalSet(key, value); });
    await act(async () => { expect(store.clearAppData()).toBe(false); });
    expect(store.workspace).toBeNull();
    expect(store.error).toContain("일부 자료");
    await act(async () => { expect(store.replace(workspace())).toBe(false); });
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull();
    set.mockRestore(); remove.mockRestore();
    await act(async () => { expect(store.clearAppData()).toBe(true); });
    expect(store.error).toBeNull(); expect(store.workspace).toBeNull();
    for (const key of APP_DATA_KEYS) expect(window.localStorage.getItem(key)).toBeNull();
  });
});
