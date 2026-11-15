// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspace, WorkspaceProvider } from "../components/workspace-provider";
import { applyGeneratedCards, completeCard, markCardGeneration } from "../lib/card-state";
import type { Nudge } from "../lib/card-types";
import { parseExport } from "../lib/parse";
import { createSampleWorkspace } from "../lib/sample-mode";
import { saveWorkspace, SAMPLE_WORKSPACE_STORAGE_KEY, WORKSPACE_MODE_STORAGE_KEY, WORKSPACE_STORAGE_KEY } from "../lib/storage";
import * as roster from "../lib/today-roster";
import { confirmOnboarding, toggleStar } from "../lib/workspace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const NOW = "2026-11-15T03:00:00.000Z";
const TODAY = "2026-11-15";
const PERSONAL_ROSTER = "untangle.today-roster.personal.v1";
const SAMPLE_ROSTER = "untangle.today-roster.sample.v1";
const PERSONAL_RECEIPT = JSON.stringify({ note: "saved personal cohort" });
const SAMPLE_RECEIPT = JSON.stringify({ note: "saved sample cohort" });
const card: Nudge = { id: "n1", slot: "focus", topic_id: "t1", new_topic_name: null, type: "continue", title: "가상 초안 확인하기", action: "첫 줄 확인", est_minutes: 5, why_now: "다음 할 일", evidence: [{ source: "topic", fact: "초안 확인" }], head_start: { kind: "draft", content: "가상 초안", options: [] }, first_step: "첫 줄 확인" };
function workspace() {
  return applyGeneratedCards(confirmOnboarding(parseExport(`## 나
- 하는 일/역할: 가상 개발자
## 테마: 개발
### 가상 작업
- 한 줄 설명: 가상 초안 확인
- 진행 여부: 진행 중
- 내가 말했던 다음 할 일: 초안 확인`, { today: TODAY }), {}, null, NOW), [card], NOW, TODAY);
}
let root: Root;
let container: HTMLDivElement;
let store: ReturnType<typeof useWorkspace>;
let reset: ReturnType<typeof vi.spyOn>;
let restoreWrite: (() => void) | undefined;
function Probe() { store = useWorkspace(); return null; }
async function render() { await act(async () => { root.render(createElement(WorkspaceProvider, null, createElement(Probe))); }); }
function receipts() { return [window.localStorage.getItem(PERSONAL_ROSTER), window.localStorage.getItem(SAMPLE_ROSTER)]; }
function failWrite(key: string) {
  const original = window.localStorage.setItem.bind(window.localStorage);
  const write = vi.spyOn(window.localStorage, "setItem").mockImplementation((name, value) => { if (name === key) throw new DOMException("Full", "QuotaExceededError"); original(name, value); });
  restoreWrite = () => write.mockRestore();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  window.localStorage.clear(); roster.resetTodayRoster("personal"); roster.resetTodayRoster("sample");
  saveWorkspace(window.localStorage, workspace());
  window.localStorage.setItem(PERSONAL_ROSTER, PERSONAL_RECEIPT); window.localStorage.setItem(SAMPLE_ROSTER, SAMPLE_RECEIPT);
  reset = vi.spyOn(roster, "resetTodayRoster"); restoreWrite = undefined;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); restoreWrite?.(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("provider resets only the successfully replaced mode's daily cohort", () => {
  it("clears memory-only receipts for both modes after a successful full data reset", async () => {
    await render();
    const original = window.localStorage.setItem.bind(window.localStorage);
    const write = vi.spyOn(window.localStorage, "setItem").mockImplementation((name, value) => {
      if (name === PERSONAL_ROSTER || name === SAMPLE_ROSTER) throw new DOMException("Full", "QuotaExceededError");
      original(name, value);
    });
    restoreWrite = () => write.mockRestore();
    roster.saveTodayRoster(workspace(), TODAY);
    roster.saveTodayRoster(createSampleWorkspace("student", NOW, TODAY), TODAY);
    expect(roster.getTodayRosterSnapshot("personal")?.refs.length).toBeGreaterThan(0);
    expect(roster.getTodayRosterSnapshot("sample")?.refs.length).toBeGreaterThan(0);
    write.mockRestore();
    await act(async () => { expect(store.clearAppData()).toBe(true); });
    expect(reset).toHaveBeenCalledWith("personal"); expect(reset).toHaveBeenCalledWith("sample");
    expect(roster.getTodayRosterSnapshot("personal")).toBeNull();
    expect(roster.getTodayRosterSnapshot("sample")).toBeNull();
    expect(receipts()).toEqual([null, null]);
  });

  it("retains memory-only receipts when full reset fails and rolls stored data back", async () => {
    await render();
    const originalSet = window.localStorage.setItem.bind(window.localStorage);
    const write = vi.spyOn(window.localStorage, "setItem").mockImplementation((name, value) => {
      if (name === PERSONAL_ROSTER || name === SAMPLE_ROSTER) throw new DOMException("Full", "QuotaExceededError");
      originalSet(name, value);
    });
    roster.saveTodayRoster(workspace(), TODAY);
    roster.saveTodayRoster(createSampleWorkspace("student", NOW, TODAY), TODAY);
    write.mockRestore();
    const personal = roster.getTodayRosterSnapshot("personal");
    const sample = roster.getTodayRosterSnapshot("sample");
    const originalRemove = window.localStorage.removeItem.bind(window.localStorage);
    const remove = vi.spyOn(window.localStorage, "removeItem").mockImplementation((name) => {
      if (name === WORKSPACE_STORAGE_KEY) throw new Error("blocked");
      originalRemove(name);
    });
    try {
      await act(async () => { expect(store.clearAppData()).toBe(false); });
      expect(reset).not.toHaveBeenCalled();
      expect(roster.getTodayRosterSnapshot("personal")).toBe(personal);
      expect(roster.getTodayRosterSnapshot("sample")).toBe(sample);
      expect(receipts()).toEqual([PERSONAL_RECEIPT, SAMPLE_RECEIPT]);
    } finally { remove.mockRestore(); }
  });
  it("preserves both receipts through hydration and normal edits, completion and generation marking", async () => {
    await render();
    await act(async () => { store.update((previous) => toggleStar(previous, "t1")); });
    await act(async () => { store.update((previous) => completeCard(previous, "card-1", "가상 완료 메모", NOW)); });
    await act(async () => { store.update((previous) => markCardGeneration(previous, TODAY, "request")); });
    expect(receipts()).toEqual([PERSONAL_RECEIPT, SAMPLE_RECEIPT]); expect(reset).not.toHaveBeenCalled();
  });

  it("resets only personal receipt after successful explicit replacement", async () => {
    await render();
    await act(async () => { expect(store.replace(workspace())).toBe(true); });
    expect(reset).toHaveBeenCalledExactlyOnceWith("personal");
    expect(receipts()).toEqual([null, SAMPLE_RECEIPT]);
  });

  it("preserves both receipts if explicit replacement fails before the workspace or mode is saved", async () => {
    await render(); failWrite(WORKSPACE_STORAGE_KEY);
    await act(async () => { expect(store.replace(workspace())).toBe(false); });
    expect(receipts()).toEqual([PERSONAL_RECEIPT, SAMPLE_RECEIPT]); expect(reset).not.toHaveBeenCalled();
    restoreWrite?.(); failWrite(WORKSPACE_MODE_STORAGE_KEY);
    await act(async () => { expect(store.replace(workspace())).toBe(false); });
    expect(receipts()).toEqual([PERSONAL_RECEIPT, SAMPLE_RECEIPT]); expect(reset).not.toHaveBeenCalled();
  });

  it("resets only sample receipt on sample start and retains personal receipt when exiting", async () => {
    await render();
    await act(async () => { expect(store.startSample("student")).toBe(true); });
    expect(reset).toHaveBeenCalledExactlyOnceWith("sample"); expect(receipts()).toEqual([PERSONAL_RECEIPT, null]);
    window.localStorage.setItem(SAMPLE_ROSTER, SAMPLE_RECEIPT);
    await act(async () => { expect(store.exitSample()).toBe(true); });
    expect(receipts()).toEqual([PERSONAL_RECEIPT, SAMPLE_RECEIPT]); expect(reset).toHaveBeenCalledTimes(1);
  });

  it("preserves both receipts if a sample cannot be saved", async () => {
    await render(); failWrite(SAMPLE_WORKSPACE_STORAGE_KEY);
    await act(async () => { expect(store.startSample("student")).toBe(false); });
    expect(reset).not.toHaveBeenCalled(); expect(receipts()).toEqual([PERSONAL_RECEIPT, SAMPLE_RECEIPT]);
  });

  it.each(["personal", "sample"] as const)("resets only the %s receipt after successful backup restore", async (mode) => {
    if (mode === "sample") {
      saveWorkspace(window.localStorage, createSampleWorkspace("student", NOW, TODAY), SAMPLE_WORKSPACE_STORAGE_KEY);
      window.localStorage.setItem(WORKSPACE_MODE_STORAGE_KEY, "sample");
    }
    await render();
    await act(async () => { expect(store.restore(mode === "sample" ? createSampleWorkspace("student", NOW, TODAY) : workspace())).toBe(true); });
    expect(reset).toHaveBeenCalledExactlyOnceWith(mode);
    expect(receipts()).toEqual(mode === "sample" ? [PERSONAL_RECEIPT, null] : [null, SAMPLE_RECEIPT]);
  });

  it("keeps both receipts when backup validation or persistence fails", async () => {
    await render();
    await act(async () => { expect(store.restore(createSampleWorkspace("student", NOW, TODAY))).toBe(false); });
    expect(reset).not.toHaveBeenCalled(); expect(receipts()).toEqual([PERSONAL_RECEIPT, SAMPLE_RECEIPT]);
    failWrite(WORKSPACE_STORAGE_KEY);
    await act(async () => { expect(store.restore(workspace())).toBe(false); });
    expect(reset).not.toHaveBeenCalled(); expect(receipts()).toEqual([PERSONAL_RECEIPT, SAMPLE_RECEIPT]);
  });
});
