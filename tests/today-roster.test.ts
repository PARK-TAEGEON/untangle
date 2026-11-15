// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyGeneratedCards, applyTopicGeneratedCards, completeCard, dismissCard, getCardState, markTopicCardGeneration, snoozeCard, visibleCards } from "../lib/card-state";
import { createSampleWorkspace } from "../lib/sample-mode";
import { appendTodayRoster, ensureTodayRoster, fallbackTodayRoster, getServerTodayRosterSnapshot, getTodayRosterSnapshot, resetTodayRoster, saveTodayRoster, selectTodayRoster, subscribeTodayRoster, TODAY_ROSTER_CHANGE_EVENT, TODAY_ROSTER_STORAGE_KEYS } from "../lib/today-roster";
import type { TodayRoster } from "../lib/today-roster";
import type { WorkspaceData } from "../lib/workspace";

const DAY = "2026-11-15";
const NOW = "2026-11-15T04:00:00.000Z";
const NEXT = "2026-11-15T05:00:00.000Z";
let restoreStorage: (() => void) | undefined;
let unsubscribe: (() => void) | undefined;

function workspace(): WorkspaceData {
  const data = createSampleWorkspace("game-developer", NOW, DAY);
  delete data.sample;
  return data;
}
function saved(): TodayRoster { return getTodayRosterSnapshot("personal")!; }
function nextRound(data: WorkspaceData): WorkspaceData {
  return applyGeneratedCards(data, getCardState(data).items.slice(0, 3).map((card) => card.nudge), NEXT, DAY);
}
function topicRound(data: WorkspaceData): WorkspaceData {
  const topic = data.topics.find((item) => !data.cards!.items.some((card) => card.nudge.topic_id === item.id))!;
  const marked = markTopicCardGeneration(data, topic.id, "topic-receipt-test");
  return applyTopicGeneratedCards(marked, topic.id, [{ ...data.cards!.items[0].nudge, topic_id: topic.id }], NEXT, "topic-receipt-test");
}
function storageChange(key: string | null, newValue: string | null, storageArea: Storage = window.localStorage) {
  if (storageArea === window.localStorage) {
    if (key === null) window.localStorage.clear();
    else if (newValue === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, newValue);
  }
  window.dispatchEvent(new StorageEvent("storage", { key, newValue, storageArea }));
}

beforeEach(() => {
  window.localStorage.clear();
  resetTodayRoster("personal"); resetTodayRoster("sample");
});
afterEach(() => {
  unsubscribe?.(); unsubscribe = undefined;
  restoreStorage?.(); restoreStorage = undefined;
  vi.restoreAllMocks();
  window.localStorage.clear();
  resetTodayRoster("personal"); resetTodayRoster("sample");
});

describe("daily display receipt", () => {
  it("records the home focus first and retains every received candidate before applying the display limit", () => {
    const data = workspace();
    const before = structuredClone(data);
    saveTodayRoster(data, DAY);
    const roster = saved();
    expect(roster.day).toBe(DAY);
    expect(roster.refs).toHaveLength(3);
    expect(getCardState(data).items.find((card) => card.key === roster.refs[0].key)?.nudge.slot).toBe("focus");
    expect(selectTodayRoster(data, roster, 1, DAY).cards).toHaveLength(1);
    expect(selectTodayRoster(data, roster, 3, DAY).cards).toHaveLength(3);
    expect(data).toEqual(before);
    expect(getTodayRosterSnapshot("personal")).toBe(roster);
    expect(getServerTodayRosterSnapshot()).toBeNull();
  });

  it("keeps a completed first slot as a straight thread without automatically exposing the other two cards", () => {
    const data = workspace();
    saveTodayRoster(data, DAY);
    const roster = saved();
    const completed = completeCard(data, roster.refs[0].key, null, NEXT);
    expect(visibleCards(completed, DAY)).toHaveLength(2);
    const result = selectTodayRoster(completed, roster, 1, DAY);
    expect(result.cards).toEqual([]);
    expect(result.threads.map((card) => [card.key, card.status])).toEqual([[roster.refs[0].key, "completed"]]);
    expect(ensureTodayRoster(completed, DAY)).toBe(roster);
    expect(JSON.parse(window.localStorage.getItem(TODAY_ROSTER_STORAGE_KEYS.personal)!).refs).toEqual(roster.refs);
    expect(selectTodayRoster(completed, roster, 2, DAY).cards).toHaveLength(1);
  });

  it.each(["dismissed", "snoozed"] as const)("drops a %s slot without filling it from hidden cards", (status) => {
    const data = workspace();
    saveTodayRoster(data, DAY);
    const roster = saved();
    const next = status === "dismissed" ? dismissCard(data, roster.refs[0].key, NEXT) : snoozeCard(data, roster.refs[0].key, DAY);
    expect(selectTodayRoster(next, roster, 1, DAY)).toEqual({ cards: [], threads: [] });
    expect(selectTodayRoster(next, roster, 3, DAY).cards).toHaveLength(2);
    expect(saved()).toBe(roster);
  });

  it("returns a due snoozed card on the next day with the canonical visibility rule", () => {
    const data = workspace();
    saveTodayRoster(data, DAY);
    const first = saved().refs[0].key;
    const next = snoozeCard(data, first, DAY);
    expect(selectTodayRoster(next, saved(), 3, DAY).cards.map((card) => card.key)).not.toContain(first);
    const tomorrow = ensureTodayRoster(next, "2026-11-16");
    expect(tomorrow.day).toBe("2026-11-16");
    expect(selectTodayRoster(next, tomorrow, 3, "2026-11-16").cards.map((card) => card.key)).toContain(first);
  });

  it("replaces the receipt for a successful new round and respects a valid empty result", () => {
    let data = workspace();
    saveTodayRoster(data, DAY);
    const first = saved().refs[0].key;
    data = completeCard(data, first, null, NEXT);
    const next = nextRound(data);
    saveTodayRoster(next, DAY);
    expect(saved().refs.map((ref) => ref.key)).not.toContain(first);
    expect(saved().refs.every((ref) => ref.created_at === NEXT)).toBe(true);
    const empty = applyGeneratedCards(next, [], "2026-11-15T06:00:00.000Z", DAY);
    saveTodayRoster(empty, DAY);
    expect(saved().refs).toEqual([]);
    expect(ensureTodayRoster(empty, DAY).refs).toEqual([]);
    expect(selectTodayRoster(empty, saved(), 3, DAY)).toEqual({ cards: [], threads: [] });
  });

  it("infers existing saves once and includes today's completions but not older ones", () => {
    const data = workspace();
    const first = getCardState(data).items[0].key, second = getCardState(data).items[1].key;
    const older = completeCard(data, first, null, "2026-11-14T04:00:00.000Z");
    const completed = completeCard(older, second, null, NEXT);
    const fallback = fallbackTodayRoster(completed, DAY);
    expect(fallback.refs.map((ref) => ref.key)).not.toContain(first);
    expect(fallback.refs.map((ref) => ref.key)).toContain(second);
    expect(getTodayRosterSnapshot("personal")).toBeNull();
    const persisted = ensureTodayRoster(completed, DAY);
    expect(persisted).toEqual(fallback);
    expect(ensureTodayRoster(completed, DAY)).toBe(persisted);
  });

  it("does not attach an old slot to a reused card key with a different creation timestamp", () => {
    const data = workspace();
    saveTodayRoster(data, DAY);
    const imported = structuredClone(data);
    for (const card of imported.cards!.items) card.created_at = NEXT;
    expect(selectTodayRoster(imported, saved(), 3, DAY)).toEqual({ cards: [], threads: [] });
    resetTodayRoster("personal");
    const fresh = ensureTodayRoster(imported, DAY);
    expect(selectTodayRoster(imported, fresh, 3, DAY).cards).toHaveLength(3);
  });

  it("keeps personal/sample receipts separate and uses the actual day instead of the sample baseline", () => {
    const personal = workspace();
    saveTodayRoster(personal, DAY);
    const personalRaw = window.localStorage.getItem(TODAY_ROSTER_STORAGE_KEYS.personal);
    const sample = createSampleWorkspace("student", NEXT, DAY);
    expect(sample.sample!.baseline_date).not.toBe(DAY);
    saveTodayRoster(sample, DAY);
    const sampleRoster = getTodayRosterSnapshot("sample")!;
    expect(sampleRoster.day).toBe(DAY);
    expect(sampleRoster.refs).toHaveLength(visibleCards(sample, sample.sample!.baseline_date).length);
    resetTodayRoster("sample");
    expect(window.localStorage.getItem(TODAY_ROSTER_STORAGE_KEYS.personal)).toBe(personalRaw);
    expect(getTodayRosterSnapshot("sample")).toBeNull();
  });
});

describe("topic-only cohort extension", () => {
  it("appends new card identities after existing slots without disturbing completion, order or the display cap", () => {
    const data = workspace();
    saveTodayRoster(data, DAY);
    const original = saved();
    const completed = completeCard(data, original.refs[0].key, null, NEXT);
    const next = topicRound(completed);
    appendTodayRoster(next, DAY);
    const extended = saved();
    expect(extended.refs.slice(0, original.refs.length)).toEqual(original.refs);
    expect(extended.refs).toHaveLength(original.refs.length + 1);
    expect(extended.refs.at(-1)!.created_at).toBe(NEXT);
    const selected = selectTodayRoster(next, extended, 3, DAY);
    expect(selected.threads[0].status).toBe("completed");
    expect(selected.threads.map((card) => card.key)).not.toContain(extended.refs.at(-1)!.key);
    appendTodayRoster(next, DAY);
    expect(saved()).toBe(extended);
  });

  it("retains an empty global receipt and exposes a later topic result without resurrecting old completions", () => {
    let data = workspace();
    data = completeCard(data, data.cards!.items[0].key, null, NEXT);
    data = applyGeneratedCards(data, [], NEXT, DAY);
    saveTodayRoster(data, DAY);
    expect(saved().refs).toEqual([]);
    appendTodayRoster(data, DAY);
    expect(saved().refs).toEqual([]);
    const next = topicRound(data);
    appendTodayRoster(next, DAY);
    expect(saved().refs).toHaveLength(1);
    expect(selectTodayRoster(next, saved(), 3, DAY).threads.every((card) => card.status === "pending")).toBe(true);
  });

  it("falls back once when there is no current-day receipt and keeps topic extension usable after a rejected write", () => {
    const data = workspace();
    appendTodayRoster(data, DAY);
    expect(saved().refs).toHaveLength(3);
    const oldRaw = window.localStorage.getItem(TODAY_ROSTER_STORAGE_KEYS.personal);
    const write = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    restoreStorage = () => write.mockRestore();
    expect(() => appendTodayRoster(topicRound(data), DAY)).not.toThrow();
    expect(saved().refs).toHaveLength(4);
    expect(window.localStorage.getItem(TODAY_ROSTER_STORAGE_KEYS.personal)).toBe(oldRaw);
    appendTodayRoster(data, "2026-11-16");
    expect(saved().day).toBe("2026-11-16");
  });
});

describe("display receipt persistence resilience", () => {
  it("keeps a successful new receipt in memory when its write fails instead of restoring the previous disk receipt", () => {
    const data = workspace();
    saveTodayRoster(data, DAY);
    const oldRaw = window.localStorage.getItem(TODAY_ROSTER_STORAGE_KEYS.personal);
    const write = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    restoreStorage = () => write.mockRestore();
    expect(() => saveTodayRoster(nextRound(data), DAY)).not.toThrow();
    const memory = saved();
    expect(memory.refs.every((ref) => ref.created_at === NEXT)).toBe(true);
    expect(getTodayRosterSnapshot("personal")).toBe(memory);
    expect(window.localStorage.getItem(TODAY_ROSTER_STORAGE_KEYS.personal)).toBe(oldRaw);
  });

  it("resets the current view even when a stored old receipt cannot be removed", () => {
    saveTodayRoster(workspace(), DAY);
    const remove = vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    restoreStorage = () => remove.mockRestore();
    expect(() => resetTodayRoster("personal")).not.toThrow();
    expect(getTodayRosterSnapshot("personal")).toBeNull();
    expect(window.localStorage.getItem(TODAY_ROSTER_STORAGE_KEYS.personal)).not.toBeNull();
  });

  it.each(["{", "null", '{"version":1,"day":"2026-02-30","refs":[]}', '{"version":1,"day":"2026-11-15","refs":[{"key":"card-1","created_at":"bad"}]}'])("ignores a malformed receipt before inferring a valid one: %s", (raw) => {
    window.localStorage.setItem(TODAY_ROSTER_STORAGE_KEYS.personal, raw);
    expect(getTodayRosterSnapshot("personal")).toBeNull();
    expect(ensureTodayRoster(workspace(), DAY).refs).toHaveLength(3);
  });

  it("synchronizes only its own mode and key across tabs and cleans up every listener", () => {
    const listener = vi.fn();
    unsubscribe = subscribeTodayRoster("personal", listener);
    saveTodayRoster(workspace(), DAY);
    expect(listener).toHaveBeenCalledOnce();
    const raw = window.localStorage.getItem(TODAY_ROSTER_STORAGE_KEYS.personal);
    storageChange("unrelated", null);
    storageChange(TODAY_ROSTER_STORAGE_KEYS.personal, null, window.sessionStorage);
    saveTodayRoster(createSampleWorkspace("student", NOW, DAY), DAY);
    expect(listener).toHaveBeenCalledOnce();
    storageChange(TODAY_ROSTER_STORAGE_KEYS.personal, null);
    expect(getTodayRosterSnapshot("personal")).toBeNull();
    storageChange(TODAY_ROSTER_STORAGE_KEYS.personal, raw);
    expect(saved().refs).toHaveLength(3);
    storageChange(null, null);
    expect(getTodayRosterSnapshot("personal")).toBeNull();
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe(); unsubscribe = undefined;
    listener.mockClear();
    window.dispatchEvent(new CustomEvent(TODAY_ROSTER_CHANGE_EVENT, { detail: "personal" }));
    storageChange(TODAY_ROSTER_STORAGE_KEYS.personal, raw);
    expect(listener).not.toHaveBeenCalled();
  });
});
