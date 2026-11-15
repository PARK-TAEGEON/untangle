export interface Preferences {
  textSize: "normal" | "large";
  reduceMotion: boolean;
  cardLimit: 1 | 2 | 3;
}

export const PREFERENCES_STORAGE_KEY = "untangle.preferences.v1";
export const PREFERENCES_CHANGE_EVENT = "untangle:preferences-change";
export const DEFAULT_PREFERENCES: Preferences = Object.freeze({ textSize: "normal", reduceMotion: false, cardLimit: 3 });

// This module is also imported by the server layout; browser APIs run only on demand.
export const PREFERENCES_INIT_SCRIPT = `(()=>{let t="normal",r=false;try{const p=JSON.parse(localStorage.getItem("${PREFERENCES_STORAGE_KEY}")||"null");if(p&&typeof p==="object"&&!Array.isArray(p)){if(p.textSize==="large")t="large";r=p.reduceMotion===true;}}catch{}const d=document.documentElement;d.dataset.textSize=t;d.dataset.reducedMotion=String(r);})();`;

let cachedRaw: string | null | undefined;
let cachedSnapshot = DEFAULT_PREFERENCES;

function parsePreferences(raw: string | null): Preferences {
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_PREFERENCES;
    const data = value as Partial<Preferences>;
    return {
      textSize: data.textSize === "large" ? "large" : "normal",
      reduceMotion: data.reduceMotion === true,
      cardLimit: data.cardLimit === 1 || data.cardLimit === 2 ? data.cardLimit : 3,
    };
  } catch { return DEFAULT_PREFERENCES; }
}

function remember(raw: string | null): Preferences {
  if (raw === cachedRaw) return cachedSnapshot;
  const next = parsePreferences(raw);
  cachedRaw = raw;
  if (next.textSize !== cachedSnapshot.textSize || next.reduceMotion !== cachedSnapshot.reduceMotion || next.cardLimit !== cachedSnapshot.cardLimit) {
    cachedSnapshot = Object.freeze(next);
  }
  return cachedSnapshot;
}

function applyPreferences(preferences: Preferences): void {
  document.documentElement.dataset.textSize = preferences.textSize;
  document.documentElement.dataset.reducedMotion = String(preferences.reduceMotion);
}

export function getPreferencesSnapshot(): Preferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try { return remember(window.localStorage.getItem(PREFERENCES_STORAGE_KEY)); }
  catch { return cachedSnapshot; }
}

export function getServerPreferencesSnapshot(): Preferences { return DEFAULT_PREFERENCES; }

export function savePreferences(next: Preferences): void {
  if (!next || (next.textSize !== "normal" && next.textSize !== "large") || typeof next.reduceMotion !== "boolean"
    || (next.cardLimit !== 1 && next.cardLimit !== 2 && next.cardLimit !== 3)) throw new Error("설정 값을 확인해 주세요.");
  const raw = JSON.stringify({ textSize: next.textSize, reduceMotion: next.reduceMotion, cardLimit: next.cardLimit });
  // A failed write leaves the last saved choice and the current view intact.
  window.localStorage.setItem(PREFERENCES_STORAGE_KEY, raw);
  applyPreferences(remember(raw));
  window.dispatchEvent(new Event(PREFERENCES_CHANGE_EVENT));
}

/** Clearing saved data is the caller's responsibility; this only resets the current view. */
export function resetPreferencesView(): void {
  if (typeof document === "undefined") return;
  applyPreferences(DEFAULT_PREFERENCES);
  window.dispatchEvent(new Event(PREFERENCES_CHANGE_EVENT));
}

export function subscribePreferences(onChange: () => void): () => void {
  function onStorage(event: StorageEvent) {
    if (event.key !== PREFERENCES_STORAGE_KEY && event.key !== null) return;
    if (event.storageArea && event.storageArea !== window.localStorage) return;
    applyPreferences(remember(event.key === null ? null : event.newValue));
    onChange();
  }
  // The head script already covers the first paint, including before hydration.
  applyPreferences(getPreferencesSnapshot());
  window.addEventListener(PREFERENCES_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(PREFERENCES_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
