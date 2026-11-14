// @vitest-environment happy-dom
import { act, createElement } from "react";
import type { AnchorHTMLAttributes } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Welcome } from "../components/welcome";
import { useWorkspace, WorkspaceProvider } from "../components/workspace-provider";
import { createSampleWorkspace, SAMPLE_PERSONAS } from "../lib/sample-mode";
import { loadWorkspace, saveWorkspace, SAMPLE_WORKSPACE_STORAGE_KEY, WORKSPACE_MODE_STORAGE_KEY, WORKSPACE_STORAGE_KEY } from "../lib/storage";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), links: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("next/link", () => ({ default: ({ onClick, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", {
  ...props,
  onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (!event.defaultPrevented) navigation.links(props.href);
    event.preventDefault();
  },
}, children) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const NOW = "2026-11-13T16:00:00.000Z";
const TODAY = "2026-11-14";
let root: Root;
let container: HTMLDivElement;
let store: ReturnType<typeof useWorkspace>;
let restoreStorageWrite: (() => void) | undefined;
const fetchMock = vi.fn<typeof fetch>();

function personalFixture() {
  const { sample: _sample, ...personal } = createSampleWorkspace("student", NOW, TODAY);
  personal.profile.summary = "보존할 가상 개인 기록";
  personal.cards!.items[0].content = "직접 고친 가상 개인 초안";
  return personal;
}
function Capture() { store = useWorkspace(); return null; }
async function render() {
  await act(async () => { root.render(createElement(WorkspaceProvider, null, createElement(Capture), createElement(Welcome))); });
}
function button(text: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent?.trim() === text)!;
}
async function click(element: HTMLElement | null) {
  expect(element).not.toBeNull();
  await act(async () => element!.click());
}
function personalLink() {
  return [...container.querySelectorAll<HTMLAnchorElement>("a")].find((element) => element.textContent?.trim() === "내 기록으로 시작하기")!;
}
function seedSample() {
  const sample = createSampleWorkspace("game-developer", NOW, TODAY);
  saveWorkspace(window.localStorage, sample, SAMPLE_WORKSPACE_STORAGE_KEY);
  window.localStorage.setItem(WORKSPACE_MODE_STORAGE_KEY, "sample");
}

beforeEach(() => {
  restoreStorageWrite = undefined;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.localStorage.clear();
  saveWorkspace(window.localStorage, personalFixture());
  navigation.push.mockReset(); navigation.replace.mockReset(); navigation.links.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  restoreStorageWrite?.();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("welcome screen with saved workspace isolation", () => {
  it("renders its single heading and tagline without the app header, and waits for browser storage before enabling actions", async () => {
    const html = renderToString(createElement(WorkspaceProvider, null, createElement(Welcome)));
    const server = document.createElement("div"); server.innerHTML = html;
    const sample = [...server.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent?.trim() === "샘플로 둘러보기")!;
    expect(sample.disabled).toBe(true);
    expect(server.querySelector("a[href='/start']")?.getAttribute("aria-disabled")).toBe("true");
    await render();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1[lang='en']")?.textContent).toBe("untangle");
    expect(container.textContent?.replace(/\s+/g, "")).toContain("Everyknotgivesway,onethreadatatime.");
    expect(container.querySelector(".app-header, .ob-header, nav")).toBeNull();
    expect(button("샘플로 둘러보기").disabled).toBe(false);
    expect(personalLink().getAttribute("href")).toBe("/start");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("opens and closes the two persona choices without writing data or requesting cards", async () => {
    const before = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    await render();
    expect(button("샘플로 둘러보기").getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelectorAll(".sample-persona")).toHaveLength(0);
    await click(button("샘플로 둘러보기"));
    expect(button("샘플로 둘러보기").getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll(".sample-persona")).toHaveLength(2);
    for (const persona of SAMPLE_PERSONAS) expect(container.textContent).toContain(persona.title);
    await click(button("샘플로 둘러보기"));
    expect(container.querySelectorAll(".sample-persona")).toHaveLength(0);
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
    expect(window.localStorage.getItem(SAMPLE_WORKSPACE_STORAGE_KEY)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(SAMPLE_PERSONAS)("starts the $title sample locally while preserving personal records", async (persona) => {
    const before = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    await render();
    await click(button("샘플로 둘러보기"));
    const choice = [...container.querySelectorAll<HTMLButtonElement>(".sample-persona")].find((element) => element.textContent?.includes(persona.title))!;
    await click(choice);
    expect(store.mode).toBe("sample");
    expect(store.workspace?.sample?.persona).toBe(persona.id);
    expect(store.workspace?.cards?.items.length).toBeGreaterThan(0);
    expect(loadWorkspace(window.localStorage, SAMPLE_WORKSPACE_STORAGE_KEY)?.sample?.persona).toBe(persona.id);
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
    expect(window.localStorage.getItem(WORKSPACE_MODE_STORAGE_KEY)).toBe("sample");
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith("/");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays on welcome with an error if a sample cannot be saved", async () => {
    const before = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    await render();
    const original = store.workspace;
    await click(button("샘플로 둘러보기"));
    const write = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    restoreStorageWrite = () => write.mockRestore();
    await click(container.querySelector<HTMLButtonElement>(".sample-persona"));
    expect(navigation.push).not.toHaveBeenCalled();
    expect(store.workspace).toBe(original);
    expect(store.mode).toBe("personal");
    expect(container.querySelector("[role='alert']")?.textContent).toBeTruthy();
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
    expect(window.localStorage.getItem(SAMPLE_WORKSPACE_STORAGE_KEY)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("follows the personal-record link without replacing existing personal data", async () => {
    const before = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    await render();
    await click(personalLink());
    expect(navigation.links).toHaveBeenCalledExactlyOnceWith("/start");
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
    expect(window.localStorage.getItem(SAMPLE_WORKSPACE_STORAGE_KEY)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns from sample mode to preserved personal records before following the import link", async () => {
    const before = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    seedSample();
    const storedSample = window.localStorage.getItem(SAMPLE_WORKSPACE_STORAGE_KEY);
    await render();
    await click(personalLink());
    expect(navigation.links).toHaveBeenCalledExactlyOnceWith("/start");
    expect(store.mode).toBe("personal");
    expect(store.workspace?.profile.summary).toBe("보존할 가상 개인 기록");
    expect(store.workspace?.cards?.items[0].content).toBe("직접 고친 가상 개인 초안");
    expect(window.localStorage.getItem(WORKSPACE_MODE_STORAGE_KEY)).toBe("personal");
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
    expect(window.localStorage.getItem(SAMPLE_WORKSPACE_STORAGE_KEY)).toBe(storedSample);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks the personal link and preserves the current sample if exiting sample mode fails", async () => {
    const before = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    seedSample();
    const storedSample = window.localStorage.getItem(SAMPLE_WORKSPACE_STORAGE_KEY);
    await render();
    const original = store.workspace;
    const write = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    restoreStorageWrite = () => write.mockRestore();
    await click(personalLink());
    expect(navigation.links).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(store.workspace).toBe(original);
    expect(store.mode).toBe("sample");
    expect(container.querySelector("[role='alert']")?.textContent).toBeTruthy();
    expect(window.localStorage.getItem(WORKSPACE_MODE_STORAGE_KEY)).toBe("sample");
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
    expect(window.localStorage.getItem(SAMPLE_WORKSPACE_STORAGE_KEY)).toBe(storedSample);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
