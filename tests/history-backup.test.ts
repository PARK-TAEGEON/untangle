import { describe, expect, it } from "vitest";
import { parseWorkspaceBackup, serializeWorkspaceBackup } from "../lib/backup";
import { applyGeneratedCards, completeCard, dismissCard, markCardGeneration, shouldGenerateCards } from "../lib/card-state";
import type { Nudge } from "../lib/card-types";
import { completedDate, completedSteps } from "../lib/history";
import { parseExport } from "../lib/parse";
import { createSampleWorkspace } from "../lib/sample-mode";
import { loadWorkspace } from "../lib/storage";
import { confirmOnboarding, removeTopic } from "../lib/workspace";

const NOW = "2026-11-13T16:00:00.000Z";
const TODAY = "2026-11-14";
const exported = () => parseExport(`## 나
- 하는 일/역할: 가상 개발자
## 테마: 개발
### 가상 앱
- 한 줄 설명: 가상 동작 확인
- 진행 여부: 진행 중
- 내가 말했던 다음 할 일: 초안 확인`, { today: TODAY });
const workspace = () => confirmOnboarding(exported(), {}, null, NOW);
const nudge: Nudge = {
  id: "n1", topic_id: "t1", new_topic_name: null, slot: "focus", type: "continue", title: "가상 초안 확인하기",
  action: "첫 줄을 확인해 주세요.", est_minutes: 5, why_now: "다음 할 일이에요.",
  evidence: [{ source: "topic", fact: "초안 확인이 다음 할 일" }],
  head_start: { kind: "draft", content: "확인할 초안", options: [] }, first_step: "첫 줄부터 읽어 주세요.",
};

describe("durable completed-step history", () => {
  it("captures legacy memos before the next feedback evicts the oldest one", () => {
    let data = workspace();
    for (let index = 0; index < 20; index++) {
      data = applyGeneratedCards(data, [{ ...nudge, id: `old-${index}`, title: `지난 카드 ${index}` }], NOW, TODAY);
      data = completeCard(data, `card-${index + 1}`, `지난 메모 ${index}`, NOW);
    }
    delete data.completed_steps;
    data = applyGeneratedCards(data, [nudge], NOW, TODAY);
    data = dismissCard(data, "card-21", NOW);
    expect(data.cards?.feedback).toHaveLength(20);
    expect(completedSteps(data)).toHaveLength(20);
    expect(completedSteps(data).find((step) => step.title === "지난 카드 0")?.note).toBe("지난 메모 0");
  });
  it("keeps the original topic name and memo beyond twenty feedback entries and topic removal", () => {
    let data = applyGeneratedCards(workspace(), [nudge], NOW, TODAY);
    data = completeCard(data, "card-1", "  마친 메모  ", NOW);
    for (let index = 0; index < 25; index++) {
      data = applyGeneratedCards(data, [{ ...nudge, id: `n-${index}`, title: `새 초안 ${index}` }], NOW, TODAY);
      data = dismissCard(data, `card-${index + 2}`, NOW);
    }
    expect(data.cards?.feedback.some((item) => item.result === "completed")).toBe(false);
    data.topics[0].name = "바뀐 이름";
    data = removeTopic(data, "t1");
    expect(data.cards?.items).toHaveLength(0);
    expect(completedSteps(data)).toEqual([expect.objectContaining({ title: nudge.title, topic_name: "가상 앱", note: "마친 메모", completed_at: NOW })]);
    const loaded = loadWorkspace({ getItem: () => JSON.stringify(data) });
    expect(completedSteps(loaded!)).toEqual(completedSteps(data));
  });

  it("migrates legacy completed cards once before replacement and keeps history across onboarding", () => {
    let data = completeCard(applyGeneratedCards(workspace(), [nudge], NOW, TODAY), "card-1", "이전 완료 메모", NOW);
    delete data.completed_steps;
    expect(completedSteps(data)).toHaveLength(1);
    data = confirmOnboarding(exported(), {}, data, NOW);
    expect(data.cards?.items).toHaveLength(0);
    expect(completedSteps(data)).toEqual([expect.objectContaining({ note: "이전 완료 메모" })]);
    data = confirmOnboarding(exported(), {}, data, NOW);
    expect(completedSteps(data)).toHaveLength(1);
    expect(completedDate(NOW)).toBe(TODAY);
  });
});

describe("JSON backups", () => {
  it("round-trips app records, strips interrupted requests, and waits for explicit generation after restore", () => {
    const data = markCardGeneration(completeCard(applyGeneratedCards(workspace(), [nudge], NOW, TODAY), "card-1", "백업 메모", NOW), "2026-11-13", "interrupted");
    const before = structuredClone(data);
    const json = serializeWorkspaceBackup(data, NOW);
    expect(JSON.parse(json).workspace.cards.request_id).toBeNull();
    const restored = parseWorkspaceBackup(json, "personal", TODAY);
    expect(restored.cards?.request_id).toBeNull();
    expect(shouldGenerateCards(restored, TODAY)).toBe(false);
    expect(completedSteps(restored)).toEqual(completedSteps(data));
    expect(data).toEqual(before);
  });

  it("refuses malformed files and separates sample backups from personal records", () => {
    const sample = createSampleWorkspace("student", NOW, TODAY);
    expect(() => parseWorkspaceBackup("{}", "personal", TODAY)).toThrow("백업");
    expect(() => parseWorkspaceBackup("not json", "personal", TODAY)).toThrow("백업");
    expect(() => parseWorkspaceBackup(serializeWorkspaceBackup(sample, NOW), "personal", TODAY)).toThrow("샘플");
    expect(() => parseWorkspaceBackup(serializeWorkspaceBackup(workspace(), NOW), "sample", TODAY)).toThrow("샘플");
    const restored = parseWorkspaceBackup(serializeWorkspaceBackup(sample, NOW), "sample", "2026-12-01");
    expect(restored.sample).toEqual(sample.sample);
    expect(restored.cards?.generated_date).toBe("2026-12-01");
    expect(shouldGenerateCards(restored, "2026-12-01")).toBe(false);
  });

  it("validates completed archives and normal workspace data without changing the import schema", () => {
    const json = JSON.parse(serializeWorkspaceBackup(workspace(), NOW));
    json.workspace.completed_steps = [{ id: "bad", completed_at: "wrong" }];
    expect(() => parseWorkspaceBackup(JSON.stringify(json), "personal", TODAY)).toThrow("백업");
    json.workspace.completed_steps = [];
    json.workspace.topics[0].state = "other";
    expect(() => parseWorkspaceBackup(JSON.stringify(json), "personal", TODAY)).toThrow("백업");
  });
});
