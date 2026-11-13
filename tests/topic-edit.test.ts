import { describe, expect, it } from "vitest";
import { buildTopicCardInput, buildWorkspaceCardInput } from "../lib/card-state";
import { parseExport } from "../lib/parse";
import { loadWorkspace, saveWorkspace } from "../lib/storage";
import { editTopicField } from "../lib/topic-edit";
import { confirmOnboarding } from "../lib/workspace";

const TODAY = "2026-11-13";
const fixture = () => confirmOnboarding(parseExport(`## 테마: 가상 작업
### 가상 프로젝트
- 한 줄 설명: 편집 검증용 가상 자료
- 진행 여부: 진행 중
- 현재 상태: 초기 문장
- 내가 말했던 다음 할 일: 초기 할 일`, { today: TODAY }), {}, null, "2026-11-13T01:00:00.000Z");

describe("explicit topic field edits", () => {
  it("accepts empty status and next steps and round-trips them into both card input paths", () => {
    let data = fixture();
    data = editTopicField(data, "t1", "status_text", "  \n ");
    data = editTopicField(data, "t1", "next_steps", "\r\n \n");
    let raw = "";
    saveWorkspace({ setItem: (_key, value) => { raw = value; } }, data);
    const saved = loadWorkspace({ getItem: () => raw })!;
    for (const input of [buildTopicCardInput(saved, "t1", TODAY), buildWorkspaceCardInput(saved, TODAY)]) {
      expect(input.topics[0].status_text).toBeNull();
      expect(input.topics[0].next_steps).toEqual([]);
    }
  });

  it("keeps a missing topic from silently accepting an edit", () => {
    expect(() => editTopicField(fixture(), "missing", "status_text", "가상 변경")).toThrow("이 토픽을 찾지 못했어요");
  });
});
