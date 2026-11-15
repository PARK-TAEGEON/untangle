import { describe, expect, it, vi } from "vitest";
import { APP_DATA_KEYS, APP_DATA_RESET_KEY, AppDataClearError, clearKnownAppData, readAppDataEpoch } from "../lib/app-data";
import { SAMPLE_WORKSPACE_STORAGE_KEY, WORKSPACE_STORAGE_KEY } from "../lib/storage";

function storage() {
  const values = new Map<string, string>(APP_DATA_KEYS.map((key) => [key, `saved:${key}`]));
  values.set("other-app", "preserve"); values.set("untangle.unknown.v1", "preserve");
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
}

describe("app-owned data reset", () => {
  it("removes only the explicit app keys and retains a non-personal ready epoch", () => {
    const store = storage();
    const epoch = clearKnownAppData(store, "new-reset");
    for (const key of APP_DATA_KEYS) expect(store.getItem(key)).toBeNull();
    expect(store.getItem("other-app")).toBe("preserve");
    expect(store.getItem("untangle.unknown.v1")).toBe("preserve");
    expect(readAppDataEpoch(store)).toEqual({ raw: epoch, ready: true });
    expect(JSON.parse(epoch)).toEqual({ id: "new-reset", phase: "ready" });
  });

  it("does not start removing data if the initial snapshot cannot be read", () => {
    const store = storage(); const before = new Map(store.values);
    store.getItem.mockImplementation(() => { throw new Error("blocked"); });
    expect(() => clearKnownAppData(store, "reset")).toThrow(AppDataClearError);
    expect(store.values).toEqual(before);
    expect(store.removeItem).not.toHaveBeenCalled();
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it("aborts without deletion when the cross-tab guard cannot be saved", () => {
    const store = storage(); const before = new Map(store.values);
    store.setItem.mockImplementation(() => { throw new Error("blocked"); });
    expect(() => clearKnownAppData(store, "reset")).toThrow("기존 자료는 그대로");
    expect(store.values).toEqual(before);
    expect(store.removeItem).not.toHaveBeenCalled();
  });

  it("restores removed values and the previous epoch after a middle deletion fails", () => {
    const store = storage();
    store.values.set(APP_DATA_RESET_KEY, JSON.stringify({ id: "old", phase: "ready" }));
    const before = new Map(store.values);
    store.removeItem.mockImplementation((key) => { if (key === SAMPLE_WORKSPACE_STORAGE_KEY) throw new Error("blocked"); store.values.delete(key); });
    expect(() => clearKnownAppData(store, "reset")).toThrow("기존 자료는 그대로");
    expect(store.values).toEqual(before);
  });

  it("reports a failed rollback and keeps stale writers blocked instead of claiming success", () => {
    const store = storage();
    store.removeItem.mockImplementation((key) => { if (key === SAMPLE_WORKSPACE_STORAGE_KEY) throw new Error("blocked"); store.values.delete(key); });
    store.setItem.mockImplementation((key, value) => { if (key === WORKSPACE_STORAGE_KEY) throw new Error("blocked rollback"); store.values.set(key, value); });
    try { clearKnownAppData(store, "reset"); expect.fail("should fail"); }
    catch (cause) {
      expect(cause).toBeInstanceOf(AppDataClearError);
      expect((cause as AppDataClearError).partial).toBe(true);
      expect((cause as Error).message).toContain("일부 자료");
    }
    expect(readAppDataEpoch(store).ready).toBe(false);
    expect(store.getItem("other-app")).toBe("preserve");
  });
});
