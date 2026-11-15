import { getPreferencesSnapshot, subscribePreferences } from "./preferences";

/** Browser-native snapshots keep page/theme changes short without duplicating live controls. */
export function reducedMotion(): boolean {
  return typeof window === "undefined" || document.documentElement.dataset.reducedMotion === "true"
    || getPreferencesSnapshot().reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function canAnimateNavigation(): boolean {
  return !reducedMotion() && typeof document.startViewTransition === "function";
}

export function subscribeMotionPreference(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onChange);
  const unsubscribe = subscribePreferences(onChange);
  return () => { media.removeEventListener("change", onChange); unsubscribe(); };
}

export function visualTransition(change: () => void | Promise<void>): void {
  if (!canAnimateNavigation()) { void change(); return; }
  let applied = false;
  let result: void | Promise<void>;
  const applyOnce = () => {
    if (!applied) { applied = true; result = change(); }
    return result;
  };
  try {
    const transition = document.startViewTransition(applyOnce);
    void transition.ready.catch(() => {});
    void transition.finished.catch(() => {});
    void transition.updateCallbackDone.catch(() => {
      // Capture failures must not drop the change or apply it a second time.
      if (!applied) return applyOnce();
    });
  } catch {
    if (!applied) void applyOnce();
  }
}
