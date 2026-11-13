import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceProvider, useWorkspace } from "../components/workspace-provider";
import { parseExport } from "../lib/parse";
import { loadWorkspace, saveWorkspace, WORKSPACE_STORAGE_KEY } from "../lib/storage";
import { confirmOnboarding, moveTopicTheme, removeTopic, selectTopic, setLaterCollapsed, setThemeCollapsed, setTopicState, toggleStar } from "../lib/workspace";
import { acceptCard, applyGeneratedCards, getCardState, shouldGenerateCards, snoozeCard, updateCardContent, visibleCards } from "../lib/card-state";
import type { Nudge } from "../lib/card-types";

const NOW = "2026-11-12T12:00:00.000Z";
const card: Nudge = {
  id: "n1", topic_id: "t1", slot: "focus", type: "continue", new_topic_name: null,
  title: "발표 자료 확인하기", action: "준비된 발표 목차를 확인해 주세요.", est_minutes: 5,
  why_now: "발표 자료 검토가 다음 할 일이에요.", evidence: [{ source: "topic", fact: "다음 할 일은 발표 자료 검토" }],
  head_start: { kind: "outline", content: "1. 목표\n2. 만든 것\n3. 다음 할 일", options: [] }, first_step: "첫 항목을 확인해 주세요.",
};
const fixture = () => confirmOnboarding(parseExport(`## 나
- 하는 일/역할: 가상 학생
## 테마: 학교
### 가상 팀플
- 한 줄 설명: 조별 발표 준비
- 진행 여부: 진행 중
- 내가 말했던 다음 할 일: 발표 자료 검토
### 가상 개인 작업
- 한 줄 설명: 개인 코드 실험
- 진행 여부: 진행 중
- 내가 말했던 다음 할 일: 경계값 확인`, { today: "2026-11-12" }), {}, null, NOW);

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
}

describe("workspace storage", () => {
  it("returns null for an empty store without writing anything", () => {
    const storage = memoryStorage();
    expect(loadWorkspace(storage)).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.getItem).toHaveBeenCalledWith(WORKSPACE_STORAGE_KEY);
  });

  it("round-trips all topic interactions, selected topic, collapsed sections and deleted names", () => {
    const storage = memoryStorage();
    let state = fixture();
    state = toggleStar(state, "t1");
    state = setTopicState(state, "t1", "later");
    state = moveTopicTheme(state, "t1", null);
    state = setThemeCollapsed(state, "학교", true);
    state = setLaterCollapsed(state, false);
    state = selectTopic(state, "t1", NOW);
    state = removeTopic(state, "t2");
    saveWorkspace(storage, state);
    const restored = loadWorkspace(storage);
    expect(restored).toEqual(state);
    expect(restored).not.toBe(state);
    expect(restored?.topics[0]).toMatchObject({ theme: null, state: "later", starred: true, updated_at: NOW });
    expect(restored?.removed_names).toEqual(["가상 개인 작업"]);
    expect(restored?.selected_topic_id).toBe("t1");
    expect(restored?.later_collapsed).toBe(false);
  });

  it("saves same-name duplicates after removing one and records the deletion after the last is removed", () => {
    const storage = memoryStorage();
    const state = fixture();
    state.topics[1].name = state.topics[0].name;
    const first = removeTopic(state, "t1");
    expect(() => saveWorkspace(storage, first)).not.toThrow();
    expect(loadWorkspace(storage)?.topics.map((topic) => topic.id)).toEqual(["t2"]);
    expect(loadWorkspace(storage)?.removed_names).toEqual([]);
    const last = removeTopic(first, "t2");
    expect(() => saveWorkspace(storage, last)).not.toThrow();
    expect(loadWorkspace(storage)?.removed_names).toEqual(["가상 팀플"]);
  });

  it("loads pre-card workspaces with default card state and notes without overwriting the legacy data", () => {
    const storage = memoryStorage();
    const legacy = fixture();
    delete legacy.cards;
    legacy.topics.forEach((topic) => { delete topic.notes; });
    const raw = JSON.stringify(legacy);
    storage.values.set(WORKSPACE_STORAGE_KEY, raw);
    const restored = loadWorkspace(storage)!;
    expect(getCardState(restored)).toEqual({ items: [], feedback: [], generated_date: null, error: null, next_key: 1, request_id: null });
    expect(restored.topics.every((topic) => Array.isArray(topic.notes))).toBe(true);
    expect(storage.values.get(WORKSPACE_STORAGE_KEY)).toBe(raw);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("normalizes old caches without a request ID and persists valid request tokens", () => {
    const storage = memoryStorage();
    const legacy = fixture();
    delete legacy.cards!.request_id;
    storage.values.set(WORKSPACE_STORAGE_KEY, JSON.stringify(legacy));
    const restored = loadWorkspace(storage)!;
    expect(getCardState(restored).request_id).toBeNull();
    restored.cards!.request_id = "generation-token";
    saveWorkspace(storage, restored);
    expect(getCardState(loadWorkspace(storage)!).request_id).toBe("generation-token");
    restored.cards!.request_id = "";
    expect(() => saveWorkspace(storage, restored)).toThrow("자료 형식");
  });

  it("persists accepted cards, edited drafts, feedback and next-day snooze returns across reload", () => {
    const storage = memoryStorage();
    let state = applyGeneratedCards(fixture(), [card, { ...card, id: "n2", topic_id: "t2" }], NOW, "2026-11-12");
    state = updateCardContent(state, "card-1", "사용자가 수정한 최종 초안");
    state = acceptCard(state, "card-1", NOW);
    state = snoozeCard(state, "card-2", "2026-11-12");
    saveWorkspace(storage, state);
    const restored = loadWorkspace(storage)!;
    expect(restored).toEqual(state);
    expect(shouldGenerateCards(restored, "2026-11-12")).toBe(false);
    expect(visibleCards(restored, "2026-11-12").map((item) => item.key)).toEqual(["card-1"]);
    expect(visibleCards(restored, "2026-11-13").map((item) => item.key)).toEqual(["card-1", "card-2"]);
    expect(getCardState(restored).items[0].content).toBe("사용자가 수정한 최종 초안");
  });

  it("rejects malformed card cache fields while preserving the saved bytes", () => {
    const storage = memoryStorage();
    const valid = applyGeneratedCards(fixture(), [card], NOW, "2026-11-12");
    const mutations = [
      (value: ReturnType<typeof fixture>) => { value.cards!.items[0].status = "broken" as "pending"; },
      (value: ReturnType<typeof fixture>) => { value.cards!.items[0].created_at = "not a timestamp"; },
      (value: ReturnType<typeof fixture>) => { value.cards!.items[0].nudge.topic_id = "missing"; },
      (value: ReturnType<typeof fixture>) => { value.cards!.next_key = 1; },
      (value: ReturnType<typeof fixture>) => {
        const first = value.cards!.items[0];
        first.status = "snoozed";
        first.accepted_at = NOW;
        first.snoozed_until = "2026-11-13";
        value.cards!.items.push({ ...structuredClone(first), key: "card-2", status: "accepted", snoozed_until: null });
        value.cards!.next_key = 3;
      },
      (value: ReturnType<typeof fixture>) => { value.cards!.items[0].nudge.head_start.options = [null] as unknown as Nudge["head_start"]["options"]; },
    ];
    for (const mutate of mutations) {
      const value = structuredClone(valid);
      mutate(value);
      const raw = JSON.stringify(value);
      storage.values.set(WORKSPACE_STORAGE_KEY, raw);
      expect(() => loadWorkspace(storage)).toThrow("형식을 읽지 못했어요");
      expect(storage.values.get(WORKSPACE_STORAGE_KEY)).toBe(raw);
    }
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it.each(["{broken", "null", "{}", '{"version":2}'])("rejects corrupt data without deleting or overwriting it: %s", (raw) => {
    const storage = memoryStorage();
    storage.values.set(WORKSPACE_STORAGE_KEY, raw);
    expect(() => loadWorkspace(storage)).toThrow("기존 자료는 그대로");
    expect(storage.values.get(WORKSPACE_STORAGE_KEY)).toBe(raw);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("validates nested fields before allowing saved content into the UI", () => {
    const storage = memoryStorage();
    const mutations = [
      (value: Record<string, unknown>) => { value.profile = { summary: "잘못된 프로필" }; },
      (value: Record<string, unknown>) => { (value.topics as Record<string, unknown>[])[0].next_steps = "목록 아님"; },
      (value: Record<string, unknown>) => { (value.topics as Record<string, unknown>[])[0].state = "remove"; },
      (value: Record<string, unknown>) => { (value.topics as Record<string, unknown>[])[0].theme = "없는 테마"; },
      (value: Record<string, unknown>) => { value.selected_topic_id = "missing"; },
      (value: Record<string, unknown>) => { value.removed_names = ["가상 팀플"]; },
    ];
    for (const mutate of mutations) {
      const value = JSON.parse(JSON.stringify(fixture())) as Record<string, unknown>;
      mutate(value);
      const raw = JSON.stringify(value);
      storage.values.set(WORKSPACE_STORAGE_KEY, raw);
      expect(() => loadWorkspace(storage)).toThrow("형식을 읽지 못했어요");
      expect(storage.values.get(WORKSPACE_STORAGE_KEY)).toBe(raw);
    }
  });

  it("reports unavailable storage and quota failure while retaining the previously saved data", () => {
    expect(() => loadWorkspace({ getItem: () => { throw new Error("denied"); } })).toThrow("저장소를 열지 못했어요");
    const storage = memoryStorage();
    const original = fixture();
    saveWorkspace(storage, original);
    const raw = storage.values.get(WORKSPACE_STORAGE_KEY);
    storage.setItem.mockImplementation(() => { throw new Error("quota"); });
    expect(() => saveWorkspace(storage, toggleStar(original, "t1"))).toThrow("저장하지 못했어요");
    expect(storage.values.get(WORKSPACE_STORAGE_KEY)).toBe(raw);
    expect(loadWorkspace(storage)).toEqual(original);
  });

  it("does not access browser storage while server rendering", () => {
    function Probe() {
      const { ready, workspace } = useWorkspace();
      return createElement("span", null, `${ready}:${workspace === null}`);
    }
    expect(renderToString(createElement(WorkspaceProvider, null, createElement(Probe)))).toContain("false:true");
  });
});
