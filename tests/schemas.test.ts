import { describe, expect, it } from "vitest";
import { parseExport } from "../lib/parse";
import { exportDataFromParse, validateExportData } from "../lib/schemas";

describe("canonical topic schema", () => {
  it("validates only profile, themes and topics, excluding quality", () => {
    const result = parseExport("### 과제\n- 한 줄 설명: 실험 보고서\n- 종류: 학교\n- 진행 여부: 진행 중", { today: "2026-11-12" });
    expect(validateExportData(result)).toBe(false);
    expect(validateExportData(exportDataFromParse(result))).toBe(true);
    expect(result.quality.ok).toBe(true);
    expect(result.themes).toHaveLength(1);
  });

  it("does not impose a total topic count limit", () => {
    const text = Array.from({ length: 12 }, (_, i) => `### 과제 ${i}\n- 한 줄 설명: 실험\n- 종류: 학교\n- 진행 여부: 진행 중\n- 내가 말했던 다음 할 일: 보고서 검토`).join("\n");
    const result = parseExport(text, { today: "2026-11-12" });
    expect(result.topics).toHaveLength(12);
    expect(validateExportData(exportDataFromParse(result))).toBe(true);
  });
});
