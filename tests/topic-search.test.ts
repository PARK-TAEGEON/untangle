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
const NOW = "2026-11-15T04:00:00.000Z";
const DAY = "2026-11-15";
let root: Root;
let container: HTMLDivElement;
const fetchMock = vi.fn<typeof fetch>();

function workspace() {
  const data = createSampleWorkspace("game-developer", NOW, DAY);
  delete data.sample;
  const base = data.topics[0];
  data.topics = [
    { ...base, id: "alpha", name: "Alpha 연구", one_liner: "협업 계획", state: "active", theme: "닫힌 테마", starred: false },
    { ...base, id: "beta", name: "Beta project", one_liner: "Mapping NOTES", state: "active", theme: "열린 테마", starred: false },
    { ...base, id: "later", name: "나중 실험", one_liner: "ALPHA 기록", state: "later", theme: "닫힌 테마", starred: false },
    { ...base, id: "solo", name: "조각 작업", one_liner: "한글 설명", state: "active", theme: null, starred: false },
  ];
  data.themes = [{ name: "닫힌 테마", collapsed: true }, { name: "열린 테마", collapsed: false }, { name: "활성 없는 테마", collapsed: false }];
  data.later_collapsed = true;
  data.cards = emptyCardState();
  data.completed_steps = [];
  return data;
}
async function render() {
  await act(async () => root.render(createElement(StrictMode, null, createElement(WorkspaceProvider, null, createElement(Topics)))));
}
async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => (element as HTMLElement).click());
}
async function search(value: string) {
  const input = container.querySelector<HTMLInputElement>("input[aria-label='토픽 검색']")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function button(name: string) { return [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === name) ?? null; }
function names() { return [...container.querySelectorAll(".topic-tile-link .topic-name")].map((item) => item.textContent); }
function tile(id: string) { return container.querySelector(`.topic-tile-link[href='/topics/${id}']`)?.closest(".topic-tile") ?? null; }
function themeButton(name: string) { return [...container.querySelectorAll<HTMLButtonElement>(".theme-box-header .group-toggle")].find((item) => item.textContent?.includes(name)); }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  window.localStorage.clear();
  saveWorkspace(window.localStorage, workspace());
  navigation.push.mockReset(); navigation.replace.mockReset();
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  expect(fetchMock).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("local topic search", () => {
  it("adds an accessible search field while preserving the original groups and later collapse", async () => {
    await render();
    expect(container.querySelector("input[aria-label='토픽 검색']")?.getAttribute("placeholder")).toBe("이름이나 한 줄 설명으로 검색");
    expect(names()).toEqual(["Beta project", "조각 작업"]);
    expect(themeButton("닫힌 테마")?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".topics-later > button")?.getAttribute("aria-expanded")).toBe("false");
    expect(themeButton("활성 없는 테마")).toBeUndefined();
  });

  it("matches names and descriptions case-insensitively across active/later and expands only matching groups without saving", async () => {
    const before = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    await render();
    await search("  aLpHa  ");
    expect(names()).toEqual(["Alpha 연구", "나중 실험"]);
    expect(container.querySelector(".topics-heading [role='status']")?.textContent).toBe("검색 결과 2");
    expect(themeButton("닫힌 테마")?.getAttribute("aria-expanded")).toBe("true");
    expect(themeButton("닫힌 테마")?.disabled).toBe(true);
    expect(themeButton("열린 테마")).toBeUndefined();
    expect(container.querySelector(".topics-later > button")?.getAttribute("aria-expanded")).toBe("true");
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
    await click(button("검색 지우기"));
    expect(container.querySelector<HTMLInputElement>("input[type='search']")?.value).toBe("");
    expect(names()).toEqual(["Beta project", "조각 작업"]);
    expect(themeButton("닫힌 테마")?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".topics-later > button")?.getAttribute("aria-expanded")).toBe("false");
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
  });

  it("updates on each input for description-only and unthemed Korean matches", async () => {
    await render();
    await search("mApPiNg");
    expect(names()).toEqual(["Beta project"]);
    expect(container.querySelector(".topics-later")).toBeNull();
    await search("한글".normalize("NFD"));
    expect(names()).toEqual(["조각 작업"]);
    expect(container.querySelector(".theme-box-header")?.textContent).toContain("따로 뺀 토픽");
  });

  it("shows an empty search result and returns to the full view when cleared", async () => {
    await render();
    await search("없는 검색어");
    expect(names()).toEqual([]);
    expect(container.textContent).toContain("찾는 토픽이 없어요.");
    expect(container.querySelector(".topics-heading [role='status']")?.textContent).toBe("검색 결과 0");
    expect(container.querySelectorAll(".theme-box")).toHaveLength(0);
    expect(container.querySelector(".topics-later")).toBeNull();
    await search("");
    expect(names()).toEqual(["Beta project", "조각 작업"]);
    expect(container.textContent).not.toContain("찾는 토픽이 없어요.");
  });

  it("treats whitespace as no query and restores user-chosen collapse values after search", async () => {
    await render();
    await search("   ");
    expect(names()).toEqual(["Beta project", "조각 작업"]);
    expect(themeButton("닫힌 테마")?.disabled).toBe(false);
    await click(themeButton("닫힌 테마") ?? null);
    expect(loadWorkspace(window.localStorage)?.themes.find((theme) => theme.name === "닫힌 테마")?.collapsed).toBe(false);
    const before = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    await search("alpha");
    await search("");
    expect(names()).toEqual(["Alpha 연구", "Beta project", "조각 작업"]);
    expect(themeButton("닫힌 테마")?.getAttribute("aria-expanded")).toBe("true");
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
  });

  it("keeps starring, the topic menu and later/undo working inside filtered results", async () => {
    await render(); await search("alpha");
    await click(tile("alpha")!.querySelector("button[aria-label='Alpha 연구 별 표시']"));
    expect(loadWorkspace(window.localStorage)?.topics.find((topic) => topic.id === "alpha")?.starred).toBe(true);
    await click(tile("alpha")!.querySelector("summary"));
    const later = [...tile("alpha")!.querySelectorAll("button")].find((item) => item.textContent === "나중에")!;
    await click(later);
    expect(loadWorkspace(window.localStorage)?.topics.find((topic) => topic.id === "alpha")?.state).toBe("later");
    expect(container.querySelectorAll(".topics-later .topic-tile")).toHaveLength(2);
    await click(button("되돌리기"));
    const saved = loadWorkspace(window.localStorage)!;
    expect(saved.topics.find((topic) => topic.id === "alpha")?.state).toBe("active");
    expect(saved.topics.find((topic) => topic.id === "alpha")?.starred).toBe(true);
    expect(saved.themes.find((theme) => theme.name === "닫힌 테마")?.collapsed).toBe(true);
    expect(container.querySelector<HTMLInputElement>("input[type='search']")?.value).toBe("alpha");
    expect(names()).toEqual(["Alpha 연구", "나중 실험"]);
  });

  it("keeps delete/undo and the current query when a matching result disappears", async () => {
    await render(); await search("mapping");
    await click(tile("beta")!.querySelector("summary"));
    await click([...tile("beta")!.querySelectorAll("button")].find((item) => item.textContent === "삭제") ?? null);
    expect(names()).toEqual([]);
    expect(container.textContent).toContain("찾는 토픽이 없어요.");
    await click(button("되돌리기"));
    expect(names()).toEqual(["Beta project"]);
    expect(container.querySelector<HTMLInputElement>("input[type='search']")?.value).toBe("mapping");
    expect(loadWorkspace(window.localStorage)?.topics.some((topic) => topic.id === "beta")).toBe(true);
  });

  it("preserves the existing no-topics screen outside an active search", async () => {
    const empty = workspace(); empty.topics = [];
    saveWorkspace(window.localStorage, empty);
    await render();
    expect(container.textContent).toContain("아직 담긴 토픽이 없어요.");
    await search("anything");
    expect(container.textContent).toContain("찾는 토픽이 없어요.");
    expect(container.textContent).not.toContain("아직 담긴 토픽이 없어요.");
    await click(button("검색 지우기"));
    expect(container.textContent).toContain("아직 담긴 토픽이 없어요.");
  });
});
