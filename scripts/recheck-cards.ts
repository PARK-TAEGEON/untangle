import { config } from "dotenv";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CardInput, CardValidationResult, Nudge } from "../lib/card-types";
import { validateCards } from "../lib/cards";
import { DEFAULT_OPENAI_MODEL, generateJSON, LLMError } from "../lib/llm";
import { loadNudgePrompt } from "../lib/prompts";
import { nudgeSchema } from "../lib/schemas";

config({ path: ".env.local", quiet: true });

const BASELINE_DIR = "out/2026-11-12T03-16-00-359Z";
const PLANNED_CALLS = 4;
const PAIRS = [
  { persona: "game-developer", run: 1, scenario: "baseline" },
  { persona: "game-developer", run: 5, scenario: "completed" },
  { persona: "student", run: 1, scenario: "baseline" },
  { persona: "student", run: 5, scenario: "completed" },
] as const;

interface BaselineResult {
  input: CardInput;
  model: string;
  nudges: Nudge[];
  attempts: Array<{ response: { nudges: Nudge[] }; validation: CardValidationResult }>;
}

interface SummaryRow {
  persona: string;
  scenario: string;
  source_file: string;
  result_file: string;
  input_sha256: string;
  status: "success" | "all_discarded" | "invalid_response" | "error";
  api_calls: number;
  baseline_cards: number;
  baseline_explore: number;
  raw_cards: number;
  raw_explore: number;
  accepted_cards: number;
  accepted_explore: number;
  rejected: number;
  schema_pass: boolean | null;
  elapsed_ms: number;
}

async function main(): Promise<void> {
  // This standalone experiment must never use generateCards (which may retry).
  const system = await loadNudgePrompt();
  if (!system.includes("completed는 피드백의 action 범위만 끝났다는 뜻입니다.")) {
    throw new Error("승인된 v0.4 시스템 프롬프트를 확인하지 못했습니다. API를 호출하지 않았습니다.");
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new LLMError(".env.local에 OPENAI_API_KEY가 없습니다. API를 호출하지 않았습니다.", "missing_api_key");
  }

  // Load all four exact inputs before spending the first API call.
  const pairs = await Promise.all(PAIRS.map(async (pair) => {
    const sourceFile = `${pair.persona}-${pair.run}.json`;
    const baseline = JSON.parse(await readFile(path.join(BASELINE_DIR, sourceFile), "utf8")) as BaselineResult;
    if (!baseline.input || !Array.isArray(baseline.input.topics) || !Array.isArray(baseline.input.feedback)) {
      throw new Error(`${sourceFile}: 기존 입력을 읽지 못했습니다. API를 호출하지 않았습니다.`);
    }
    if (pair.scenario === "completed" && !baseline.input.feedback.some((item) => item.result === "completed")) {
      throw new Error(`${sourceFile}: completed 통제 입력이 없습니다. API를 호출하지 않았습니다.`);
    }
    const user = JSON.stringify(baseline.input);
    return { ...pair, sourceFile, baseline, user, inputHash: createHash("sha256").update(user).digest("hex") };
  }));

  const outDir = path.join("out", `${new Date().toISOString().replace(/[:.]/g, "-")}-v04`);
  await mkdir(outDir, { recursive: true });
  const model = process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
  const promptHash = createHash("sha256").update(system).digest("hex");
  const rows: SummaryRow[] = [];
  let apiCalls = 0;
  console.log(`결과: ${outDir}`);
  console.log(`직접 호출 상한: ${PLANNED_CALLS}; 자동 재시도 없음; 모델: ${model}`);

  async function writeSummary(): Promise<void> {
    await writeFile(path.join(outDir, "summary.json"), JSON.stringify({
      prompt_version: "0.4", prompt_sha256: promptHash, model,
      baseline_dir: BASELINE_DIR, planned_calls: PLANNED_CALLS,
      api_calls: apiCalls, completed_pairs: rows.length,
      input_control: "각 baseline 결과 파일의 input을 변경 없이 그대로 재사용",
      retries: 0, rows,
    }, null, 2) + "\n");
    const table = [
      "| 페르소나 | 입력 | 결과 | 이전 카드/explore | 새 raw 카드/explore | 새 accepted 카드/explore | 스키마 | 탈락 | 호출 |",
      "|---|---|---|---:|---:|---:|---|---:|---:|",
      ...rows.map((row) => `| ${row.persona} | ${row.scenario} | ${row.status} | ${row.baseline_cards}/${row.baseline_explore} | ${row.raw_cards}/${row.raw_explore} | ${row.accepted_cards}/${row.accepted_explore} | ${row.schema_pass === null ? "미검증" : row.schema_pass ? "통과" : "실패"} | ${row.rejected} | ${row.api_calls} |`),
    ].join("\n");
    await writeFile(path.join(outDir, "summary.md"), `# v0.4 제한 재검증\n\n모델: ${model}. 직접 호출 ${apiCalls}/${PLANNED_CALLS}, 자동 재시도 0회.\n\n기존 실행의 각 페르소나 1회차와 5회차(completed)의 input을 그대로 재사용했습니다. 카드 내용은 수동 품질 리뷰 대상이며 전체 이전 실험과 비율을 직접 비교하지 않습니다.\n\n${table}\n`);
  }

  for (const pair of pairs) {
    if (apiCalls >= PLANNED_CALLS) throw new Error("직접 호출 상한을 넘을 수 없습니다.");
    const resultFile = `${pair.persona}-${pair.scenario}.json`;
    const startedAt = Date.now();
    console.log(`${apiCalls + 1}/${PLANNED_CALLS}: ${pair.persona} ${pair.scenario} 호출 중`);
    apiCalls += 1;
    try {
      const response = await generateJSON({ system, user: pair.user, schema: nudgeSchema });
      const validation = validateCards(response, pair.baseline.input);
      const rawNudges = "nudges" in response && Array.isArray(response.nudges) ? response.nudges as Nudge[] : [];
      const status = validation.nudges.length > 0 || (validation.schemaValid && rawNudges.length === 0)
        ? "success" : validation.shouldRetry ? "all_discarded" : "invalid_response";
      const row: SummaryRow = {
        persona: pair.persona, scenario: pair.scenario, source_file: pair.sourceFile,
        result_file: resultFile, input_sha256: pair.inputHash, status, api_calls: 1,
        baseline_cards: pair.baseline.nudges.length,
        baseline_explore: pair.baseline.nudges.filter((card) => card.slot === "explore").length,
        raw_cards: rawNudges.length, raw_explore: rawNudges.filter((card) => card.slot === "explore").length,
        accepted_cards: validation.nudges.length,
        accepted_explore: validation.nudges.filter((card) => card.slot === "explore").length,
        rejected: validation.rejected.length, schema_pass: validation.schemaValid, elapsed_ms: Date.now() - startedAt,
      };
      rows.push(row);
      await writeFile(path.join(outDir, resultFile), JSON.stringify({
        prompt_version: "0.4", prompt_sha256: promptHash, model,
        baseline_file: path.join(BASELINE_DIR, pair.sourceFile), baseline_model: pair.baseline.model,
        input_sha256: pair.inputHash, input: pair.baseline.input,
        persona: pair.persona, scenario: pair.scenario, elapsed_ms: row.elapsed_ms,
        api_calls: 1, retries: 0, status, response, validation,
      }, null, 2) + "\n");
      await writeSummary();
      console.log(`${pair.persona} ${pair.scenario}: ${status}, raw ${row.raw_cards}, accepted ${row.accepted_cards}, explore ${row.accepted_explore}`);
    } catch (error) {
      const detail = error instanceof LLMError
        ? { code: error.code, status: error.status, parameter: error.parameter, message: error.message }
        : { code: "unexpected_error", message: "재검증 실행 중 오류가 발생했습니다." };
      rows.push({
        persona: pair.persona, scenario: pair.scenario, source_file: pair.sourceFile,
        result_file: resultFile, input_sha256: pair.inputHash, status: "error", api_calls: 1,
        baseline_cards: pair.baseline.nudges.length,
        baseline_explore: pair.baseline.nudges.filter((card) => card.slot === "explore").length,
        raw_cards: 0, raw_explore: 0, accepted_cards: 0, accepted_explore: 0,
        rejected: 0, schema_pass: null, elapsed_ms: Date.now() - startedAt,
      });
      await writeFile(path.join(outDir, resultFile), JSON.stringify({
        prompt_version: "0.4", prompt_sha256: promptHash, model,
        baseline_file: path.join(BASELINE_DIR, pair.sourceFile), input_sha256: pair.inputHash,
        input: pair.baseline.input, persona: pair.persona, scenario: pair.scenario,
        api_calls: 1, retries: 0, status: "error", error: detail,
      }, null, 2) + "\n");
      await writeSummary();
      throw error;
    }
  }
  await writeSummary();
  console.table(rows);
  console.log(`완료: ${outDir}`);
}

main().catch((error: unknown) => {
  if (error instanceof LLMError) console.error(`${error.code}${error.status ? ` (HTTP ${error.status})` : ""}: ${error.message}`);
  else console.error(error instanceof Error ? error.message : "재검증에 실패했습니다.");
  process.exitCode = 1;
});
