export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "untangle.theme.v1";
export const THEME_CHANGE_EVENT = "untangle:theme-change";

// Runs in <head> before the page can paint, independently of React hydration.
export const THEME_INIT_SCRIPT = `(()=>{try{const t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch{}})();`;

export function getThemeSnapshot(): Theme {
  const preference = document.documentElement.dataset.theme;
  if (preference === "light" || preference === "dark") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getServerThemeSnapshot(): Theme { return "light"; }

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* The choice still applies in this tab. */ }
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
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
