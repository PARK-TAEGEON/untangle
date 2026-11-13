// @vitest-environment happy-dom
import { act, createElement, startTransition, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppTransitions } from "../components/app-transitions";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let reduced: boolean;
let mediaEvents: EventTarget;
let originalNative: typeof document.startViewTransition;
let originalFonts: PropertyDescriptor | undefined;
let originalAnimations: PropertyDescriptor | undefined;
const native = vi.fn();
const commits = vi.fn();

function Routes() {
  const [page, setPage] = useState("today");
  useEffect(() => { commits(page); }, [page]);
  useEffect(() => {
    const restore = () => startTransition(() => setPage("today"));
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  return createElement(AppTransitions, null, createElement("main", null,
    createElement("h1", null, page),
    createElement("input", { "aria-label": "보관할 초안", defaultValue: "이전 초안" }),
    createElement("button", { onClick: () => startTransition(() => setPage("topics")) }, "버튼 이동"),
    createElement("a", { href: "/done", onClick: (event: React.MouseEvent) => { event.preventDefault(); startTransition(() => setPage("done")); } }, "링크 이동"),
  ));
}
async function click(selector: string) { await act(async () => container.querySelector<HTMLElement>(selector)!.click()); }

beforeEach(async () => {
  reduced = false;
  mediaEvents = new EventTarget();
  const media = mediaEvents;
  Object.defineProperty(media, "matches", { get: () => reduced });
  vi.spyOn(window, "matchMedia").mockReturnValue(media as MediaQueryList);
  commits.mockReset();
  originalNative = document.startViewTransition;
  originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
  originalAnimations = Object.getOwnPropertyDescriptor(document.documentElement, "getAnimations");
  native.mockReset().mockImplementation((options: { update: () => void | Promise<void> }) => {
    const done = Promise.resolve().then(options.update);
    return { ready: done, finished: done, updateCallbackDone: done, skipTransition: vi.fn(), types: new Set() };
  });
  Object.defineProperty(document, "startViewTransition", { configurable: true, value: native });
  Object.defineProperty(document, "fonts", { configurable: true, value: { status: "loaded", ready: Promise.resolve() } });
  Object.defineProperty(document.documentElement, "getAnimations", { configurable: true, value: () => [] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Routes)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Object.defineProperty(document, "startViewTransition", { configurable: true, value: originalNative });
  if (originalFonts) Object.defineProperty(document, "fonts", originalFonts);
  else Reflect.deleteProperty(document, "fonts");
  if (originalAnimations) Object.defineProperty(document.documentElement, "getAnimations", originalAnimations);
  else Reflect.deleteProperty(document.documentElement, "getAnimations");
  vi.restoreAllMocks();
});

describe("React navigation snapshot boundary", () => {
  it("crossfades link, programmatic button and history transitions without intercepting routing", async () => {
    await click("a");
    expect(container.querySelector("h1")?.textContent).toBe("done");
    expect(native).toHaveBeenCalledTimes(1);
    await click("button");
    expect(container.querySelector("h1")?.textContent).toBe("topics");
    expect(native).toHaveBeenCalledTimes(2);
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(container.querySelector("h1")?.textContent).toBe("today");
    expect(native).toHaveBeenCalledTimes(3);
  });

  it("keeps the draft and focus when the motion preference changes and skips native snapshots", async () => {
    const input = container.querySelector<HTMLInputElement>("input")!;
    input.value = "고친 초안";
    input.focus();
    reduced = true;
    await act(async () => mediaEvents.dispatchEvent(new Event("change")));
    expect(container.querySelector("input")).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("고친 초안");
    await click("button");
    expect(container.querySelector("h1")?.textContent).toBe("topics");
    expect(native).not.toHaveBeenCalled();
  });

  it("keeps ordinary navigation working when native snapshots are unavailable", async () => {
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: undefined });
    await act(async () => mediaEvents.dispatchEvent(new Event("change")));
    await click("button");
    expect(container.querySelector("h1")?.textContent).toBe("topics");
    expect(native).not.toHaveBeenCalled();
  });

  it.each([false, true])("commits navigation once when native capture throws (already applied: %s)", async (alreadyApplied) => {
    native.mockImplementation((options: { update: () => void }) => {
      if (alreadyApplied) options.update();
      throw new Error("capture unavailable");
    });
    await click("button");
    expect(container.querySelector("h1")?.textContent).toBe("topics");
    expect(native).toHaveBeenCalledTimes(1);
    expect(commits.mock.calls.map(([page]) => page)).toEqual(["today", "topics"]);
  });
});
