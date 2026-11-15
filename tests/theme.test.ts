// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "../components/theme-toggle";
import { clearKnownAppData } from "../lib/app-data";
import { getServerThemePreferenceSnapshot, getServerThemeSnapshot, getThemePreferenceSnapshot, getThemeSnapshot, setTheme, setThemePreference, subscribeTheme, THEME_CHANGE_EVENT, THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "../lib/theme";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const DARK_QUERY = "(prefers-color-scheme: dark)";
let media: MediaQueryList;
let container: HTMLDivElement;
let root: Root | undefined;
let unsubscribe: (() => void) | undefined;
let restoreWrite: (() => void) | undefined;

function changeSystem(dark: boolean) {
  Object.defineProperty(media, "matches", { configurable: true, value: dark });
  media.dispatchEvent(new Event("change"));
}

function storageChange(key: string | null, newValue: string | null, storageArea: Storage = window.localStorage) {
  window.dispatchEvent(new StorageEvent("storage", { key, newValue, storageArea }));
}

async function renderToggles(count = 1) {
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(StrictMode, null, Array.from({ length: count }, (_, key) => createElement(ThemeToggle, { key }))));
  });
}

function labels() {
  return [...container.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"));
}

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  const target = new EventTarget();
  Object.defineProperties(target, { matches: { configurable: true, value: false }, media: { value: DARK_QUERY } });
  media = target as MediaQueryList;
  vi.spyOn(window, "matchMedia").mockReturnValue(media);
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  unsubscribe?.(); unsubscribe = undefined;
  restoreWrite?.(); restoreWrite = undefined;
  container.remove();
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("theme preference and toggle", () => {
  it.each([setTheme, setThemePreference])("does not restore a theme after erase while a native transition is queued (%#)", (choose) => {
    const original = document.startViewTransition;
    let queued: (() => void) | undefined;
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: (change: () => void) => {
      queued = change;
      return { ready: Promise.resolve(), finished: Promise.resolve(), updateCallbackDone: Promise.resolve() };
    } });
    try {
      choose("dark");
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
      expect(queued).toBeTypeOf("function");
      clearKnownAppData(window.localStorage, "theme-clear-test");
      delete document.documentElement.dataset.theme;
      window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
      queued!();
      expect(document.documentElement.dataset.theme).toBeUndefined();
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    } finally { Object.defineProperty(document, "startViewTransition", { configurable: true, value: original }); }
  });

  it("keeps the newer theme when native callbacks finish out of order", () => {
    const original = document.startViewTransition;
    const queued: Array<() => void> = [];
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: (change: () => void) => {
      queued.push(change);
      return { ready: Promise.resolve(), finished: Promise.resolve(), updateCallbackDone: Promise.resolve() };
    } });
    try {
      setTheme("dark"); setThemePreference("light");
      queued[1](); queued[0]();
      expect(document.documentElement.dataset.theme).toBe("light");
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    } finally { Object.defineProperty(document, "startViewTransition", { configurable: true, value: original }); }
  });

  it("keeps the explicit settings choice distinct from the resolved system theme", () => {
    expect(getServerThemePreferenceSnapshot()).toBe("system");
    expect(getThemePreferenceSnapshot()).toBe("system");
    changeSystem(true);
    expect(getThemeSnapshot()).toBe("dark");
    expect(getThemePreferenceSnapshot()).toBe("system");
    setThemePreference("light");
    expect(getThemePreferenceSnapshot()).toBe("light");
    setThemePreference("system");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(getThemeSnapshot()).toBe("dark");
    changeSystem(false);
    expect(getThemeSnapshot()).toBe("light");
  });

  it("reports a rejected settings write without changing the view or notifying readers", () => {
    setThemePreference("dark");
    const listener = vi.fn();
    unsubscribe = subscribeTheme(listener);
    const write = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    restoreWrite = () => write.mockRestore();
    expect(() => setThemePreference("system")).toThrow();
    expect(getThemePreferenceSnapshot()).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(listener).not.toHaveBeenCalled();
  });

  it("synchronizes a saved system choice from another tab", () => {
    const listener = vi.fn();
    unsubscribe = subscribeTheme(listener);
    setTheme("light");
    changeSystem(true);
    storageChange(THEME_STORAGE_KEY, "system");
    expect(getThemePreferenceSnapshot()).toBe("system");
    expect(getThemeSnapshot()).toBe("dark");
  });

  it("follows the device until the user explicitly chooses either theme", () => {
    expect(getThemeSnapshot()).toBe("light");
    changeSystem(true);
    expect(getThemeSnapshot()).toBe("dark");
    document.documentElement.dataset.theme = "light";
    expect(getThemeSnapshot()).toBe("light");
    changeSystem(false);
    document.documentElement.dataset.theme = "dark";
    expect(getThemeSnapshot()).toBe("dark");
  });

  it("hydrates stable server markup before reflecting a dark device preference", async () => {
    changeSystem(true);
    expect(getServerThemeSnapshot()).toBe("light");
    container.innerHTML = renderToString(createElement(ThemeToggle));
    expect(labels()).toEqual(["어두운 모드로 전환"]);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { root = hydrateRoot(container, createElement(ThemeToggle)); });
    expect(labels()).toEqual(["밝은 모드로 전환"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("persists explicit choices and synchronizes every toggle in the current tab", async () => {
    await renderToggles(2);
    await act(async () => { container.querySelector("button")!.click(); });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(labels()).toEqual(["밝은 모드로 전환", "밝은 모드로 전환"]);
    await act(async () => { container.querySelectorAll("button")[1].click(); });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(labels()).toEqual(["어두운 모드로 전환", "어두운 모드로 전환"]);
  });

  it("updates for device changes without overriding an explicit choice", async () => {
    await renderToggles();
    await act(async () => { changeSystem(true); });
    expect(labels()).toEqual(["밝은 모드로 전환"]);
    expect(document.documentElement.dataset.theme).toBeUndefined();
    await act(async () => { container.querySelector("button")!.click(); });
    await act(async () => { changeSystem(false); changeSystem(true); });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(labels()).toEqual(["어두운 모드로 전환"]);
  });

  it("applies another tab's preference and returns to device settings when it is cleared", async () => {
    await renderToggles();
    await act(async () => { storageChange(THEME_STORAGE_KEY, "dark"); });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(labels()).toEqual(["밝은 모드로 전환"]);
    await act(async () => { storageChange(THEME_STORAGE_KEY, "light"); });
    expect(labels()).toEqual(["어두운 모드로 전환"]);
    await act(async () => { changeSystem(true); storageChange(THEME_STORAGE_KEY, null); });
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(labels()).toEqual(["밝은 모드로 전환"]);
    await act(async () => { storageChange(THEME_STORAGE_KEY, "light"); storageChange(null, null); });
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(labels()).toEqual(["밝은 모드로 전환"]);
  });

  it("ignores unrelated storage and recovers from an invalid stored preference", () => {
    const listener = vi.fn();
    unsubscribe = subscribeTheme(listener);
    setTheme("dark"); listener.mockClear();
    storageChange("another.setting", "light");
    storageChange(THEME_STORAGE_KEY, "light", window.sessionStorage);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(listener).not.toHaveBeenCalled();
    storageChange(THEME_STORAGE_KEY, "invalid");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(getThemeSnapshot()).toBe("light");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("keeps the toggle usable when browser storage rejects writes", async () => {
    const write = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    restoreWrite = () => write.mockRestore();
    await renderToggles(2);
    await act(async () => { container.querySelector("button")!.click(); });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(labels()).toEqual(["밝은 모드로 전환", "밝은 모드로 전환"]);
    expect(write).toHaveBeenCalledWith(THEME_STORAGE_KEY, "dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("removes device, same-tab and cross-tab subscriptions on cleanup", () => {
    const listener = vi.fn();
    unsubscribe = subscribeTheme(listener);
    changeSystem(true);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
    storageChange(THEME_STORAGE_KEY, "light");
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe(); unsubscribe = undefined;
    listener.mockClear();
    changeSystem(false);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
    storageChange(THEME_STORAGE_KEY, "dark");
    expect(listener).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

describe("pre-paint theme initialization", () => {
  function initialize(storage: Pick<Storage, "getItem">) {
    new Function("localStorage", "document", THEME_INIT_SCRIPT)(storage, document);
  }

  it.each(["light", "dark"])("applies a saved %s preference before React starts", (theme) => {
    const getItem = vi.fn(() => theme);
    initialize({ getItem });
    expect(getItem).toHaveBeenCalledWith(THEME_STORAGE_KEY);
    expect(document.documentElement.dataset.theme).toBe(theme);
  });

  it.each([null, "", "system", "invalid"])("leaves CSS device selection active for %s", (value) => {
    initialize({ getItem: () => value });
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(window.matchMedia).not.toHaveBeenCalled();
  });

  it("does not interrupt rendering when storage reads are blocked", () => {
    expect(() => initialize({ getItem: () => { throw new DOMException("Blocked", "SecurityError"); } })).not.toThrow();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
