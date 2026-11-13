// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { visualTransition } from "../lib/motion";

afterEach(() => { vi.restoreAllMocks(); });

describe("visual change fallback", () => {
  it("applies a theme or navigation change once without the native API", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
    const before = document.startViewTransition;
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: undefined });
    const change = vi.fn();
    try { visualTransition(change); expect(change).toHaveBeenCalledTimes(1); }
    finally { Object.defineProperty(document, "startViewTransition", { configurable: true, value: before }); }
  });

  it("changes immediately and never starts a snapshot when reduced motion is enabled", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    const before = document.startViewTransition;
    const native = vi.fn();
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: native });
    const change = vi.fn();
    try { visualTransition(change); expect(change).toHaveBeenCalledTimes(1); expect(native).not.toHaveBeenCalled(); }
    finally { Object.defineProperty(document, "startViewTransition", { configurable: true, value: before }); }
  });

  it("still applies the change if native capture cannot start", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
    const before = document.startViewTransition;
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: () => { throw new Error("capture unavailable"); } });
    const change = vi.fn();
    try { visualTransition(change); expect(change).toHaveBeenCalledTimes(1); }
    finally { Object.defineProperty(document, "startViewTransition", { configurable: true, value: before }); }
  });

  it("does not repeat an already applied change if the native API subsequently throws", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
    const before = document.startViewTransition;
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: (apply: () => void) => { apply(); throw new Error("capture interrupted"); } });
    const change = vi.fn();
    try { visualTransition(change); expect(change).toHaveBeenCalledTimes(1); }
    finally { Object.defineProperty(document, "startViewTransition", { configurable: true, value: before }); }
  });

  it("recovers a change once if native capture rejects before invoking its callback", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
    const before = document.startViewTransition;
    let callback: (() => void) | undefined;
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: (apply: () => void) => {
      callback = apply;
      return { ready: Promise.resolve(), finished: Promise.resolve(), updateCallbackDone: Promise.reject(new Error("capture failed")) };
    } });
    const change = vi.fn();
    try {
      visualTransition(change);
      await Promise.resolve();
      expect(change).toHaveBeenCalledTimes(1);
      callback!();
      expect(change).toHaveBeenCalledTimes(1);
    } finally { Object.defineProperty(document, "startViewTransition", { configurable: true, value: before }); }
  });
});
