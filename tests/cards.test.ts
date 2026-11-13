import { describe, expect, it } from "vitest";
import { buildCardInput, validateCards } from "../lib/cards";
import type { CardInput, Nudge } from "../lib/card-types";
import type { ExportData, Topic } from "../lib/types";

function topic(id: string, overrides: Partial<Topic> = {}): Topic {
  return {
    id, name: `토픽 ${id}`, one_liner: "가상 검증 토픽", theme: "개발", category: "personal",
    progress: "in_progress", last_touched: "recent_2w", goal: "작은 결과물 완성",
    status_text: "초안이 있음", outputs: ["화면 초안"], recent_decisions: [], blockers: null,
    next_steps: ["초안 비교"], deadline: null, deadline_label: null, deadline_text: null,
    collaborators: [], related: [], sources: ["other"], merged_from: [],
    suggested_state: "active", suggested_reason: "진행 중, 다음 할 일 있음", ...overrides,
  };
}

function exported(topics: Topic[] = [topic("t1")]): ExportData {
  return {
    profile: { summary: "가상 사용자", roles: ["개발자"], interests: ["게임"], current_focus: ["기능 구현"], tools: ["편집기"], work_style: null },
    themes: ["개발"], topics,
  };
}

function input(topics: Topic[] = [topic("t1"), topic("t2"), topic("t3"), topic("t4")]): CardInput {
  return buildCardInput(exported(topics), "2026-11-12");
}

function card(overrides: Partial<Nudge> = {}): Nudge {
  return {
    id: "n1", slot: "focus", topic_id: "t1", new_topic_name: null, type: "continue",
    title: "화면 초안 두 곳 비교하기", action: "준비된 비교표에서 확인할 항목을 고르세요.",
    est_minutes: 10, why_now: "화면 초안이 있어 비교할 수 있어요.",
    evidence: [{ source: "topic", fact: "화면 초안" }],
    head_start: { kind: "checklist", content: "- [ ] 제목 확인\n- [ ] 버튼 확인", options: [] },
    first_step: "제목 항목을 먼저 확인하세요.", ...overrides,
  };
}

describe("buildCardInput", () => {
  it("only caps sent active topics and does not change the imported data", () => {
    const data = exported(Array.from({ length: 12 }, (_, index) => topic(`t${index + 1}`)));
    data.topics.push(topic("later", { suggested_state: "later" }), topic("removed", { suggested_state: "remove" }));
    const before = structuredClone(data);
    const result = buildCardInput(data, "2026-11-12", { excludedTopicIds: ["t1"], starredTopicIds: ["t2"] });
    expect(result.topics).toHaveLength(9);
    expect(result.topics[0]).toMatchObject({ id: "t2", starred: true });
    expect(result.topics.map((value) => value.id)).not.toContain("t1");
    expect(result.profile).not.toHaveProperty("summary");
    expect(result.profile).not.toHaveProperty("tools");
    expect(data).toEqual(before);
  });

  it("calculates calendar days in the app and keeps null deadlines", () => {
    const result = input([topic("t1", { deadline: "2026-11-15" }), topic("t2"), topic("t3", { deadline: "2026-11-12" })]);
    expect(result.topics.map((value) => value.days_left)).toEqual([3, null, 0]);
    expect(input([topic("t1", { deadline: "2027-01-01" })]).topics[0].days_left).toBe(50);
    expect(() => buildCardInput(exported(), "2026-02-30")).toThrow("today");
  });

  it("keeps only the most recent twenty feedback entries", () => {
    const feedback = Array.from({ length: 24 }, (_, index) => ({ topic_id: "t1", type: "continue" as const, title: String(index), action: String(index), result: "completed" as const, note: null }));
    const result = buildCardInput(exported(), "2026-11-12", { feedback });
    expect(result.feedback).toHaveLength(20);
    expect(result.feedback[0].title).toBe("4");
    expect(result.feedback.at(-1)?.title).toBe("23");
  });
});

describe("validateCards", () => {
  it("accepts a normal empty response without retrying", () => {
    expect(validateCards({ nudges: [] }, input())).toEqual({ nudges: [], rejected: [], schemaValid: true, shouldRetry: false });
  });

  it("accepts up to two focus cards followed by one explore card", () => {
    const nudges = [card(), card({ id: "n2", topic_id: "t2" }), card({ id: "n3", slot: "explore", type: "expand", topic_id: "t3" })];
    expect(validateCards({ nudges }, input())).toEqual({ nudges, rejected: [], schemaValid: true, shouldRetry: false });
  });

  it("retries only when every supplied candidate was discarded", () => {
    const result = validateCards({ nudges: [card({ topic_id: "absent" }), card({ id: "n2", est_minutes: 31 })] }, input());
    expect(result.nudges).toEqual([]);
    expect(result.rejected).toHaveLength(2);
    expect(result.schemaValid).toBe(true);
    expect(result.shouldRetry).toBe(true);
  });

  it("salvages a valid card after a canonical per-card structure failure", () => {
    const good = card({ id: "n2", topic_id: "t2" });
    const result = validateCards({ nudges: [{ id: "broken", title: "필드 누락" }, good] }, input());
    expect(result.schemaValid).toBe(false);
    expect(result.nudges).toEqual([good]);
    expect(result.rejected[0].id).toBe("broken");
    expect(result.shouldRetry).toBe(false);
  });

  it("does not accept unknown envelope fields or a missing nudges array", () => {
    expect(validateCards({ nudges: [card()], unexpected: true }, input())).toMatchObject({ nudges: [], schemaValid: false, shouldRetry: true });
    expect(validateCards({}, input())).toMatchObject({ nudges: [], schemaValid: false, shouldRetry: false });
    expect(validateCards(null, input())).toMatchObject({ nudges: [], schemaValid: false, shouldRetry: false });
  });

  it("applies the slot limits and one-card-per-topic rule", () => {
    const result = validateCards({ nudges: [card(), card({ id: "n2", topic_id: "t1" }), card({ id: "n3", topic_id: "t2" }), card({ id: "n4", topic_id: "t3" })] }, input());
    expect(result.nudges.map((value) => value.id)).toEqual(["n1", "n3"]);
    expect(result.rejected).toHaveLength(2);
    const explores = validateCards({ nudges: [card({ slot: "explore", type: "expand" }), card({ id: "n2", topic_id: "t2", slot: "explore", type: "expand" })] }, input());
    expect(explores.nudges).toHaveLength(1);
    expect(explores.rejected[0].reasons).toContain("explore는 최대 1장입니다.");
  });

  it.each([
    ["slot-type mismatch", { slot: "explore" }],
    ["unblock without options", { type: "unblock" }],
    ["non-unblock with question", { head_start: { kind: "question", content: "하나 고르세요", options: [] } }],
    ["out of range minutes", { est_minutes: 0 }],
    ["missing new project name", { slot: "explore", type: "new_project", topic_id: "new" }],
    ["existing topic with new name", { new_topic_name: "다른 이름" }],
    ["too much evidence", { evidence: Array.from({ length: 4 }, () => ({ source: "topic", fact: "초안" })) }],
    ["oversized draft", { head_start: { kind: "draft", content: "가".repeat(601), options: [] } }],
  ] as Array<[string, Partial<Nudge>]>) ("discards %s", (_name, overrides) => {
    expect(validateCards({ nudges: [card(overrides)] }, input())).toMatchObject({ nudges: [], shouldRetry: true });
  });

  it("accepts an unblock question with two actual answer choices", () => {
    const question = card({ type: "unblock", head_start: { kind: "question", content: "어느 화면부터 비교할까요?", options: [{ id: "a", label: "목록 화면", value: "목록 화면부터 비교할게요." }, { id: "b", label: "상세 화면", value: "상세 화면부터 비교할게요." }] } });
    expect(validateCards({ nudges: [question] }, input()).nudges).toEqual([question]);
  });

  it("rejects an action that exactly matches dismissed feedback", () => {
    const current = input();
    current.feedback.push({ topic_id: "t1", type: "continue", title: "이전", action: card().action, result: "dismissed", note: null });
    expect(validateCards({ nudges: [card()] }, current).rejected[0].reasons).toContain("dismissed 카드와 action이 같습니다.");
  });

  it("rejects exploration of a topic whose deadline is within three days", () => {
    const current = input([topic("t1", { deadline: "2026-11-15" })]);
    expect(validateCards({ nudges: [card({ slot: "explore", type: "expand" })] }, current)).toMatchObject({ nudges: [], shouldRetry: true });
  });

  it("accepts a named new project that is not in the sent topics", () => {
    const nudge = card({ slot: "explore", type: "new_project", topic_id: "new", new_topic_name: "작은 UI 실험" });
    expect(validateCards({ nudges: [nudge] }, input()).nudges).toEqual([nudge]);
  });
});
