import { getCardState, isAcceptedUnfinished, visibleCards } from "./card-state";
import type { SavedCard } from "./card-state";
import { completedDate } from "./history";
import type { WorkspaceData } from "./workspace";

export type TodayRosterMode = "personal" | "sample";
export const TODAY_ROSTER_STORAGE_KEYS = {
  personal: "untangle.today-roster.personal.v1",
  sample: "untangle.today-roster.sample.v1",
} as const;
export const TODAY_ROSTER_CHANGE_EVENT = "untangle:today-roster-change";

export interface TodayCardRef { key: string; created_at: string }
export interface TodayRoster { version: 1; day: string; refs: TodayCardRef[] }
interface CachedRoster { raw: string | null | undefined; roster: TodayRoster | null; memoryOnly: boolean }
const cache: Record<TodayRosterMode, CachedRoster> = {
  personal: { raw: undefined, roster: null, memoryOnly: false },
  sample: { raw: undefined, roster: null, memoryOnly: false },
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const validDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const identity = (card: TodayCardRef): string => JSON.stringify([card.key, card.created_at]);

function readRoster(raw: string | null): TodayRoster | null {
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1 || !validDay(value.day) || !Array.isArray(value.refs)) return null;
    const refs: TodayCardRef[] = [];
    for (const ref of value.refs) {
      if (!isRecord(ref) || typeof ref.key !== "string" || ref.key.length === 0 || typeof ref.created_at !== "string"
        || !/^\d{4}-\d{2}-\d{2}T/.test(ref.created_at) || !Number.isFinite(Date.parse(ref.created_at))) return null;
      refs.push({ key: ref.key, created_at: ref.created_at });
    }
    if (new Set(refs.map(identity)).size !== refs.length) return null;
    return { version: 1, day: value.day, refs };
  } catch { return null; }
}

export function getTodayRosterSnapshot(mode: TodayRosterMode): TodayRoster | null {
  const current = cache[mode];
  if (typeof window === "undefined" || current.memoryOnly) return current.roster;
  try {
    const raw = window.localStorage.getItem(TODAY_ROSTER_STORAGE_KEYS[mode]);
    if (raw !== current.raw) { current.raw = raw; current.roster = readRoster(raw); }
  } catch { /* The last coherent in-memory receipt is still usable. */ }
  return current.roster;
}

export function getServerTodayRosterSnapshot(): null { return null; }

function notify(mode: TodayRosterMode): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(TODAY_ROSTER_CHANGE_EVENT, { detail: mode }));
}

function writeRoster(mode: TodayRosterMode, roster: TodayRoster): void {
  const raw = JSON.stringify(roster);
  cache[mode] = { raw, roster, memoryOnly: true };
  try { window.localStorage.setItem(TODAY_ROSTER_STORAGE_KEYS[mode], raw); cache[mode].memoryOnly = false; }
  catch { /* This display-only receipt must not turn a successful card result into an API retry. */ }
  notify(mode);
}

function orderedCards(cards: SavedCard[]): SavedCard[] {
  const first = cards.find((card) => card.nudge.slot === "focus" && card.status !== "completed" && !isAcceptedUnfinished(card));
  return first ? [first, ...cards.filter((card) => card.key !== first.key)] : cards;
}

function createRoster(workspace: WorkspaceData, day: string, includeCompleted: boolean): TodayRoster {
  const effectiveDay = workspace.sample?.baseline_date ?? day;
  const visible = visibleCards(workspace, effectiveDay);
  const visibleKeys = new Set(visible.map((card) => card.key));
  const candidates = includeCompleted ? getCardState(workspace).items.filter((card) => visibleKeys.has(card.key)
    || (card.status === "completed" && card.resolved_at !== null && completedDate(card.resolved_at) === day)) : visible;
  return { version: 1, day, refs: orderedCards(candidates).map(({ key, created_at }) => ({ key, created_at })) };
}

/** Called only after a successful, committed global generation, including a valid empty response. */
export function saveTodayRoster(workspace: WorkspaceData, actualday: string): void {
  if (!validDay(actualday)) return;
  writeRoster(workspace.sample ? "sample" : "personal", createRoster(workspace, actualday, false));
}

/** A topic-board result may extend this cohort, while earlier completed/retired slots keep their places. */
export function appendTodayRoster(workspace: WorkspaceData, actualday: string): void {
  if (!validDay(actualday)) return;
  const mode = workspace.sample ? "sample" : "personal";
  const current = getTodayRosterSnapshot(mode);
  if (current?.day !== actualday) { writeRoster(mode, createRoster(workspace, actualday, true)); return; }
  const known = new Set(current.refs.map(identity));
  const additions = visibleCards(workspace, workspace.sample?.baseline_date ?? actualday)
    .filter((card) => !known.has(identity(card))).map(({ key, created_at }) => ({ key, created_at }));
  if (additions.length > 0) writeRoster(mode, { ...current, refs: [...current.refs, ...additions] });
}

/** Existing saves and the first sample visit have no receipt yet; infer once, then keep its slots. */
export function ensureTodayRoster(workspace: WorkspaceData, actualday: string): TodayRoster {
  const mode = workspace.sample ? "sample" : "personal";
  const current = getTodayRosterSnapshot(mode);
  if (current?.day === actualday) return current;
  const inferred = createRoster(workspace, actualday, true);
  writeRoster(mode, inferred);
  return inferred;
}

export function fallbackTodayRoster(workspace: WorkspaceData, actualday: string): TodayRoster {
  return createRoster(workspace, actualday, true);
}

/** Slice before filtering: finishing, snoozing or dismissing a slot never pulls in a hidden card. */
export function selectTodayRoster(workspace: WorkspaceData, roster: TodayRoster, cardLimit: 1 | 2 | 3, actualday: string): { cards: SavedCard[]; threads: SavedCard[] } {
  const effectiveDay = workspace.sample?.baseline_date ?? actualday;
  const items = new Map(getCardState(workspace).items.map((card) => [identity(card), card]));
  const visible = new Set(visibleCards(workspace, effectiveDay).map(identity));
  const threads = roster.refs.slice(0, cardLimit).flatMap((ref) => {
    const card = items.get(identity(ref));
    return card && (card.status === "completed" || visible.has(identity(card))) ? [card] : [];
  });
  return { threads, cards: threads.filter((card) => card.status !== "completed") };
}

/** Import/restore can reuse card-1; the provider resets only after its new workspace is saved. */
export function resetTodayRoster(mode: TodayRosterMode): void {
  cache[mode] = { raw: null, roster: null, memoryOnly: true };
  try { window.localStorage.removeItem(TODAY_ROSTER_STORAGE_KEYS[mode]); cache[mode].memoryOnly = false; }
  catch { /* An old receipt must not reappear in the current tab after a blocked removal. */ }
  notify(mode);
}

export function subscribeTodayRoster(mode: TodayRosterMode, onChange: () => void): () => void {
  function changed(event: Event) { if ((event as CustomEvent<TodayRosterMode>).detail === mode) onChange(); }
  function storage(event: StorageEvent) {
    if (event.key !== TODAY_ROSTER_STORAGE_KEYS[mode] && event.key !== null) return;
    if (event.storageArea && event.storageArea !== window.localStorage) return;
    const raw = event.key === null ? null : event.newValue;
    cache[mode] = { raw, roster: readRoster(raw), memoryOnly: false };
    onChange();
  }
  window.addEventListener(TODAY_ROSTER_CHANGE_EVENT, changed);
  window.addEventListener("storage", storage);
  return () => { window.removeEventListener(TODAY_ROSTER_CHANGE_EVENT, changed); window.removeEventListener("storage", storage); };
}
