import { describe, expect, it } from "vitest";
import { parseExport } from "../lib/parse";
import type { ExportData } from "../lib/types";
import {
  confirmOnboarding, matchPreviousTopics, moveTopicTheme, removeTopic, selectTopic, setLaterCollapsed,
  setThemeCollapsed, setTopicState, sortTopics, toggleStar,
} from "../lib/workspace";

const NOW = "2026-11-12T12:00:00.000Z";
function exported(count = 4): ExportData {
  return parseExport(`## 나
- 하는 일/역할: 가상 개발자
## 테마: 개발
${Array.from({ length: count }, (_, i) => `### 작업 ${i + 1}
- 한 줄 설명: 가상의 작업 ${i + 1}
- 종류: 개인 프로젝트
- 진행 여부: 진행 중
- 내가 말했던 다음 할 일: 동작 확인`).join("\n")}`, { today: "2026-11-12" });
}
const workspace = () => confirmOnboarding(exported(), {}, null, NOW);

describe("confirmOnboarding", () => {
  it("honors active/later/remove choices and records removed names", () => {
    const data = exported();
    const before = structuredClone(data);
    const result = confirmOnboarding(data, { t1: "later", t2: "remove" }, null, NOW);
    expect(data).toEqual(before);
    expect(result.topics.map((topic) => topic.id)).toEqual(["t1", "t3", "t4"]);
    expect(result.topics[0]).toMatchObject({ state: "later", starred: false, manual_order: null, updated_at: NOW });
    expect(result.removed_names).toEqual(["작업 2"]);
    expect(result.later_collapsed).toBe(true);
    expect(result.selected_topic_id).toBeNull();
  });

  it("does not resurrect a deleted topic when the same text is imported with an active choice", () => {
    const original = workspace();
    const removed = removeTopic(original, "t2");
    const result = confirmOnboarding(exported(), { t2: "active" }, removed, NOW);
    expect(result.topics.some((topic) => topic.name === "작업 2")).toBe(false);
    expect(result.removed_names).toEqual(["작업 2"]);
    expect(original.topics).toHaveLength(4);
    expect(original.removed_names).toEqual([]);
  });

  it("removes only the chosen duplicate ID while retaining a same-name item from another source", () => {
    const data = exported(2);
    data.topics[1].name = data.topics[0].name;
    data.topics[1].sources = ["claude"];
    const result = confirmOnboarding(data, { t1: "remove", t2: "active" }, null, NOW);
    expect(result.topics.map((topic) => topic.id)).toEqual(["t2"]);
    expect(result.topics[0].sources).toEqual(["claude"]);
    expect(result.removed_names).toEqual([]);
    const allRemoved = confirmOnboarding(data, { t1: "remove", t2: "remove" }, null, NOW);
    expect(allRemoved.topics).toEqual([]);
    expect(allRemoved.removed_names).toEqual(["작업 1"]);
    expect(confirmOnboarding(data, { t1: "active", t2: "later" }, allRemoved, NOW).topics).toEqual([]);
  });

  it("replaces the list, retains matching user settings by name, and gives explicit choices priority", () => {
    let old = workspace();
    old = toggleStar(old, "t1");
    old = moveTopicTheme(old, "t1", "직접 만든 테마");
    old = setThemeCollapsed(old, "직접 만든 테마", true);
    old = setTopicState(old, "t1", "later");
    old = selectTopic(old, "t1", "2026-11-12T13:00:00.000Z");
    old = setLaterCollapsed(old, false);
    old.topics[0].manual_order = 2;
    const incoming = exported(1);
    incoming.topics[0].id = "new-id";
    const noDecision = confirmOnboarding(incoming, {}, old, NOW);
    expect(noDecision.topics).toHaveLength(1);
    expect(noDecision.topics[0]).toMatchObject({
      id: "new-id", state: "later", starred: true, theme: "직접 만든 테마",
      manual_order: 2, updated_at: "2026-11-12T13:00:00.000Z",
    });
    expect(noDecision.themes).toContainEqual({ name: "직접 만든 테마", collapsed: true });
    expect(noDecision.selected_topic_id).toBe("new-id");
    expect(noDecision.later_collapsed).toBe(false);
    const explicit = confirmOnboarding(incoming, { "new-id": "active" }, old, NOW);
    expect(explicit.topics[0].state).toBe("active");
  });

  it("restores same-name topics one-to-one by source and follows the matched selection after reordering", () => {
    const data = exported(2);
    data.topics[1].name = data.topics[0].name;
    data.topics[0].sources = ["chatgpt"];
    data.topics[1].sources = ["claude"];
    let old = confirmOnboarding(data, {}, null, NOW);
    old = toggleStar(old, "t1");
    old = moveTopicTheme(old, "t1", null);
    old = setTopicState(old, "t1", "later");
    old = selectTopic(old, "t2", "2026-11-12T13:00:00.000Z");
    const incoming = { ...data, topics: [
      { ...data.topics[1], id: "new-claude" },
      { ...data.topics[0], id: "new-chatgpt" },
    ] };
    const matches = matchPreviousTopics(incoming, old);
    expect(matches.get("new-chatgpt")?.id).toBe("t1");
    expect(matches.get("new-claude")?.id).toBe("t2");
    const result = confirmOnboarding(incoming, {}, old, NOW);
    expect(result.topics[0]).toMatchObject({ id: "new-claude", starred: false, theme: "개발", state: "active", updated_at: "2026-11-12T13:00:00.000Z" });
    expect(result.topics[1]).toMatchObject({ id: "new-chatgpt", starred: true, theme: null, state: "later", updated_at: NOW });
    expect(result.selected_topic_id).toBe("new-claude");
    expect(confirmOnboarding(incoming, { "new-claude": "remove" }, old, NOW).selected_topic_id).toBeNull();
  });

  it("uses defaults for ambiguous same-name same-source topics instead of copying one topic's preferences", () => {
    const data = exported(2);
    data.topics[1].name = data.topics[0].name;
    let old = confirmOnboarding(data, {}, null, NOW);
    old = toggleStar(old, "t1");
    old = moveTopicTheme(old, "t1", null);
    old = setTopicState(old, "t1", "later");
    old = selectTopic(old, "t1", "2026-11-12T13:00:00.000Z");
    const incoming = { ...data, topics: data.topics.map((topic) => ({ ...topic, id: `new-${topic.id}` })) };
    expect(matchPreviousTopics(incoming, old).size).toBe(0);
    const result = confirmOnboarding(incoming, {}, old, NOW);
    expect(result.topics.every((topic) => !topic.starred && topic.theme === "개발" && topic.state === "active" && topic.updated_at === NOW)).toBe(true);
    expect(result.selected_topic_id).toBeNull();
  });

  it("matches unique names across source changes and compares duplicate source combinations without order", () => {
    const data = exported(2);
    const old = confirmOnboarding(data, {}, null, NOW);
    const unique = structuredClone(data);
    unique.topics.forEach((topic) => { topic.sources = ["claude"]; });
    expect(matchPreviousTopics(unique, old).get("t1")?.id).toBe("t1");
    data.topics[1].name = data.topics[0].name;
    data.topics[0].sources = ["chatgpt", "claude"];
    data.topics[1].sources = ["other"];
    const duplicateOld = confirmOnboarding(data, {}, null, NOW);
    const incoming = structuredClone(data);
    incoming.topics = [{ ...data.topics[0], id: "new-combined", sources: ["claude", "chatgpt"] }];
    expect(matchPreviousTopics(incoming, duplicateOld).get("new-combined")?.id).toBe("t1");
  });

  it("preserves a matching topic's separate placement and does not force theme or active counts", () => {
    const old = moveTopicTheme(workspace(), "t1", null);
    expect(confirmOnboarding(exported(), {}, old, NOW).topics[0].theme).toBeNull();
    const data = exported(12);
    const decisions = Object.fromEntries(data.topics.map((topic) => [topic.id, "active" as const]));
    const result = confirmOnboarding(data, decisions, null, NOW);
    expect(result.topics.filter((topic) => topic.state === "active")).toHaveLength(12);
    expect(result.themes).toEqual([{ name: "개발", collapsed: false }]);
  });
});

describe("workspace changes", () => {
  it("enforces a global three-star maximum and allows unstar before adding another", () => {
    let state = workspace();
    for (const id of ["t1", "t2", "t3"]) state = toggleStar(state, id);
    expect(() => toggleStar(state, "t4")).toThrow("최대 3개");
    expect(state.topics.filter((topic) => topic.starred)).toHaveLength(3);
    state = toggleStar(state, "t2");
    state = toggleStar(state, "t4");
    expect(state.topics.filter((topic) => topic.starred).map((topic) => topic.id)).toEqual(["t1", "t3", "t4"]);
  });

  it("moves topics between states and themes without mutating parser suggestions or old state", () => {
    const original = workspace();
    const before = structuredClone(original);
    let state = setTopicState(original, "t1", "later");
    state = moveTopicTheme(state, "t1", "별도 테마");
    state = setThemeCollapsed(state, "별도 테마", true);
    expect(state.topics[0]).toMatchObject({ state: "later", suggested_state: "active", theme: "별도 테마" });
    expect(state.themes).toContainEqual({ name: "별도 테마", collapsed: true });
    state = moveTopicTheme(state, "t1", null);
    expect(state.topics[0].theme).toBeNull();
    expect(original).toEqual(before);
  });

  it("persists selected topic intent in the data and clears selection when deleting it", () => {
    const original = workspace();
    const selected = selectTopic(original, "t3", "2026-11-12T14:00:00.000Z");
    expect(selected.selected_topic_id).toBe("t3");
    expect(selected.topics[2].updated_at).toBe("2026-11-12T14:00:00.000Z");
    expect(removeTopic(selected, "t3").selected_topic_id).toBeNull();
    expect(selectTopic(selected, null, NOW).selected_topic_id).toBeNull();
    expect(selectTopic(original, "missing", NOW)).toBe(original);
  });

  it("adds a deleted-name record only when the final same-name topic is removed", () => {
    const data = exported(2);
    data.topics[1].name = data.topics[0].name;
    const original = confirmOnboarding(data, {}, null, NOW);
    const first = removeTopic(original, "t1");
    expect(first.topics.map((topic) => topic.id)).toEqual(["t2"]);
    expect(first.removed_names).toEqual([]);
    const last = removeTopic(first, "t2");
    expect(last.topics).toEqual([]);
    expect(last.removed_names).toEqual(["작업 1"]);
  });

  it("returns the existing object for actions targeting missing items", () => {
    const state = workspace();
    expect(removeTopic(state, "missing")).toBe(state);
    expect(toggleStar(state, "missing")).toBe(state);
    expect(setTopicState(state, "missing", "later")).toBe(state);
    expect(moveTopicTheme(state, "missing", "새 테마")).toBe(state);
    expect(setThemeCollapsed(state, "missing", true)).toBe(state);
  });
});

describe("sortTopics", () => {
  it("sorts deadlines first, then recent visits, manual ties and original order without mutation", () => {
    const base = workspace().topics[0];
    const topics = [
      { ...base, id: "no-deadline", updated_at: "2026-11-15T00:00:00Z" },
      { ...base, id: "later-deadline", deadline: "2026-11-20" },
      { ...base, id: "older-visit", deadline: "2026-11-15", updated_at: "2026-11-10T00:00:00Z" },
      { ...base, id: "manual-second", deadline: "2026-11-15", manual_order: 2 },
      { ...base, id: "manual-first", deadline: "2026-11-15", manual_order: 1 },
      { ...base, id: "same-one", deadline: "2026-11-15" },
      { ...base, id: "same-two", deadline: "2026-11-15" },
      { ...base, id: "missing-visit", deadline: "2026-11-15", updated_at: null },
    ];
    const before = structuredClone(topics);
    expect(sortTopics(topics).map((topic) => topic.id)).toEqual([
      "manual-first", "manual-second", "same-one", "same-two", "older-visit", "missing-visit", "later-deadline", "no-deadline",
    ]);
    expect(topics).toEqual(before);
  });
});
