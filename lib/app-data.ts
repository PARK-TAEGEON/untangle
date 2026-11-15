import { SAMPLE_WORKSPACE_STORAGE_KEY, WORKSPACE_MODE_STORAGE_KEY, WORKSPACE_STORAGE_KEY } from "./storage";

/** Explicit app ownership: never clear another app's storage, including unknown untangle.* keys. */
export const APP_DATA_KEYS = [
  WORKSPACE_STORAGE_KEY, SAMPLE_WORKSPACE_STORAGE_KEY, WORKSPACE_MODE_STORAGE_KEY,
  "untangle.theme.v1", "untangle.preferences.v1", "untangle.today-guide.v1",
  "untangle.today-roster.personal.v1", "untangle.today-roster.sample.v1",
] as const;
export const APP_DATA_RESET_KEY = "untangle.data-reset.v1";

type AppStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export interface AppDataEpoch { raw: string | null; ready: boolean }

export function readAppDataEpoch(storage: Pick<Storage, "getItem">): AppDataEpoch {
  const raw = storage.getItem(APP_DATA_RESET_KEY);
  if (raw === null) return { raw, ready: true };
  try {
    const value = JSON.parse(raw) as { id?: unknown; phase?: unknown };
    return { raw, ready: typeof value.id === "string" && value.id.length > 0 && value.phase === "ready" };
  } catch { return { raw, ready: false }; }
}

export class AppDataClearError extends Error {
  constructor(public readonly partial: boolean) {
    super(partial
      ? "모두 지우기를 완료하지 못했고 이전 상태로도 완전히 되돌리지 못했어요. 일부 자료가 남아 있을 수 있어요. 이전 요청의 저장은 막았어요. 브라우저 저장소 설정을 확인한 뒤 다시 모두 지워 주세요."
      : "자료를 모두 지우지 못했어요. 기존 자료는 그대로 보관했어요. 브라우저 저장소 설정을 확인해 주세요.");
    this.name = "AppDataClearError";
  }
}

/** localStorage has no multi-key transaction; snapshot first and report a failed rollback accurately. */
export function clearKnownAppData(storage: AppStorage, id = crypto.randomUUID()): string {
  let previousEpoch: string | null;
  let snapshots: Map<string, string | null>;
  try {
    previousEpoch = storage.getItem(APP_DATA_RESET_KEY);
    snapshots = new Map(APP_DATA_KEYS.map((key) => [key, storage.getItem(key)]));
  } catch { throw new AppDataClearError(false); }
  const pending = JSON.stringify({ id, phase: "clearing" });
  const ready = JSON.stringify({ id, phase: "ready" });
  try { storage.setItem(APP_DATA_RESET_KEY, pending); }
  catch { throw new AppDataClearError(false); }
  const attempted: string[] = [];
  try {
    for (const key of APP_DATA_KEYS) {
      attempted.push(key);
      storage.removeItem(key);
    }
    storage.setItem(APP_DATA_RESET_KEY, ready);
    return ready;
  } catch {
    let restored = true;
    for (const key of attempted) {
      try {
        const value = snapshots.get(key)!;
        if (storage.getItem(key) === value) continue;
        if (value === null) storage.removeItem(key); else storage.setItem(key, value);
      } catch { restored = false; }
    }
    if (restored) {
      try {
        if (previousEpoch === null) storage.removeItem(APP_DATA_RESET_KEY);
        else storage.setItem(APP_DATA_RESET_KEY, previousEpoch);
      } catch { restored = false; }
    }
    // A remaining "clearing" marker prevents stale tabs and API callbacks from saving old data.
    throw new AppDataClearError(!restored);
  }
}
