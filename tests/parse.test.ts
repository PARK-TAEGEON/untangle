import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { classify, parseDeadline, parseExport } from "../lib/parse";
import type { DeadlineResult } from "../lib/parse";
import type { ParseOptions, ParseResult, Topic } from "../lib/types";

const TODAY = "2026-11-12";
interface ReferenceParser {
  parseExport(text: string, options?: ParseOptions): ParseResult;
  parseDeadline(raw: string, today: string): DeadlineResult;
  classify(topics: Topic[]): void;
}
// A VM keeps the approved CommonJS reference unchanged even in an ESM project.
const referenceModule = { exports: {} as ReferenceParser };
runInNewContext(readFileSync(new URL("../docs/parse_export.js", import.meta.url), "utf8"), {
  module: referenceModule,
  require: createRequire(import.meta.url),
});
const reference = referenceModule.exports;
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const projectText = (name: string, extra = "", progress = "진행 중") => `### ${name}
- 한 줄 설명: ${name}의 가상 프로젝트
- 종류: 개인 프로젝트
- 진행 여부: ${progress}
${extra}`;

function topic(name: string, overrides: Partial<Topic> = {}): Topic {
  return {
    ...parseExport(projectText(name), { today: TODAY }).topics[0],
    next_steps: ["테스트 입력 확인"],
    ...overrides,
  };
}

describe("parseExport", () => {
  it.each(["game-developer", "student"])("parses the fictional %s sample identically to the reference", (name) => {
    const text = readFileSync(new URL(`../samples/${name}.txt`, import.meta.url), "utf8");
    const result = parseExport(text, { source: "chatgpt", today: TODAY });
    expect(result).toEqual(plain(reference.parseExport(text, { source: "chatgpt", today: TODAY })));
    expect(result.quality.ok).toBe(true);
    expect(result.quality.projects).toBeGreaterThan(0);
    expect(result.quality.recognized).toBe(result.topics.length);
    expect(result.topics.every((t) => t.sources[0] === "chatgpt")).toBe(true);
    expect(result.topics.map((t) => t.id)).toEqual(result.topics.map((_, i) => `t${i + 1}`));
    expect(result.topics.some((t) => "_i" in t)).toBe(false);
  });

  it("returns an empty unsuccessful parse for empty text", () => {
    const result = parseExport("", { today: TODAY });
    expect(result).toEqual(plain(reference.parseExport("", { today: TODAY })));
    expect(result.quality).toEqual({ ok: false, projects: 0, recognized: 0, ratio: 0 });
    expect(result.themes).toEqual([]);
    expect(result.topics).toEqual([]);
  });

  it("marks changed field names as unrecognized without inventing values", () => {
    const text = "## 테마: 실험\n### 형식이 다른 항목\n- 설명: 가상 실험\n- 진행 상태: 진행 중";
    const result = parseExport(text, { today: TODAY });
    expect(result).toEqual(plain(reference.parseExport(text, { today: TODAY })));
    expect(result.quality).toEqual({ ok: false, projects: 1, recognized: 0, ratio: 0 });
    expect(result.topics[0]).toMatchObject({ one_liner: "", progress: "unknown", suggested_state: "later" });
  });

  it("uses the category as a theme when theme headings are absent", () => {
    const text = `${projectText("포트폴리오").replace("개인 프로젝트", "지원·커리어")}\n${projectText("학교 팀플").replace("개인 프로젝트", "학교")}`;
    const result = parseExport(text, { source: "claude", today: TODAY });
    expect(result).toEqual(plain(reference.parseExport(text, { source: "claude", today: TODAY })));
    expect(result.quality.ok).toBe(true);
    expect(result.themes).toEqual(["지원·진로", "학교"]);
    expect(result.topics.map((t) => t.theme)).toEqual(["지원·진로", "학교"]);
  });

  it("accepts exactly 80 percent recognized projects and rejects less", () => {
    const good = Array.from({ length: 4 }, (_, i) => projectText(`정상 ${i}`));
    const broken = "### 칸이 다른 항목\n- 설명: 설명만 있음";
    for (const [text, expected] of [
      [[...good, broken].join("\n"), { ok: true, projects: 5, recognized: 4, ratio: 0.8 }],
      [[...good.slice(0, 3), broken].join("\n"), { ok: false, projects: 4, recognized: 3, ratio: 0.75 }],
    ] as const) {
      const result = parseExport(text, { today: TODAY });
      expect(result).toEqual(plain(reference.parseExport(text, { today: TODAY })));
      expect(result.quality).toEqual(expected);
    }
  });

  it("preserves continuation lines, aliases and unknown list filtering", () => {
    const text = `## 나
- 하는 일/역할: 가상 개발자, 팀원
- 요즘 가장 시간을 쓰는 일:
  1. 구현 실험
  2. 발표 준비
- 내가 선호한다고 말한 작업 방식: 모름
## 테마： 실험
### 테스트\\_도구 ← 원래 항목
- 한 줄 설명: 결과를&#x20;확인하는 도구
- 종류: 개인 프로젝트.
- 진행 여부: 진행 중.
- 마지막으로 다룬 시기: 최근 2주.
- 현재 상태: 첫 설명
  다음 줄 설명
- 마지막 상태: 무시할 별칭
- 지금까지 만든 것:
  1. 모름
  2. 검토 여부는 모름
  3. 테스트 코드
     이어진 코드 설명
  4. 참고 문서
- 해보려던 것:
  - 경계값 확인
  - 스냅샷 점검
- 함께하는 사람: 혼자.
- 관련 대화 주제: 파싱, 날짜, 테스트, 초안, 목록, 여섯 번째`;
    const result = parseExport(text, { today: TODAY });
    expect(result).toEqual(plain(reference.parseExport(text, { today: TODAY })));
    expect(result.profile).toMatchObject({ current_focus: ["구현 실험", "발표 준비"], work_style: null });
    expect(result.topics[0]).toMatchObject({
      name: "테스트_도구",
      one_liner: "결과를 확인하는 도구",
      status_text: "첫 설명 다음 줄 설명",
      outputs: ["테스트 코드 이어진 코드 설명", "참고 문서"],
      next_steps: ["경계값 확인", "스냅샷 점검"],
      collaborators: [],
      related: ["파싱", "날짜", "테스트", "초안", "목록"],
      suggested_state: "active",
    });
  });

  it("keeps all topics and permits more than eight or fewer than four themes", () => {
    const text = Array.from({ length: 12 }, (_, i) => `## 테마: 테마 ${i}\n${projectText(`토픽 ${i}`, "- 내가 말했던 다음 할 일: 코드 검토")}`).join("\n");
    const result = parseExport(text, { today: TODAY });
    expect(result).toEqual(plain(reference.parseExport(text, { today: TODAY })));
    expect(result.topics).toHaveLength(12);
    expect(result.themes).toHaveLength(12);
    expect(result.topics.filter((t) => t.suggested_state === "active")).toHaveLength(9);
    expect(parseExport(`## 테마: 하나\n${projectText("한 토픽")}`, { today: TODAY }).themes).toEqual(["하나"]);
  });

  it("orders themes by active count, then topics by state and deadline", () => {
    const text = `## 테마: 원문 첫 테마
${projectText("끝난 작업", "", "끝남")}
${projectText("나중 작업", "", "멈춤")}
## 테마: 활성 테마
${projectText("먼 마감", "- 마감: 2026-11-20 (시연)")}
${projectText("가까운 마감", "- 마감: 2026-11-13 (검토)")}`;
    const result = parseExport(text, { today: TODAY });
    expect(result).toEqual(plain(reference.parseExport(text, { today: TODAY })));
    expect(result.themes).toEqual(["활성 테마", "원문 첫 테마"]);
    expect(result.topics.map((t) => t.name)).toEqual(["가까운 마감", "먼 마감", "나중 작업", "끝난 작업"]);
  });
});

describe("parseDeadline", () => {
  it.each([
    ["", { deadline: null, label: null, text: null }],
    ["모름.", { deadline: null, label: null, text: null }],
    ["2주 뒤", { deadline: null, label: null, text: "2주 뒤" }],
    ["매주 월요일", { deadline: null, label: null, text: "매주 월요일" }],
    ["2026-11-11 (제출)", { deadline: null, label: null, text: "2026-11-11 (제출)" }],
    ["2026-02-31", { deadline: null, label: null, text: "2026-02-31" }],
    ["2027-02-29", { deadline: null, label: null, text: "2027-02-29" }],
    ["2028년 2월 29일 (완료)", { deadline: "2028-02-29", label: "완료", text: null }],
    ["2026-11-12 (오늘 제출)", { deadline: TODAY, label: "오늘 제출", text: null }],
    ["2026년 11월 15일（시연）", { deadline: "2026-11-15", label: "시연", text: null }],
    ["제출 2026-11-15", { deadline: "2026-11-15", label: "제출", text: null }],
    ["2026-11-15", { deadline: "2026-11-15", label: null, text: null }],
    ["2026-12-01(배포), 2026년 11월 15일 (시연)", { deadline: "2026-11-15", label: "시연", text: "2026-12-01(배포), 2026년 11월 15일 (시연)" }],
    ["마감에 대해 아직 확인할 내용이 많이 남아 있습니다 2026-11-15", { deadline: "2026-11-15", label: null, text: "마감에 대해 아직 확인할 내용이 많이 남아 있습니다 2026-11-15" }],
  ] satisfies [string, DeadlineResult][])("preserves the reference deadline rule for %s", (raw, expected) => {
    expect(parseDeadline(raw, TODAY)).toEqual(expected);
    expect(parseDeadline(raw, TODAY)).toEqual(plain(reference.parseDeadline(raw, TODAY)));
  });
});

describe("classify", () => {
  it("only activates work in progress with a deadline or a next step, and only removes done work", () => {
    const topics = [
      topic("완료", { progress: "done", deadline: "2026-11-15" }),
      topic("멈춤", { progress: "stalled", deadline: "2026-11-15" }),
      topic("아이디어", { progress: "idea_only" }),
      topic("모름", { progress: "unknown" }),
      topic("할 일 없음", { next_steps: [] }),
      topic("다음 일 있음"),
      topic("마감 있음", { next_steps: [], deadline: "2026-11-15", deadline_label: "시연" }),
    ];
    const original = structuredClone(topics);
    classify(topics);
    reference.classify(original);
    expect(topics).toEqual(plain(original));
    expect(topics.map((t) => [t.suggested_state, t.suggested_reason])).toEqual([
      ["remove", "끝난 일"],
      ["later", "멈춘 상태"],
      ["later", "아이디어 단계"],
      ["later", "진행 여부를 알 수 없음"],
      ["later", "다음 할 일이 정해지지 않음"],
      ["active", "진행 중, 다음 할 일 있음"],
      ["active", "11월 15일 시연"],
    ]);
  });

  it("keeps nine active topics by deadline, recency and original order without deleting topics", () => {
    const topics = [
      topic("첫 오래된 작업", { last_touched: "older" }),
      topic("가까운 마감", { deadline: "2026-11-13", last_touched: "unknown" }),
      topic("최근 작업 1", { last_touched: "recent_2w" }),
      topic("먼 마감", { deadline: "2026-12-01", last_touched: "older" }),
      topic("최근 작업 2", { last_touched: "recent_2w" }),
      topic("최근 작업 3", { last_touched: "recent_2w" }),
      topic("최근 작업 4", { last_touched: "recent_2w" }),
      topic("최근 작업 5", { last_touched: "recent_2w" }),
      topic("최근 작업 6", { last_touched: "recent_2w" }),
      topic("최근 작업 7", { last_touched: "recent_2w" }),
      topic("최근 작업 8", { last_touched: "recent_2w" }),
      topic("한 달 작업", { last_touched: "recent_1m" }),
    ];
    const original = structuredClone(topics);
    classify(topics);
    reference.classify(original);
    expect(topics).toEqual(plain(original));
    expect(topics).toHaveLength(12);
    expect(topics.filter((t) => t.suggested_state === "active").map((t) => t.name)).toEqual([
      "가까운 마감", "최근 작업 1", "먼 마감", "최근 작업 2", "최근 작업 3", "최근 작업 4", "최근 작업 5", "최근 작업 6", "최근 작업 7",
    ]);
    expect(topics.filter((t) => t.suggested_state === "later").every((t) => t.suggested_reason === "활성 9개를 넘어 나중으로 조정")).toBe(true);
  });

  it("leaves exactly nine active topics active and is stable when rerun", () => {
    const topics = Array.from({ length: 9 }, (_, i) => topic(`작업 ${i}`));
    classify(topics);
    expect(topics.every((t) => t.suggested_state === "active")).toBe(true);
    const first = structuredClone(topics);
    classify(topics);
    expect(topics).toEqual(first);
  });
});
