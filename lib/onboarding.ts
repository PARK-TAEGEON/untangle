import { parseExport } from "./parse";
import { exportDataFromParse, validateExportData } from "./schemas";
import type { ExportData, Source } from "./types";

export const MAX_PASTE_BYTES = 200 * 1024;

export interface OnboardingPaste {
  id: string;
  source: Source;
  text: string;
}

export interface OnboardingPreview {
  data: ExportData;
  removedCount: number;
  inputCount: number;
  totalBytes: number;
  needsManualReview: boolean;
}

export type OnboardingResult =
  | { ok: true; preview: OnboardingPreview }
  | { ok: false; message: string; fieldErrors: Record<string, string>; totalBytes: number };

export function pasteBytes(pastes: readonly Pick<OnboardingPaste, "text">[]): number {
  const encoder = new TextEncoder();
  return pastes.reduce((total, paste) => total + encoder.encode(paste.text).byteLength, 0);
}

/** Parse locally and keep separate entries available for manual review. */
export function prepareOnboarding(
  pastes: readonly OnboardingPaste[],
  today: string,
  removedNames: readonly string[] = [],
): OnboardingResult {
  const totalBytes = pasteBytes(pastes);
  if (totalBytes > MAX_PASTE_BYTES) {
    return {
      ok: false,
      message: "붙여넣은 내용을 합해 200KB 이내로 줄여 주세요.",
      fieldErrors: {},
      totalBytes,
    };
  }
  if (pastes.length === 0) {
    return { ok: false, message: "AI에서 받은 결과를 하나 이상 붙여넣어 주세요.", fieldErrors: {}, totalBytes };
  }

  const fieldErrors: Record<string, string> = {};
  const parsedInputs: ExportData[] = [];
  for (const paste of pastes) {
    if (!paste.text.trim()) {
      fieldErrors[paste.id] = "AI에서 받은 결과를 붙여넣어 주세요. 쓰지 않는 입력 칸은 제거할 수 있어요.";
      continue;
    }
    const parsed = parseExport(paste.text, { source: paste.source, today });
    const data = exportDataFromParse(parsed);
    if (!parsed.quality.ok || !validateExportData(data)) {
      fieldErrors[paste.id] = "형식을 읽지 못했어요. 내보내기 프롬프트를 다시 복사해 시도해 주세요";
      continue;
    }
    parsedInputs.push(data);
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, message: "표시된 입력 칸을 확인해 주세요.", fieldErrors, totalBytes };
  }

  const removed = new Set(removedNames);
  const importedTopics = parsedInputs.flatMap((data) => data.topics);
  const topics = importedTopics
    .filter((topic) => !removed.has(topic.name))
    .map((topic, index) => ({ ...topic, id: `t${index + 1}` }));
  return {
    ok: true,
    preview: {
      data: {
        // Do not infer a combined profile without the specified merging workflow.
        profile: parsedInputs[0].profile,
        themes: [...new Set(parsedInputs.flatMap((data) => data.themes))],
        topics,
      },
      removedCount: importedTopics.length - topics.length,
      inputCount: pastes.length,
      totalBytes,
      needsManualReview: pastes.length > 1,
    },
  };
}
