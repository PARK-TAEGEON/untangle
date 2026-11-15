// @vitest-environment happy-dom
import { act, createElement } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FloatingMenu } from "../components/floating-menu";
import { BackupMenu } from "../components/backup-menu";
import { WorkspaceProvider } from "../components/workspace-provider";
import { serializeWorkspaceBackup } from "../lib/backup";
import { createSampleWorkspace } from "../lib/sample-mode";
import { loadWorkspace, saveWorkspace, WORKSPACE_STORAGE_KEY } from "../lib/storage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const NOW = "2026-11-16T04:00:00.000Z";
const DAY = "2026-11-16";
let root: Root;
let container: HTMLDivElement;
let anchorRect: DOMRect;
let popupHeight: number;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let cancelFrame: ReturnType<typeof vi.fn>;
const fetchMock = vi.fn<typeof fetch>();

function menu(label = "토픽 메뉴", children: ReactElement = createElement("button", { type: "button" }, "작업")) {
  return createElement(FloatingMenu, { icon: "more", label, children });
}
async function render(child: ReactElement) { await act(async () => root.render(child)); }
function trigger(label = "토픽 메뉴") { return container.querySelector<HTMLButtonElement>(`button[aria-label='${label}']`)!; }
function popup() { return document.querySelector<HTMLDivElement>(".floating-menu-panel"); }
async function click(element: Element | null) { expect(element).not.toBeNull(); await act(async () => (element as HTMLElement).click()); }
async function runFrame() {
  const current = [...frames.values()]; frames.clear();
  await act(async () => { for (const callback of current) callback(16); });
}
function personal() { const data = createSampleWorkspace("game-developer", NOW, DAY); delete data.sample; return data; }

beforeEach(() => {
  window.localStorage.clear();
  anchorRect = new DOMRect(210, 80, 44, 44); popupHeight = 180; frames = new Map(); nextFrame = 0;
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(360);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(320);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("floating-menu-trigger")) return anchorRect;
    if (this.classList.contains("floating-menu-panel")) return new DOMRect(0, 0, 240, popupHeight);
    return new DOMRect();
  });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { const id = ++nextFrame; frames.set(id, callback); return id; });
  cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  expect(document.querySelector(".floating-menu-panel")).toBeNull();
  expect(document.body.dataset.floatingMenuOpen).toBeUndefined();
  expect(frames.size).toBe(0);
  expect(fetchMock).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("floating disclosure menus", () => {
  it("portals out of transformed tiles and preserves the trigger's thread and font context", async () => {
    const focusedVisibility: string[] = [];
    const nativeFocus = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      const menuPanel = this.closest<HTMLElement>(".floating-menu-panel");
      if (menuPanel) focusedVisibility.push(menuPanel.style.visibility);
      nativeFocus.call(this, options);
    });
    await render(createElement("article", { className: "topic-tile", style: { transform: "translateY(-2px)" } }, menu()));
    trigger().style.setProperty("--thread-current", "#3a5bc7");
    trigger().style.fontFamily = "Pretendard";
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    await click(trigger());
    expect(popup()?.parentElement).toBe(document.body);
    expect(container.contains(popup())).toBe(false);
    expect(popup()?.style.position).toBe("fixed");
    expect(popup()?.style.getPropertyValue("--thread-current")).toBe("#3a5bc7");
    expect(popup()?.style.fontFamily).toBe("Pretendard");
    expect(trigger().getAttribute("aria-controls")).toBe(popup()?.id);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(trigger().title).toBe("토픽 메뉴");
    expect(document.body.dataset.floatingMenuOpen).toBe("true");
    expect(document.activeElement).toBe(popup()?.querySelector("button"));
    expect(focusedVisibility).toEqual(["visible"]);
  });

  it("flips above a bottom anchor, clamps to the viewport and limits a tall menu", async () => {
    anchorRect = new DOMRect(0, 264, 44, 44);
    await render(menu()); await click(trigger());
    expect(popup()?.dataset.placement).toBe("top");
    expect(Number.parseFloat(popup()!.style.top)).toBe(76);
    expect(Number.parseFloat(popup()!.style.left)).toBe(12);
    popupHeight = 700;
    await act(async () => window.dispatchEvent(new Event("resize")));
    const panel = popup()!;
    expect(Number.parseFloat(panel.style.maxWidth)).toBe(336);
    expect(Number.parseFloat(panel.style.maxHeight)).toBe(244);
    expect(Number.parseFloat(panel.style.top)).toBe(12);
    expect(Number.parseFloat(panel.style.top) + Number.parseFloat(panel.style.maxHeight)).toBeLessThanOrEqual(308);
  });

  it("tracks scroll, resize and layout-only anchor movement and cancels its frame on close", async () => {
    await render(menu()); await click(trigger());
    expect(popup()?.style.left).toBe("14px");
    anchorRect = new DOMRect(260, 80, 44, 44);
    await runFrame();
    expect(popup()?.style.left).toBe("64px");
    anchorRect = new DOMRect(100, 200, 44, 44);
    await act(async () => document.dispatchEvent(new Event("scroll")));
    expect(popup()?.dataset.placement).toBe("top");
    await click(trigger());
    expect(popup()).toBeNull(); expect(cancelFrame).toHaveBeenCalled(); expect(frames.size).toBe(0);
  });

  it("keeps only one menu open and cleans up after its anchor unmounts", async () => {
    await render(createElement("div", null, menu("첫 메뉴"), menu("둘째 메뉴")));
    await click(trigger("첫 메뉴")); await click(trigger("둘째 메뉴"));
    expect(trigger("첫 메뉴").getAttribute("aria-expanded")).toBe("false");
    expect(trigger("둘째 메뉴").getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelectorAll(".floating-menu-panel")).toHaveLength(1);
    expect(document.body.dataset.floatingMenuOpen).toBe("true");
    await render(createElement("p", null, "토픽을 옮겼어요."));
    expect(popup()).toBeNull(); expect(frames.size).toBe(0);
    expect(document.body.dataset.floatingMenuOpen).toBeUndefined();
  });

  it("returns focus on Escape while an outside pointer keeps its original click action", async () => {
    const outsideClick = vi.fn();
    await render(createElement("div", null, menu(), createElement("button", { id: "outside", onClick: outsideClick }, "바깥 작업")));
    await click(trigger());
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(popup()).toBeNull(); expect(document.activeElement).toBe(trigger());
    await click(trigger());
    const outside = container.querySelector<HTMLButtonElement>("#outside")!;
    await act(async () => {
      outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      outside.focus(); outside.click();
    });
    expect(popup()).toBeNull(); expect(outsideClick).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(outside);
  });

  it("closes after button and select actions without interrupting their handlers", async () => {
    const action = vi.fn(); const change = vi.fn();
    await render(menu("토픽 메뉴", createElement("div", null,
      createElement("button", { disabled: true }, "사용 불가"),
      createElement("button", { onClick: action }, "실행"),
      createElement("select", { "aria-label": "테마", defaultValue: "a", onChange: change }, createElement("option", { value: "a" }, "A"), createElement("option", { value: "b" }, "B")),
    )));
    await click(trigger());
    await click(popup()?.querySelector("button:disabled") ?? null); expect(popup()).not.toBeNull();
    await click(popup()?.querySelector("button:not(:disabled)") ?? null); expect(action).toHaveBeenCalledOnce(); expect(popup()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    await click(trigger());
    const select = popup()!.querySelector("select")!;
    await act(async () => { select.value = "b"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(change).toHaveBeenCalledOnce(); expect(popup()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("keeps a menu opened inside a native modal in its top layer", async () => {
    await render(createElement("dialog", { open: true }, menu())); await click(trigger());
    expect(popup()?.parentElement).toBe(container.querySelector("dialog"));
    expect(popup()?.getAttribute("aria-label")).toBe("토픽 메뉴");
  });

  it("closes the backup picker menu before confirmation and preserves data until replacement", async () => {
    const current = personal(); saveWorkspace(window.localStorage, current);
    const onRestored = vi.fn();
    await render(createElement(WorkspaceProvider, null, createElement(BackupMenu, { onRestored })));
    const fileInput = container.querySelector<HTMLInputElement>("input[type='file']")!;
    const pick = vi.spyOn(fileInput, "click").mockImplementation(() => {});
    await click(trigger("자료 메뉴"));
    const importButton = [...popup()!.querySelectorAll("button")].find((button) => button.textContent === "가져오기")!;
    await click(importButton);
    expect(pick).toHaveBeenCalledOnce(); expect(popup()).toBeNull();
    const before = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    const imported = personal(); imported.topics[0].name = "가져온 가상 토픽";
    Object.defineProperty(fileInput, "files", { configurable: true, value: [new File([serializeWorkspaceBackup(imported, NOW)], "fiction.json", { type: "application/json" })] });
    await act(async () => { fileInput.dispatchEvent(new Event("change", { bubbles: true })); await Promise.resolve(); });
    expect(container.querySelector("dialog")?.open).toBe(true);
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
    await click([...container.querySelectorAll("dialog button")].find((button) => button.textContent === "교체해서 가져오기") ?? null);
    expect(loadWorkspace(window.localStorage)?.topics[0].name).toBe("가져온 가상 토픽");
    expect(onRestored).toHaveBeenCalledOnce(); expect(container.querySelector("dialog")).toBeNull();
  });
});
