import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { MAX_PASTE_BYTES, pasteBytes, prepareOnboarding } from "../lib/onboarding";
import type { OnboardingPaste } from "../lib/onboarding";

vi.mock("server-only", () => ({}));
import { loadOnboardingPrompt } from "../lib/onboarding-prompt";

const TODAY = "2026-11-12";
const project = (name: string) => `### ${name}\n- 한 줄 설명: 직접 지어낸 테스트 프로젝트\n- 종류: 개인 프로젝트\n- 진행 여부: 진행 중\n- 내가 말했던 다음 할 일: 초안 확인`;
const paste = (text: string, id = "one", source: OnboardingPaste["source"] = "other"): OnboardingPaste => ({ id, source, text });

describe("local onboarding import", () => {
  it.each(["game-developer", "student"])("prepares the fictional %s export without an LLM", (name) => {
    const text = readFileSync(new URL(`../samples/${name}.txt`, import.meta.url), "utf8");
    const result = prepareOnboarding([paste(text, "one", "chatgpt")], TODAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.data.topics).toHaveLength(7);
    expect(result.preview.data.topics.filter((topic) => topic.suggested_state === "active")).toHaveLength(4);
    expect(result.preview.data.topics.filter((topic) => topic.suggested_state === "later")).toHaveLength(2);
    expect(result.preview.data.topics.filter((topic) => topic.suggested_state === "remove")).toHaveLength(1);
    expect(result.preview.needsManualReview).toBe(false);
    expect(result.preview.data.topics.every((topic) => topic.sources[0] === "chatgpt")).toBe(true);
    expect(result.preview.data).not.toHaveProperty("quality");
  });

  it("measures the aggregate UTF-8 byte size, including whitespace", () => {
    expect(pasteBytes([paste("가"), paste("a\n ", "two")])).toBe(6);
  });

  it("accepts the exact byte limit and rejects one additional byte before parsing", () => {
    const text = project("경계값");
    const remaining = MAX_PASTE_BYTES - pasteBytes([paste(text)]);
    const atLimit = text + " ".repeat(remaining);
    expect(prepareOnboarding([paste(atLimit)], TODAY).ok).toBe(true);
    const over = prepareOnboarding([paste(atLimit), paste("a", "two")], TODAY);
    expect(over).toMatchObject({ ok: false, totalBytes: MAX_PASTE_BYTES + 1, fieldErrors: {} });
  });

  it("filters previously removed names across every paste, then assigns fresh IDs", () => {
    const removed = ["삭제한 일"];
    const inputs = [paste(`${project("삭제한 일")}\n${project("남길 일")}`), paste(project("삭제한 일"), "two", "claude")];
    const before = structuredClone(inputs);
    const result = prepareOnboarding(inputs, TODAY, removed);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.removedCount).toBe(2);
    expect(result.preview.data.topics.map((topic) => [topic.id, topic.name])).toEqual([["t1", "남길 일"]]);
    expect(inputs).toEqual(before);
    expect(removed).toEqual(["삭제한 일"]);
  });

  it("keeps duplicate projects separate and preserves each source with unique IDs", () => {
    const result = prepareOnboarding([
      paste(`## 나\n- 하는 일/역할: 첫 번째 가상 역할\n${project("같은 이름")}`, "one", "chatgpt"),
      paste(`## 나\n- 하는 일/역할: 두 번째 가상 역할\n${project("같은 이름")}`, "two", "claude"),
    ], TODAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.needsManualReview).toBe(true);
    expect(result.preview.inputCount).toBe(2);
    expect(result.preview.data.topics.map((topic) => [topic.id, topic.name, topic.sources])).toEqual([
      ["t1", "같은 이름", ["chatgpt"]], ["t2", "같은 이름", ["claude"]],
    ]);
    expect(result.preview.data.profile.roles).toEqual(["첫 번째 가상 역할"]);
  });

  it("returns a field-specific error for every blank or unreadable paste without accepting a partial import", () => {
    const result = prepareOnboarding([
      paste(project("정상")), paste("   ", "empty"),
      paste("### 형식이 다른 일\n- 설명: 바뀐 칸 이름\n- 진행 상태: 진행 중", "broken"),
    ], TODAY);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fieldErrors)).toEqual(["empty", "broken"]);
    expect(result.fieldErrors.broken).toBe("형식을 읽지 못했어요. 내보내기 프롬프트를 다시 복사해 시도해 주세요");
    expect(result).not.toHaveProperty("preview");
  });

  it("rejects an empty input list", () => {
    expect(prepareOnboarding([], TODAY)).toMatchObject({ ok: false, totalBytes: 0 });
  });

  it("allows a valid import consisting entirely of previously removed topics", () => {
    const result = prepareOnboarding([paste(project("삭제한 일"))], TODAY, ["삭제한 일"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.data.topics).toEqual([]);
    expect(result.preview.removedCount).toBe(1);
  });

  it("does not impose a total-topic or theme-count limit on imported data", () => {
    const text = Array.from({ length: 12 }, (_, index) => `## 테마: 주제 ${index}\n${project(`일 ${index}`)}`).join("\n");
    const result = prepareOnboarding([paste(text)], TODAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.data.topics).toHaveLength(12);
    expect(result.preview.data.themes).toHaveLength(12);
    expect(result.preview.data.topics.map((topic) => topic.id)).toEqual(Array.from({ length: 12 }, (_, index) => `t${index + 1}`));
  });
});

describe("canonical export prompt", () => {
  it("loads exactly the first prompt fence from the approved onboarding document", async () => {
    const original = readFileSync(new URL("../docs/onboarding_prompts.md", import.meta.url), "utf8");
    const section = original.indexOf("## ① 내보내기 프롬프트");
    const fence = original.indexOf("```", section);
    const start = original.indexOf("\n", fence) + 1;
    const end = original.indexOf("\n```", start);
    const expected = original.slice(start, end).replace(/\r$/, "");
    expect(await loadOnboardingPrompt()).toBe(expected);
  });
});
