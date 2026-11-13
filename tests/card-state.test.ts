import { describe, expect, it } from "vitest";
import type { Nudge } from "../lib/card-types";
import {
  acceptCard, answerCard, applyGeneratedCards, buildWorkspaceCardInput, completeCard,
  continueAcceptedCard, dismissCard, failCardGeneration, getCardState, isAcceptedUnfinished, isStaleAccepted,
  markCardGeneration, restoreRemovedTopic, shouldGenerateCards, snapshotTopicRemoval,
  snoozeCard, updateCardContent, visibleCards,
} from "../lib/card-state";
import { parseExport } from "../lib/parse";
import { confirmOnboarding, moveTopicTheme, removeTopic, selectTopic, setTopicState, toggleStar } from "../lib/workspace";

const TODAY = "2026-11-12";
const NOW = "2026-11-12T12:00:00.000Z";

function workspace(count = 3) {
  const data = parseExport(`## 나
- 하는 일/역할: 가상 개발자
## 테마: 개발
${Array.from({ length: count }, (_, index) => `### 가상 작업 ${index + 1}
- 한 줄 설명: 테스트용 가상 프로젝트
- 진행 여부: 진행 중
- 내가 말했던 다음 할 일: 동작 확인`).join("\n")}`, { today: TODAY });
  return confirmOnboarding(data, Object.fromEntries(data.topics.map((topic) => [topic.id, "active"])), null, NOW);
}

function nudge(overrides: Partial<Nudge> = {}): Nudge {
  return {
    id: "n1", slot: "focus", topic_id: "t1", new_topic_name: null, type: "continue",
    title: "준비된 초안 확인하기", action: "준비된 초안의 체크 항목을 확인해 주세요.", est_minutes: 5,
    why_now: "다음 할 일이 동작 확인이에요.", evidence: [{ source: "topic", fact: "다음 할 일은 동작 확인" }],
    head_start: { kind: "checklist", content: "- [ ] 동작 확인\n- [ ] 결과 기록", options: [] }, first_step: "첫 항목을 확인해 주세요.",
    ...overrides,
  };
}

describe("generation and persisted caching", () => {
  it("automatically attempts only once per local date, including failure, and allows the next date", () => {
    const original = workspace();
    expect(shouldGenerateCards(original, TODAY)).toBe(true);
    const marked = markCardGeneration(original, TODAY);
    expect(shouldGenerateCards(marked, TODAY)).toBe(false);
    const failed = failCardGeneration(marked, "초안을 준비하지 못했어요.");
    expect(getCardState(failed).error).toBe("초안을 준비하지 못했어요.");
    expect(shouldGenerateCards(failed, TODAY)).toBe(false);
    expect(shouldGenerateCards(failed, "2026-11-13")).toBe(true);
    expect(getCardState(markCardGeneration(failed, TODAY)).error).toBeNull();
    expect(getCardState(original).generated_date).toBeNull();
  });

  it("caches a valid empty result as success without another automatic request", () => {
    const result = applyGeneratedCards(workspace(), [], NOW, TODAY);
    expect(getCardState(result).items).toEqual([]);
    expect(getCardState(result).error).toBeNull();
    expect(shouldGenerateCards(result, TODAY)).toBe(false);
  });

  it("matches request tokens for success and failure and ignores requests from an earlier workspace", () => {
    const marked = markCardGeneration(workspace(), TODAY, "request-current");
    expect(getCardState(marked).request_id).toBe("request-current");
    expect(applyGeneratedCards(marked, [nudge()], NOW, TODAY, "request-old")).toBe(marked);
    expect(failCardGeneration(marked, "이전 요청 실패", "request-old")).toBe(marked);
    const failed = failCardGeneration(marked, "현재 요청 실패", "request-current");
    expect(getCardState(failed)).toMatchObject({ error: "현재 요청 실패", request_id: null });
    const success = applyGeneratedCards(marked, [nudge()], NOW, TODAY, "request-current");
    expect(getCardState(success).items).toHaveLength(1);
    expect(getCardState(success).request_id).toBeNull();
    const reset = { ...marked, cards: undefined };
    expect(applyGeneratedCards(reset, [nudge()], NOW, TODAY, "request-current")).toBe(reset);
    expect(failCardGeneration(reset, "이전 요청 실패", "request-current")).toBe(reset);
  });

  it("replaces pending suggestions while preserving accepted cards, edits and snoozed originals", () => {
    let state = applyGeneratedCards(workspace(), [nudge(), nudge({ id: "n2", topic_id: "t2" }), nudge({ id: "n3", topic_id: "t3" })], NOW, TODAY);
    state = updateCardContent(state, "card-1", "직접 고친 초안");
    state = acceptCard(state, "card-1", NOW);
    state = snoozeCard(state, "card-2", TODAY);
    const saved = getCardState(state).items.slice(0, 2);
    state = applyGeneratedCards(state, [nudge({ topic_id: "t3" })], NOW, TODAY);
    expect(getCardState(state).items.map((card) => card.key)).toEqual(["card-1", "card-2", "card-4"]);
    expect(getCardState(state).items.slice(0, 2)).toEqual(saved);
    expect(getCardState(state).items[0].content).toBe("직접 고친 초안");
    expect(getCardState(state).items[0].nudge.head_start.content).toContain("동작 확인");
  });

  it("discards a late response for an already accepted or deleted topic", () => {
    let state = applyGeneratedCards(workspace(), [nudge()], NOW, TODAY);
    state = acceptCard(state, "card-1", NOW);
    state = removeTopic(state, "t2");
    state = applyGeneratedCards(state, [nudge(), nudge({ id: "n2", topic_id: "t2" })], NOW, TODAY);
    expect(getCardState(state).items).toHaveLength(1);
    expect(getCardState(state).items[0].status).toBe("accepted");
  });

  it("resets the card cache after confirmed onboarding while preserving matched topic notes", () => {
    let old = applyGeneratedCards(workspace(), [nudge()], NOW, TODAY);
    old.topics[0].notes = ["기존 답변"];
    const data = parseExport("### 가상 작업 1\n- 한 줄 설명: 테스트용 가상 프로젝트\n- 진행 여부: 진행 중", { today: TODAY });
    const result = confirmOnboarding(data, {}, old, NOW);
    expect(getCardState(result)).toMatchObject({ items: [], feedback: [], generated_date: null });
    expect(result.topics[0].notes).toEqual(["기존 답변"]);
  });
});

describe("card input selection", () => {
  it("uses user state, excludes accepted unfinished cards, sends stars and deadlines, and caps only outgoing topics", () => {
    let state = workspace(12);
    state = setTopicState(state, "t2", "later");
    state = toggleStar(state, "t12");
    state = moveTopicTheme(state, "t12", null);
    state.topics.find((topic) => topic.id === "t12")!.deadline = "2026-11-15";
    state = applyGeneratedCards(state, [nudge()], NOW, TODAY);
    state = acceptCard(state, "card-1", NOW);
    const input = buildWorkspaceCardInput(state, TODAY);
    expect(input.topics).toHaveLength(9);
    expect(input.topics[0]).toMatchObject({ id: "t12", starred: true, days_left: 3, theme: "따로 뺀 토픽" });
    expect(input.topics.some((topic) => topic.id === "t1" || topic.id === "t2")).toBe(false);
    expect(state.topics).toHaveLength(12);
    expect(state.topics.filter((topic) => topic.state === "active")).toHaveLength(11);
  });

  it("keeps snoozed topics eligible and sends their feedback without editing the input schema", () => {
    let state = applyGeneratedCards(workspace(), [nudge()], NOW, TODAY);
    state = snoozeCard(state, "card-1", TODAY);
    const input = buildWorkspaceCardInput(state, TODAY);
    expect(input.topics.some((topic) => topic.id === "t1")).toBe(true);
    expect(input.feedback).toEqual([expect.objectContaining({ topic_id: "t1", result: "snoozed" })]);
    expect(() => buildWorkspaceCardInput(state, "2026-02-31")).toThrow("날짜 형식");
  });
});

describe("card lifecycle", () => {
  it("completes a card once and records the optional note while removing it from visible suggestions", () => {
    const original = applyGeneratedCards(workspace(), [nudge()], NOW, TODAY);
    const completed = completeCard(original, "card-1", "  첫 항목을 확인했어요  ", NOW);
    expect(visibleCards(completed, TODAY)).toEqual([]);
    expect(getCardState(completed).feedback).toEqual([expect.objectContaining({ result: "completed", note: "첫 항목을 확인했어요" })]);
    expect(completeCard(completed, "card-1", null, NOW)).toBe(completed);
    expect(getCardState(original).feedback).toEqual([]);
  });

  it("hides a snoozed edited card until the next calendar day and returns the stored original", () => {
    let state = applyGeneratedCards(workspace(), [nudge()], NOW, "2026-12-31");
    state = updateCardContent(state, "card-1", "수정한 내용");
    state = snoozeCard(state, "card-1", "2026-12-31");
    expect(visibleCards(state, "2026-12-31")).toEqual([]);
    const returned = visibleCards(state, "2027-01-01");
    expect(returned).toHaveLength(1);
    expect(returned[0]).toMatchObject({ key: "card-1", content: "수정한 내용", status: "snoozed", snoozed_until: "2027-01-01" });
    expect(returned[0]).toBe(getCardState(state).items[0]);
  });

  it("prompts at exactly 48 hours and can continue or dismiss the accepted card", () => {
    let state = applyGeneratedCards(workspace(), [nudge()], NOW, TODAY);
    state = acceptCard(state, "card-1", NOW);
    const card = getCardState(state).items[0];
    expect(isStaleAccepted(card, "2026-11-14T11:59:59.999Z")).toBe(false);
    expect(isStaleAccepted(card, "2026-11-14T12:00:00.000Z")).toBe(true);
    const continued = continueAcceptedCard(state, "card-1", "2026-11-14T12:00:00.000Z");
    expect(isStaleAccepted(getCardState(continued).items[0], "2026-11-14T12:00:00.000Z")).toBe(false);
    const dismissed = dismissCard(state, "card-1", "2026-11-14T12:00:00.000Z");
    expect(getCardState(dismissed).feedback.at(-1)?.result).toBe("dismissed");
    expect(visibleCards(dismissed, "2026-11-14")).toEqual([]);
    expect(buildWorkspaceCardInput(dismissed, TODAY).topics.some((topic) => topic.id === "t1")).toBe(true);
  });

  it("keeps accepted snoozed work unfinished and excluded when the stored card returns the next day", () => {
    let state = applyGeneratedCards(workspace(), [nudge()], NOW, TODAY);
    state = acceptCard(state, "card-1", NOW);
    state = updateCardContent(state, "card-1", "보류하기 전에 고친 내용");
    state = snoozeCard(state, "card-1", TODAY);
    const original = getCardState(state).items[0];
    expect(isAcceptedUnfinished(original)).toBe(true);
    expect(visibleCards(state, TODAY)).toEqual([]);
    expect(visibleCards(state, "2026-11-13")[0]).toBe(original);
    expect(visibleCards(state, "2026-11-13")[0].content).toBe("보류하기 전에 고친 내용");
    expect(buildWorkspaceCardInput(state, "2026-11-13").topics.some((topic) => topic.id === "t1")).toBe(false);
    const regenerated = applyGeneratedCards(state, [nudge()], NOW, "2026-11-13");
    expect(getCardState(regenerated).items).toEqual([original]);
    expect(isStaleAccepted(original, "2026-11-14T11:59:59.999Z")).toBe(false);
    expect(isStaleAccepted(original, "2026-11-14T12:00:00.000Z")).toBe(true);
    const continued = continueAcceptedCard(state, "card-1", "2026-11-14T12:00:00.000Z");
    expect(getCardState(continued).items[0]).toMatchObject({ status: "accepted", snoozed_until: null, accepted_at: "2026-11-14T12:00:00.000Z" });
    expect(isStaleAccepted(getCardState(continued).items[0], "2026-11-14T12:00:00.000Z")).toBe(false);
    const completed = completeCard(state, "card-1", null, NOW);
    expect(isAcceptedUnfinished(getCardState(completed).items[0])).toBe(false);
    expect(buildWorkspaceCardInput(completed, TODAY).topics.some((topic) => topic.id === "t1")).toBe(true);
  });

  it("does not allow another card to be accepted while accepted snoozed work remains unfinished", () => {
    let state = applyGeneratedCards(workspace(), [nudge(), nudge({ id: "n2" })], NOW, TODAY);
    state = acceptCard(state, "card-1", NOW);
    state = snoozeCard(state, "card-1", TODAY);
    expect(() => acceptCard(state, "card-2", NOW)).toThrow("진행 중인 카드");
  });

  it("creates a new project only when its card is accepted and never twice", () => {
    let state = applyGeneratedCards(workspace(), [nudge({ type: "new_project", slot: "explore", topic_id: "new", new_topic_name: "새 가상 실험" })], NOW, TODAY);
    expect(state.topics).toHaveLength(3);
    state = acceptCard(state, "card-1", NOW);
    expect(state.topics).toHaveLength(4);
    const card = getCardState(state).items[0];
    expect(card.nudge.topic_id).not.toBe("new");
    expect(state.topics.at(-1)).toMatchObject({ id: card.nudge.topic_id, name: "새 가상 실험", state: "active", theme: null, sources: [] });
    expect(acceptCard(state, "card-1", NOW)).toBe(state);
    expect(buildWorkspaceCardInput(state, TODAY).topics.some((topic) => topic.id === card.nudge.topic_id)).toBe(false);
  });

  it("stores a question's actual answer in topic notes and completed feedback exactly once", () => {
    const question = nudge({ type: "unblock", head_start: { kind: "question", content: "어느 동작부터 볼까요?", options: [
      { id: "a", label: "첫 동작", value: "첫 동작부터 확인할게요." },
      { id: "b", label: "둘째 동작", value: "둘째 동작부터 확인할게요." },
    ] } });
    const original = applyGeneratedCards(workspace(), [question], NOW, TODAY);
    expect(() => answerCard(original, "card-1", "missing", NOW)).toThrow("선택한 답");
    const answered = answerCard(original, "card-1", "b", NOW);
    expect(answered.topics[0].notes).toEqual(["둘째 동작부터 확인할게요."]);
    expect(getCardState(answered).feedback.at(-1)).toMatchObject({ result: "completed", note: "둘째 동작부터 확인할게요." });
    expect(answerCard(answered, "card-1", "b", NOW)).toBe(answered);
  });

  it("keeps only the most recent 20 feedback records", () => {
    let state = workspace();
    for (let index = 0; index < 21; index++) {
      state = applyGeneratedCards(state, [nudge({ action: `가상 행동 ${index}` })], NOW, TODAY);
      state = dismissCard(state, `card-${index + 1}`, NOW);
    }
    expect(getCardState(state).feedback).toHaveLength(20);
    expect(getCardState(state).feedback[0].action).toBe("가상 행동 1");
    expect(buildWorkspaceCardInput(state, TODAY).feedback).toHaveLength(20);
  });
});

describe("topic deletion and focused undo", () => {
  it("removes related cards and restores only that topic while retaining unrelated edits and cards", () => {
    let state = applyGeneratedCards(workspace(), [nudge(), nudge({ id: "n2", topic_id: "t2" })], NOW, TODAY);
    state = acceptCard(state, "card-1", NOW);
    state = selectTopic(state, "t1", NOW);
    const snapshot = snapshotTopicRemoval(state, "t1")!;
    let deleted = removeTopic(state, "t1");
    expect(getCardState(deleted).items.map((card) => card.key)).toEqual(["card-2"]);
    deleted = updateCardContent(deleted, "card-2", "삭제 뒤에 고친 다른 초안");
    deleted = setTopicState(deleted, "t2", "later");
    deleted = selectTopic(deleted, "t2", NOW);
    const restored = restoreRemovedTopic(deleted, snapshot);
    expect(restored.topics.find((topic) => topic.id === "t2")?.state).toBe("later");
    expect(restored.selected_topic_id).toBe("t2");
    expect(getCardState(restored).items.find((card) => card.key === "card-2")?.content).toBe("삭제 뒤에 고친 다른 초안");
    expect(getCardState(restored).items.find((card) => card.key === "card-1")?.status).toBe("accepted");
    expect(restored.removed_names).not.toContain("가상 작업 1");
    expect(restoreRemovedTopic(restored, snapshot)).toBe(restored);
  });
});
