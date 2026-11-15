// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import type { AnchorHTMLAttributes } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Topics } from "../components/topics";
import { WorkspaceProvider } from "../components/workspace-provider";
import { emptyCardState } from "../lib/card-state";
import { createSampleWorkspace } from "../lib/sample-mode";
import { loadWorkspace, saveWorkspace, WORKSPACE_STORAGE_KEY } from "../lib/storage";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("next/link", () => ({ default: ({ onClick, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", {
  ...props, onClick: (event: React.MouseEvent<HTMLAnchorElement>) => { event.preventDefault(); onClick?.(event); },
}, children) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const NOW = "2026-11-16T04:00:00.000Z";
const DAY = "2026-11-16";
let root: Root;
let container: HTMLDivElement;
let restoreWrite: (() => void) | undefined;
const fetchMock = vi.fn<typeof fetch>();

function workspace() {
  const data = createSampleWorkspace("game-developer", NOW, DAY);
  delete data.sample;
  const base = data.topics[0];
  data.topics = [
    { ...base, id: "alpha", name: "Alpha", one_liner: "첫 작업", state: "active", theme: "닫힌 테마", starred: true },
    { ...base, id: "beta", name: "Beta", one_liner: "shared NOTE", state: "active", theme: "열린 테마", starred: true },
    { ...base, id: "later", name: "나중 별", one_liner: "SHARED note", state: "later", theme: "닫힌 테마", starred: true },
    { ...base, id: "delta", name: "Delta", one_liner: "남은 작업", state: "active", theme: "열린 테마", starred: false },
    { ...base, id: "epsilon", name: "나중 작업", one_liner: "shared 기록", state: "later", theme: "열린 테마", starred: false },
    { ...base, id: "solo", name: "따로 작업", one_liner: "분리한 작업", state: "active", theme: null, starred: false },
  ];
  data.themes = [{ name: "닫힌 테마", collapsed: true }, { name: "열린 테마", collapsed: false }];
  data.later_collapsed = true;
  data.cards = emptyCardState(); data.completed_steps = [];
  return data;
}
async function render() { await act(async () => root.render(createElement(StrictMode, null, createElement(WorkspaceProvider, null, createElement(Topics))))); }
async function click(element: Element | null) { expect(element).not.toBeNull(); await act(async () => (element as HTMLElement).click()); }
function tile(id: string) { return container.querySelector(`.topic-tile-link[href='/topics/${id}']`)?.closest(".topic-tile") ?? null; }
function star(id: string) { return tile(id)?.querySelector<HTMLButtonElement>(".topic-star-button") ?? null; }
function listed(section: string) { return [...container.querySelectorAll(`${section} .topic-tile-link`)].map((link) => link.getAttribute("href")); }
function occurrences(id: string) { return container.querySelectorAll(`.topic-tile-link[href='/topics/${id}']`).length; }
function notices() { return [...document.querySelectorAll(".topic-star-notice[role='status']")]; }
async function search(value: string) {
  const input = container.querySelector<HTMLInputElement>("input[aria-label='토픽 검색']")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] }); vi.setSystemTime(NOW);
  window.localStorage.clear(); saveWorkspace(window.localStorage, workspace());
  navigation.push.mockReset(); navigation.replace.mockReset();
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  restoreWrite?.(); restoreWrite = undefined;
  container.remove();
  expect(fetchMock).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("pinned starred topics", () => {
  it("collects active and later stars once above the remaining original groups", async () => {
    await render();
    expect(listed(".topics-starred")).toEqual(["/topics/alpha", "/topics/beta", "/topics/later"]);
    expect(listed(".topics-groups")).toEqual(["/topics/delta", "/topics/solo"]);
    expect(container.querySelector(".topics-starred")?.getAttribute("aria-label")).toBe("별 표시한 토픽");
    expect(container.querySelector(".topics-starred h2")?.textContent).toBe("고정 3");
    expect(container.querySelector(".topics-later .group-count")?.textContent).toBe("1");
    expect(container.querySelector(".topics-heading .count-chip")?.textContent).toBe("활성 4");
    for (const id of ["alpha", "beta", "later"]) expect(occurrences(id)).toBe(1);
    expect(star("alpha")?.getAttribute("aria-pressed")).toBe("true");
    expect(star("alpha")?.style.getPropertyValue("--thread-current")).toBe("var(--thread-1)");
    expect(star("beta")?.style.getPropertyValue("--thread-current")).toBe("var(--thread-2)");
    expect(star("delta")?.getAttribute("aria-pressed")).toBe("false");
    expect(star("delta")?.disabled).toBe(false);
  });

  it("returns an unstarred active topic to its original theme and persists it after remounting", async () => {
    await render(); await click(star("beta"));
    expect(listed(".topics-starred")).toEqual(["/topics/alpha", "/topics/later"]);
    expect(listed(".topics-groups")).toEqual(["/topics/beta", "/topics/delta", "/topics/solo"]);
    expect(occurrences("beta")).toBe(1);
    const saved = loadWorkspace(window.localStorage)!.topics.find((topic) => topic.id === "beta")!;
    expect({ starred: saved.starred, state: saved.state, theme: saved.theme }).toEqual({ starred: false, state: "active", theme: "열린 테마" });
    await act(async () => root.unmount()); root = createRoot(container); await render();
    expect(listed(".topics-starred")).not.toContain("/topics/beta");
    expect(listed(".topics-groups")).toContain("/topics/beta");
  });

  it("returns a later star to its saved collapsed later group without changing state or theme", async () => {
    await render(); await click(star("later"));
    expect(tile("later")).toBeNull();
    const saved = loadWorkspace(window.localStorage)!;
    const later = saved.topics.find((topic) => topic.id === "later")!;
    expect({ starred: later.starred, state: later.state, theme: later.theme }).toEqual({ starred: false, state: "later", theme: "닫힌 테마" });
    expect(saved.later_collapsed).toBe(true);
    expect(container.querySelector(".topics-later .group-count")?.textContent).toBe("2");
    await click(container.querySelector(".topics-later > button"));
    expect(listed(".topics-later")).toEqual(["/topics/later", "/topics/epsilon"]);
    await click(star("later"));
    expect(listed(".topics-starred")).toContain("/topics/later");
    expect(listed(".topics-later")).toEqual(["/topics/epsilon"]);
    expect(occurrences("later")).toBe(1);
  });

  it("hides the pinned section when the final star is removed", async () => {
    await render();
    for (const id of ["alpha", "beta", "later"]) await click(star(id));
    expect(container.querySelector(".topics-starred")).toBeNull();
    expect(loadWorkspace(window.localStorage)!.topics.filter((topic) => topic.starred)).toHaveLength(0);
    expect(listed(".topics-groups")).toEqual(["/topics/beta", "/topics/delta", "/topics/solo"]);
  });

  it("keeps the fourth star button usable and announces the limit without changing stored data", async () => {
    await render();
    const before = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    expect(star("delta")?.disabled).toBe(false);
    expect(star("delta")?.getAttribute("aria-label")).toBe("Delta 별 표시");
    await click(star("delta"));
    expect(notices().map((item) => item.textContent)).toEqual(["별은 세 개까지예요"]);
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
    expect(loadWorkspace(window.localStorage)!.topics.filter((topic) => topic.starred)).toHaveLength(3);
    expect(star("delta")?.getAttribute("aria-pressed")).toBe("false");
    expect(listed(".topics-starred")).not.toContain("/topics/delta");
  });

  it("uses one temporary status notice across different star buttons", async () => {
    await render(); await click(star("delta")); await click(star("solo"));
    expect(notices()).toHaveLength(1);
    expect(notices()[0].textContent).toBe("별은 세 개까지예요");
    await act(async () => vi.advanceTimersByTime(5000));
    expect(notices()).toHaveLength(0);
  });

  it("closes the fourth-star menu and keeps its global limit notice for five seconds without saving", async () => {
    await render();
    const before = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    const trigger = tile("delta")!.querySelector<HTMLButtonElement>("button[aria-label='Delta 메뉴']")!;
    await click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const panel = document.querySelector(".floating-menu-panel.topic-menu-panel[role='group'][aria-label='Delta 메뉴']");
    expect(panel).not.toBeNull();
    expect(container.contains(panel)).toBe(false);
    const action = [...panel!.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === "별 표시")!;
    expect(action.disabled).toBe(false);
    await click(action);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".floating-menu-panel")).toBeNull();
    expect(notices().map((item) => item.textContent)).toEqual(["별은 세 개까지예요"]);
    expect(notices()[0].parentElement).toBe(document.body);
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
    expect(loadWorkspace(window.localStorage)!.topics.filter((topic) => topic.starred)).toHaveLength(3);
    await act(async () => vi.advanceTimersByTime(4999));
    expect(notices()).toHaveLength(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(notices()).toHaveLength(0);
  });

  it("returns a menu-unstarred pinned topic once to its original theme without leaving a portal", async () => {
    await render();
    const trigger = tile("beta")!.querySelector<HTMLButtonElement>("button[aria-label='Beta 메뉴']")!;
    await click(trigger);
    const panel = document.querySelector(".floating-menu-panel.topic-menu-panel[aria-label='Beta 메뉴']");
    expect(panel).not.toBeNull();
    const action = [...panel!.querySelectorAll("button")].find((item) => item.textContent?.trim() === "별 해제") ?? null;
    await click(action);
    expect(document.querySelector(".floating-menu-panel")).toBeNull();
    expect(document.querySelector(".topic-menu-panel")).toBeNull();
    expect(listed(".topics-starred")).not.toContain("/topics/beta");
    expect(listed(".topics-groups")).toContain("/topics/beta");
    expect(occurrences("beta")).toBe(1);
    expect(trigger.isConnected).toBe(false);
    expect(tile("beta")?.querySelector("button[aria-label='Beta 메뉴']")?.getAttribute("aria-expanded")).toBe("false");
    const saved = loadWorkspace(window.localStorage)!.topics.find((topic) => topic.id === "beta")!;
    expect({ starred: saved.starred, state: saved.state, theme: saved.theme }).toEqual({ starred: false, state: "active", theme: "열린 테마" });
    expect(notices()).toHaveLength(0);
  });

  it("searches pinned and later topics without duplicates and restores their original visibility", async () => {
    await render();
    const before = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    await search("sHaReD");
    expect(listed(".topics-starred")).toEqual(["/topics/beta", "/topics/later"]);
    expect(listed(".topics-groups")).toEqual([]);
    expect(listed(".topics-later")).toEqual(["/topics/epsilon"]);
    expect(container.querySelector(".topics-heading .count-chip")?.textContent).toBe("검색 결과 3");
    for (const id of ["beta", "later", "epsilon"]) expect(occurrences(id)).toBe(1);
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
    await click(star("beta"));
    expect(listed(".topics-starred")).toEqual(["/topics/later"]);
    expect(listed(".topics-groups")).toEqual(["/topics/beta"]);
    expect(occurrences("beta")).toBe(1);
    expect(container.querySelector(".topics-heading .count-chip")?.textContent).toBe("검색 결과 3");
    await search("no results");
    expect(container.querySelector(".topics-starred")).toBeNull();
    expect(container.textContent).toContain("찾는 토픽이 없어요.");
    await search("");
    expect(listed(".topics-starred")).toEqual(["/topics/alpha", "/topics/later"]);
    expect(container.querySelector(".topics-later > button")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("preserves the pinned topic when saving an unstar action fails", async () => {
    await render();
    const before = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    const write = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    restoreWrite = () => write.mockRestore();
    await click(star("beta"));
    expect(star("beta")?.getAttribute("aria-pressed")).toBe("true");
    expect(listed(".topics-starred")).toContain("/topics/beta");
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
    expect(container.querySelector(".app-error")?.textContent).toBeTruthy();
    expect(notices()).toHaveLength(0);
  });
});
