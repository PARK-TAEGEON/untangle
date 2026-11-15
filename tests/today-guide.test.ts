// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TodayGuide } from "../components/today-guide";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const KEY = "untangle.today-guide.v1";
let root: Root;
let container: HTMLDivElement;
let restoreStorage: (() => void) | undefined;
async function render(mode = "personal") {
  await act(async () => { root.render(createElement(StrictMode, null, createElement(TodayGuide, { key: mode }))); });
}
beforeEach(() => {
  window.localStorage.clear(); restoreStorage = undefined;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); restoreStorage?.(); vi.restoreAllMocks(); });

describe("one-time Today guide", () => {
  it("keeps all three exact lines visible through StrictMode replay and saves the seen marker once", async () => {
    const write = vi.spyOn(window.localStorage, "setItem");
    await render();
    expect([...container.querySelectorAll("li")].map((item) => item.textContent)).toEqual(["카드는 먼저 건네는 한 걸음", "초안은 고쳐 쓰면 됨", "관심 없으면 ×"]);
    expect(window.localStorage.getItem(KEY)).toBe("seen");
    expect(write.mock.calls.filter(([key]) => key === KEY)).toHaveLength(1);
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("안내 닫기");
    write.mockRestore();
  });

  it("closes without changing saved app data or showing again after another mode mounts", async () => {
    window.localStorage.setItem("untangle.workspace.v1", "unchanged personal data");
    await render();
    await act(async () => { container.querySelector<HTMLButtonElement>("button")!.click(); });
    expect(container.querySelector("aside")).toBeNull();
    expect(window.localStorage.getItem("untangle.workspace.v1")).toBe("unchanged personal data");
    await render("sample");
    expect(container.querySelector("aside")).toBeNull();
  });

  it("does not show on later visits even if the initial guide was never explicitly closed", async () => {
    await render(); expect(container.querySelector("aside")).not.toBeNull();
    await act(async () => root.unmount()); root = createRoot(container);
    await render(); expect(container.querySelector("aside")).toBeNull();
  });

  it("can show and close when browser storage is unavailable", async () => {
    const read = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    const write = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    restoreStorage = () => { read.mockRestore(); write.mockRestore(); };
    await render(); expect(container.querySelector("aside")).not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(container.querySelector("aside")).toBeNull();
  });

  it("shows again after the app-owned seen marker is cleared", async () => {
    window.localStorage.setItem(KEY, "seen"); await render();
    expect(container.querySelector("aside")).toBeNull();
    window.localStorage.removeItem(KEY);
    await render("fresh-visit");
    expect(container.querySelector("aside")).not.toBeNull();
  });

  it("does not read browser storage during the server render", () => {
    expect(renderToString(createElement(TodayGuide))).toBe("");
  });
});
