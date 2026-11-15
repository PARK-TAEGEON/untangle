// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePreferences } from "../components/use-preferences";
import { canAnimateNavigation, reducedMotion, subscribeMotionPreference, visualTransition } from "../lib/motion";
import { DEFAULT_PREFERENCES, getPreferencesSnapshot, getServerPreferencesSnapshot, PREFERENCES_CHANGE_EVENT, PREFERENCES_INIT_SCRIPT, PREFERENCES_STORAGE_KEY, resetPreferencesView, savePreferences, subscribePreferences } from "../lib/preferences";
import type { Preferences } from "../lib/preferences";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root | undefined;
let unsubscribe: (() => void) | undefined;
let restoreWrite: (() => void) | undefined;
let media: MediaQueryList;
const large: Preferences = { textSize: "large", reduceMotion: true, cardLimit: 1 };

function Values() {
  const value = usePreferences();
  return createElement("output", null, `${value.textSize}/${value.reduceMotion}/${value.cardLimit}`);
}
function storageChange(key: string | null, newValue: string | null, storageArea: Storage = window.localStorage) {
  if (storageArea === window.localStorage) {
    if (key === null) window.localStorage.clear();
    else if (newValue === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, newValue);
  }
  window.dispatchEvent(new StorageEvent("storage", { key, newValue, storageArea }));
}
function initialize(value: string | null) {
  new Function("localStorage", "document", PREFERENCES_INIT_SCRIPT)({ getItem: () => value }, document);
}

beforeEach(() => {
  window.localStorage.clear();
  getPreferencesSnapshot();
  delete document.documentElement.dataset.textSize;
  delete document.documentElement.dataset.reducedMotion;
  const target = new EventTarget();
  Object.defineProperty(target, "matches", { configurable: true, value: false });
  media = target as MediaQueryList;
  vi.spyOn(window, "matchMedia").mockReturnValue(media);
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  unsubscribe?.(); unsubscribe = undefined;
  restoreWrite?.(); restoreWrite = undefined;
  container.remove();
  vi.restoreAllMocks();
  window.localStorage.clear();
  getPreferencesSnapshot();
  delete document.documentElement.dataset.textSize;
  delete document.documentElement.dataset.reducedMotion;
});

describe("saved display preferences", () => {
  it("keeps stable default/server snapshots and stable equivalent stored values", () => {
    const first = getPreferencesSnapshot();
    expect(first).toEqual({ textSize: "normal", reduceMotion: false, cardLimit: 3 });
    expect(getPreferencesSnapshot()).toBe(first);
    expect(getServerPreferencesSnapshot()).toBe(DEFAULT_PREFERENCES);
    savePreferences(large);
    const saved = getPreferencesSnapshot();
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ cardLimit: 1, reduceMotion: true, textSize: "large" }));
    expect(getPreferencesSnapshot()).toBe(saved);
    expect(getServerPreferencesSnapshot()).toBe(DEFAULT_PREFERENCES);
  });

  it.each(["{", "null", "[]", '"large"', '{"textSize":"huge","reduceMotion":"true","cardLimit":4}'])("recovers safely from invalid stored data: %s", (raw) => {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, raw);
    expect(getPreferencesSnapshot()).toEqual(DEFAULT_PREFERENCES);
  });

  it("saves only known fields and synchronizes mounted readers in the same tab", async () => {
    root = createRoot(container);
    await act(async () => root!.render(createElement("div", null, createElement(Values), createElement(Values))));
    expect(container.textContent).toBe("normal/false/3normal/false/3");
    await act(async () => savePreferences(large));
    expect(container.textContent).toBe("large/true/1large/true/1");
    expect(document.documentElement.dataset.textSize).toBe("large");
    expect(document.documentElement.dataset.reducedMotion).toBe("true");
    expect(JSON.parse(window.localStorage.getItem(PREFERENCES_STORAGE_KEY)!)).toEqual(large);
  });

  it("hydrates default markup without a mismatch before applying a saved large view", async () => {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(large));
    initialize(JSON.stringify(large));
    container.innerHTML = renderToString(createElement(Values));
    expect(container.textContent).toBe("normal/false/3");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { root = hydrateRoot(container, createElement(Values)); });
    expect(container.textContent).toBe("large/true/1");
    expect(errors).not.toHaveBeenCalled();
  });

  it("throws on a rejected write and leaves saved values, view and subscribers untouched", () => {
    savePreferences(large);
    const before = getPreferencesSnapshot();
    const listener = vi.fn();
    unsubscribe = subscribePreferences(listener);
    const write = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    restoreWrite = () => write.mockRestore();
    expect(() => savePreferences(DEFAULT_PREFERENCES)).toThrow();
    expect(getPreferencesSnapshot()).toBe(before);
    expect(document.documentElement.dataset.textSize).toBe("large");
    expect(document.documentElement.dataset.reducedMotion).toBe("true");
    expect(listener).not.toHaveBeenCalled();
  });

  it("rejects invalid writes rather than persisting an out-of-range card limit", () => {
    const listener = vi.fn();
    unsubscribe = subscribePreferences(listener);
    expect(() => savePreferences({ ...large, cardLimit: 9 } as unknown as Preferences)).toThrow();
    expect(window.localStorage.getItem(PREFERENCES_STORAGE_KEY)).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });

  it("applies cross-tab changes/clearing and ignores unrelated storage, with complete cleanup", () => {
    const listener = vi.fn();
    unsubscribe = subscribePreferences(listener);
    storageChange("unrelated", "x");
    storageChange(PREFERENCES_STORAGE_KEY, JSON.stringify(large), window.sessionStorage);
    expect(listener).not.toHaveBeenCalled();
    storageChange(PREFERENCES_STORAGE_KEY, JSON.stringify(large));
    expect(getPreferencesSnapshot()).toEqual(large);
    expect(document.documentElement.dataset.reducedMotion).toBe("true");
    expect(listener).toHaveBeenCalledOnce();
    storageChange(null, null);
    expect(getPreferencesSnapshot()).toEqual(DEFAULT_PREFERENCES);
    expect(document.documentElement.dataset.textSize).toBe("normal");
    unsubscribe(); unsubscribe = undefined;
    listener.mockClear();
    storageChange(PREFERENCES_STORAGE_KEY, JSON.stringify(large));
    window.dispatchEvent(new Event(PREFERENCES_CHANGE_EVENT));
    expect(listener).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.textSize).toBe("normal");
  });

  it("resets only view attributes without deleting saved preferences or project data", () => {
    savePreferences(large);
    window.localStorage.setItem("untangle.workspace.v1", "project");
    resetPreferencesView();
    expect(document.documentElement.dataset.textSize).toBe("normal");
    expect(document.documentElement.dataset.reducedMotion).toBe("false");
    expect(JSON.parse(window.localStorage.getItem(PREFERENCES_STORAGE_KEY)!)).toEqual(large);
    expect(window.localStorage.getItem("untangle.workspace.v1")).toBe("project");
  });
});

describe("pre-paint preferences and reduced motion", () => {
  it("applies both saved attributes before hydration and safely defaults malformed/blocked storage", () => {
    initialize(JSON.stringify(large));
    expect(document.documentElement.dataset.textSize).toBe("large");
    expect(document.documentElement.dataset.reducedMotion).toBe("true");
    initialize("{");
    expect(document.documentElement.dataset.textSize).toBe("normal");
    expect(document.documentElement.dataset.reducedMotion).toBe("false");
    expect(() => new Function("localStorage", "document", PREFERENCES_INIT_SCRIPT)({ getItem: () => { throw new Error("Blocked"); } }, document)).not.toThrow();
    expect(document.documentElement.dataset.reducedMotion).toBe("false");
  });

  it("disables native snapshots for either a saved choice or an operating system preference", () => {
    const before = document.startViewTransition;
    const native = vi.fn();
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: native });
    try {
      expect(canAnimateNavigation()).toBe(true);
      savePreferences(large);
      const change = vi.fn();
      visualTransition(change);
      expect(change).toHaveBeenCalledOnce();
      expect(native).not.toHaveBeenCalled();
      expect(reducedMotion()).toBe(true);
      savePreferences(DEFAULT_PREFERENCES);
      expect(canAnimateNavigation()).toBe(true);
      Object.defineProperty(media, "matches", { configurable: true, value: true });
      expect(reducedMotion()).toBe(true);
      expect(canAnimateNavigation()).toBe(false);
    } finally { Object.defineProperty(document, "startViewTransition", { configurable: true, value: before }); }
  });

  it("notifies motion subscribers for app, device and cross-tab changes and unsubscribes all three", () => {
    const listener = vi.fn();
    unsubscribe = subscribeMotionPreference(listener);
    savePreferences(large);
    media.dispatchEvent(new Event("change"));
    storageChange(PREFERENCES_STORAGE_KEY, null);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(document.documentElement.dataset.reducedMotion).toBe("false");
    unsubscribe(); unsubscribe = undefined;
    listener.mockClear();
    savePreferences(large);
    media.dispatchEvent(new Event("change"));
    storageChange(PREFERENCES_STORAGE_KEY, null);
    expect(listener).not.toHaveBeenCalled();
  });
});
