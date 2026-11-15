import { visualTransition } from "./motion";
import { readAppDataEpoch } from "./app-data";

export type Theme = "light" | "dark";
export type ThemePreference = "system" | Theme;

export const THEME_STORAGE_KEY = "untangle.theme.v1";
export const THEME_CHANGE_EVENT = "untangle:theme-change";

// Runs in <head> before the page can paint, independently of React hydration.
export const THEME_INIT_SCRIPT = `(()=>{try{const t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;else delete document.documentElement.dataset.theme;}catch{}})();`;

export function getThemeSnapshot(): Theme {
  const preference = document.documentElement.dataset.theme;
  if (preference === "light" || preference === "dark") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getServerThemeSnapshot(): Theme { return "light"; }

export function getThemePreferenceSnapshot(): ThemePreference {
  const preference = document.documentElement.dataset.theme;
  return preference === "light" || preference === "dark" ? preference : "system";
}

export function getServerThemePreferenceSnapshot(): ThemePreference { return "system"; }

function applyThemePreference(preference: ThemePreference): void {
  if (preference === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = preference;
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

let themeRequest = 0;
function storedThemeContext(): { epoch: string | null; preference: string | null } | null {
  try { return { epoch: readAppDataEpoch(window.localStorage).raw, preference: window.localStorage.getItem(THEME_STORAGE_KEY) }; }
  catch { return null; }
}

function transitionTheme(preference: ThemePreference): void {
  const request = ++themeRequest;
  const expected = storedThemeContext();
  visualTransition(() => {
    const actual = storedThemeContext();
    // An erase or a newer choice takes precedence over a queued native snapshot.
    if (request !== themeRequest || expected?.epoch !== actual?.epoch || expected?.preference !== actual?.preference) return;
    applyThemePreference(preference);
  });
}

/** Settings must report a rejected write instead of claiming an unsaved preference. */
export function setThemePreference(preference: ThemePreference): void {
  if (preference !== "system" && preference !== "light" && preference !== "dark") throw new Error("테마 설정을 확인해 주세요.");
  window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  transitionTheme(preference);
}

export function setTheme(theme: Theme) {
  try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* The choice still applies in this tab. */ }
  transitionTheme(theme);
}

export function subscribeTheme(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  function onStorage(event: StorageEvent) {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    if (event.storageArea && event.storageArea !== window.localStorage) return;
    const preference = event.key === null ? null : event.newValue;
    if (preference === "light" || preference === "dark") document.documentElement.dataset.theme = preference;
    else delete document.documentElement.dataset.theme;
    onChange();
  }
  media.addEventListener("change", onChange);
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
