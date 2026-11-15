// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "../components/dashboard";
import { TopicBoard } from "../components/topic-board";
import { useWorkspace, WorkspaceProvider } from "../components/workspace-provider";
import { applyGeneratedCards, getCardState } from "../lib/card-state";
import type { Nudge } from "../lib/card-types";
import { parseExport } from "../lib/parse";
import { DEFAULT_PREFERENCES, savePreferences } from "../lib/preferences";
import { saveWorkspace, WORKSPACE_STORAGE_KEY } from "../lib/storage";
import { resetTodayRoster } from "../lib/today-roster";
import { confirmOnboarding } from "../lib/workspace";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("next/link", () => ({ default: "a" }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const TODAY = "2026-11-15";
const NOW = `${TODAY}T03:00:00.000Z`;
let root: Root;
let container: HTMLDivElement;
let store: ReturnType<typeof useWorkspace>;
let restoreWrite: (() => void) | undefined;
const fetchMock = vi.fn<typeof fetch>();
function card(index: number, suffix = "기존"): Nudge {
  return {
    id: `n${index}`, slot: index === 3 ? "explore" : "focus", topic_id: `t${index}`, new_topic_name: null,
    type: index === 3 ? "expand" : "continue", title: `${suffix} 가상 ${index}번 초안 확인하기`,
    action: "가상 초안의 첫 줄을 확인해 주세요.", est_minutes: 5,
    why_now: "초안을 확인하는 다음 할 일이 있어요.", evidence: [{ source: "topic", fact: "가상 초안이 있어요." }],
    head_start: { kind: "draft", content: `${suffix} ${index}번 가상 초안`, options: [] }, first_step: "첫 줄을 읽어 주세요.",
  };
}
function fixture() {
  const parsed = parseExport(`## 나
- 하는 일/역할: 가상 개발자
## 테마: 가상 작업
${[1, 2, 3].map((index) => `### 가상 프로젝트 ${index}
- 한 줄 설명: 검증용 가상 프로젝트 ${index}
- 진행 여부: 진행 중
- 내가 말했던 다음 할 일: 가상 초안 첫 줄 확인`).join("\n")}`, { today: TODAY });
  return applyGeneratedCards(confirmOnboarding(parsed, {}, null, NOW), [1, 2, 3].map((index) => card(index)), NOW, TODAY);
}
function Capture() { store = useWorkspace(); return null; }
async function render(page: ReactNode = createElement(Dashboard)) {
  await act(async () => root.render(createElement(StrictMode, null, createElement(WorkspaceProvider, null, createElement(Capture), page))));
}
async function remount() { await act(async () => root.unmount()); root = createRoot(container); await render(); }
function strands() { return [...container.querySelectorAll<HTMLElement>(".today-threads [role='listitem']")]; }
function states() { return strands().map((strand) => ({ key: strand.dataset.cardKey, completed: strand.dataset.completed })); }
function button(text: string, within: ParentNode = container) {
  return [...within.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent?.trim() === text)!;
}
async function click(element: HTMLElement | null) {
  expect(element).toBeTruthy(); element!.focus(); await act(async () => element!.click());
}
async function finishHero() {
  await click(container.querySelector<HTMLButtonElement>(".proposal-card .button-start"));
  const dialog = document.querySelector<HTMLDialogElement>(".focus-card-dialog")!;
  expect(dialog?.open).toBe(true);
  await click(button("다 했어요", dialog));
  expect(document.querySelector(".focus-card-dialog")).toBeNull();
}
async function limit(cardLimit: 1 | 2 | 3) { await act(async () => savePreferences({ ...DEFAULT_PREFERENCES, cardLimit })); }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  window.localStorage.clear(); resetTodayRoster("personal"); resetTodayRoster("sample"); saveWorkspace(window.localStorage, fixture());
  const media = new Map<string, MediaQueryList>();
  vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    if (!media.has(query)) {
      const target = new EventTarget(); Object.defineProperties(target, { matches: { value: false }, media: { value: query } });
      media.set(query, target as MediaQueryList);
    }
    return media.get(query)!;
  });
  navigation.push.mockReset(); navigation.replace.mockReset();
  fetchMock.mockReset().mockResolvedValue(Response.json({ nudges: [] })); vi.stubGlobal("fetch", fetchMock);
  restoreWrite = undefined;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); restoreWrite?.(); container.remove();
  delete document.documentElement.dataset.textSize; delete document.documentElement.dataset.reducedMotion;
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("today's fixed card strands", () => {
  it("keeps a completed strand at a one-card limit without pulling in hidden cards, including after remounting", async () => {
    await limit(1); await render();
    expect(container.querySelector(".today-threads")?.getAttribute("aria-label")).toBe("오늘의 실");
    expect(states()).toEqual([{ key: "card-1", completed: "false" }]);
    const tangled = strands()[0].querySelector("path")?.getAttribute("d");
    expect(strands()[0].getAttribute("aria-label")).toContain(card(1).title);
    expect(strands()[0].getAttribute("aria-label")).toContain("아직");
    await finishHero();
    expect(states()).toEqual([{ key: "card-1", completed: "true" }]);
    const straight = strands()[0].querySelector("path")?.getAttribute("d");
    expect(straight).toBeTruthy(); expect(straight).not.toBe(tangled);
    expect(strands()[0].getAttribute("aria-label")).toContain("완료");
    expect(container.querySelector(".proposal-card")).toBeNull();
    expect(container.querySelectorAll(".small-proposal")).toHaveLength(0);
    expect(getCardState(store.workspace!).items.map((item) => item.status)).toEqual(["completed", "pending", "pending"]);
    await remount();
    expect(states()).toEqual([{ key: "card-1", completed: "true" }]);
    expect(strands()[0].querySelector("path")?.getAttribute("d")).toBe(straight);
    expect(container.querySelector(".proposal-card")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps strand order through card promotion, completion and changing the display limit", async () => {
    await limit(2); await render();
    const first = states();
    await click(container.querySelector<HTMLButtonElement>(".small-proposal"));
    expect(container.querySelector(".proposal-card h2")?.textContent).toBe(card(2).title);
    expect(states()).toEqual(first);
    await finishHero();
    expect(states()).toEqual([{ key: "card-1", completed: "false" }, { key: "card-2", completed: "true" }]);
    expect(container.textContent).not.toContain(card(3).title);
    await limit(1);
    expect(states()).toEqual([{ key: "card-1", completed: "false" }]);
    await limit(3);
    expect(states()).toEqual([{ key: "card-1", completed: "false" }, { key: "card-2", completed: "true" }, { key: "card-3", completed: "false" }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("replaces the cohort after a successful global response while keeping the card limit out of the LLM input", async () => {
    await limit(1); await render(); await finishHero();
    fetchMock.mockResolvedValueOnce(Response.json({ nudges: [1, 2, 3].map((index) => card(index, "새")) }));
    await click(button("새 제안 받기"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const input = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(input.topics.map((topic: { id: string }) => topic.id)).toEqual(["t1", "t2", "t3"]);
    expect(input).not.toHaveProperty("cardLimit");
    expect(states()).toEqual([{ key: "card-4", completed: "false" }]);
    expect(container.querySelector(".proposal-card h2")?.textContent).toBe(card(1, "새").title);
    await remount();
    expect(states()).toEqual([{ key: "card-4", completed: "false" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retains the existing completed and pending strands when a manual response fails", async () => {
    await render(); await finishHero();
    const before = states();
    fetchMock.mockResolvedValueOnce(Response.json({ error: "검증용 가상 실패" }, { status: 502 }));
    await click(button("새 제안 받기"));
    expect(getCardState(store.workspace!).error).toBe("검증용 가상 실패");
    expect(states()).toEqual(before);
    expect(before.some((strand) => strand.completed === "true")).toBe(true);
    await remount(); expect(states()).toEqual(before);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accepts a normal empty successful response without retaining stale strands or retrying", async () => {
    await render(); expect(strands()).toHaveLength(3);
    await click(button("새 제안 받기"));
    expect(strands()).toHaveLength(0);
    expect(getCardState(store.workspace!).error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("starts and advances sample strands locally without sharing personal completion state", async () => {
    await render(); await finishHero();
    const personal = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    expect(states()[0].completed).toBe("true");
    await act(async () => { expect(store.startSample("game-developer")).toBe(true); });
    expect(strands().length).toBeGreaterThan(0);
    expect(states().every((strand) => strand.completed === "false")).toBe(true);
    const before = states().map((strand) => strand.key);
    await click(button("새 제안 받기"));
    expect(strands().length).toBeGreaterThan(0);
    expect(states().map((strand) => strand.key)).not.toEqual(before);
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(personal);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps successful generated cards usable if only the UI roster cannot be persisted", async () => {
    await render();
    const original = window.localStorage.setItem.bind(window.localStorage);
    const write = vi.spyOn(window.localStorage, "setItem").mockImplementation((key, value) => {
      if (key.startsWith("untangle.today-roster.")) throw new DOMException("Full", "QuotaExceededError");
      original(key, value);
    });
    restoreWrite = () => write.mockRestore();
    fetchMock.mockResolvedValueOnce(Response.json({ nudges: [card(1, "새"), card(2, "새")] }));
    await click(button("새 제안 받기"));
    expect(getCardState(store.workspace!).error).toBeNull();
    expect(container.querySelector(".proposal-card h2")?.textContent).toBe(card(1, "새").title);
    expect(states()).toEqual([{ key: "card-4", completed: "false" }, { key: "card-5", completed: "false" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("appends a board-generated card to an available home slot while preserving completed strands and their order", async () => {
    const data = fixture(); data.cards!.items = data.cards!.items.slice(0, 2);
    saveWorkspace(window.localStorage, data);
    await render(); await finishHero();
    const previous = states();
    expect(previous).toEqual([{ key: "card-1", completed: "true" }, { key: "card-2", completed: "false" }]);
    const generatedDate = getCardState(store.workspace!).generated_date;
    await render(createElement(TopicBoard, { topicId: "t3" }));
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(Response.json({ nudges: [card(3, "보드에서 받은")] }));
    await click(button("이 토픽의 한 걸음 받기"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const input = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(input.topics.map((topic: { id: string }) => topic.id)).toEqual(["t3"]);
    expect(getCardState(store.workspace!).generated_date).toBe(generatedDate);
    expect(container.querySelector(".proposal-card h2")?.textContent).toBe(card(3, "보드에서 받은").title);
    await render();
    const appended = [...previous, { key: "card-4", completed: "false" }];
    expect(states()).toEqual(appended);
    expect(container.querySelector(".small-proposal")?.textContent).toContain(card(3, "보드에서 받은").title);
    await remount(); expect(states()).toEqual(appended);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
