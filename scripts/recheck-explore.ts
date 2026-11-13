import { config } from "dotenv";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CardInput, Nudge } from "../lib/card-types";
import { validateCards } from "../lib/cards";
import { DEFAULT_OPENAI_MODEL, generateJSON, LLMError } from "../lib/llm";
import { loadNudgePrompt } from "../lib/prompts";
import { nudgeSchema } from "../lib/schemas";

config({ path: ".env.local", quiet: true });

const BASELINE_DIR = "out/2026-11-12T03-16-00-359Z";
const PLANNED_CALLS = 6;
const PERSONAS = ["game-developer", "student"] as const;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

interface BaselineResult { input: CardInput; model: string; nudges: Nudge[] }
interface SummaryRow {
  persona: string;
  run: number;
  source_file: string;
  file: string;
  input_sha256: string;
  status: "success" | "all_discarded" | "invalid_response" | "error";
  api_calls: number;
  raw_cards: number;
  raw_explore: number;
  accepted_cards: number;
  accepted_explore: number;
  rejected: number;
  schema_pass: boolean | null;
  elapsed_ms: number;
}

function isExplore(value: unknown): boolean {
  return typeof value === "object" && value !== null && "slot" in value && value.slot === "explore";
}

async function main(): Promise<void> {
  const promptDocument = await readFile("docs/nudge_prompt.md", "utf8");
  const system = await loadNudgePrompt();
  if (!promptDocument.startsWith("# 제안 카드 생성 프롬프트 (v0.5)")
    || !system.includes("explore 후보는 아래 네 방법 중 하나로 만듭니다.")
    || !system.includes("질문의 선택지끼리 결과가 같아서는 안 됩니다.")) {
    throw new Error("승인된 v0.5 프롬프트를 확인하지 못했습니다. API를 호출하지 않았습니다.");
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new LLMError(".env.local에 OPENAI_API_KEY가 없습니다. API를 호출하지 않았습니다.", "missing_api_key");
  }
  const fixtures = await Promise.all(PERSONAS.map(async (persona) => {
    const sourceFile = `${persona}-1.json`;
    const baseline = JSON.parse(await readFile(path.join(BASELINE_DIR, sourceFile), "utf8")) as BaselineResult;
    if (!baseline.input || !Array.isArray(baseline.input.topics)
      || !Array.isArray(baseline.input.feedback) || baseline.input.feedback.length !== 0) {
      throw new Error(`${sourceFile}: 기본 통제 입력을 읽지 못했습니다. API를 호출하지 않았습니다.`);
    }
    const user = JSON.stringify(baseline.input);
    return { persona, sourceFile, baseline, user, inputHash: hash(user) };
  }));

  const outArgument = process.argv.indexOf("--out-dir");
  const outDir = outArgument < 0
    ? path.join("out", `${new Date().toISOString().replace(/[:.]/g, "-")}-v05`)
    : process.argv[outArgument + 1];
  if (!outDir || !path.resolve(outDir).startsWith(path.resolve("out") + path.sep) || !outDir.endsWith("-v05")) {
    throw new Error("출력 경로는 out/ 안의 -v05 폴더여야 합니다. API를 호출하지 않았습니다.");
  }
  await mkdir(outDir, { recursive: true });
  if ((await readdir(outDir)).some((name) => /^(game-developer|student)-\d+\.json$/.test(name))) {
    throw new Error("이 폴더에는 이미 API 결과가 있습니다. 중복 호출하지 않았습니다.");
  }
  const model = process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
  const promptHash = hash(system);
  const schemaHash = hash(JSON.stringify(nudgeSchema));
  const rows: SummaryRow[] = [];
  let apiCalls = 0;
  console.log(`결과: ${outDir}`);
  console.log(`직접 호출 상한 ${PLANNED_CALLS}; 자동 재시도 0; 모델 ${model}`);

  async function writeSummary(): Promise<void> {
    const frequency = PERSONAS.map((persona) => {
      const own = rows.filter((row) => row.persona === persona);
      return {
        persona, planned_runs: 3, attempted_runs: own.length,
        runs_with_raw_explore: own.filter((row) => row.raw_explore > 0).length,
        runs_with_accepted_explore: own.filter((row) => row.accepted_explore > 0).length,
        accepted_cards: own.reduce((sum, row) => sum + row.accepted_cards, 0),
        accepted_explore: own.reduce((sum, row) => sum + row.accepted_explore, 0),
      };
    });
    await writeFile(path.join(outDir, "summary.json"), JSON.stringify({
      prompt_version: "0.5", prompt_sha256: promptHash, schema_sha256: schemaHash,
      model, baseline_dir: BASELINE_DIR, planned_calls: PLANNED_CALLS,
      api_calls: apiCalls, retries: 0, completed_runs: rows.length,
      input_control: "각 persona-1.json의 input을 변경 없이 각 3회 재사용",
      frequency, rows,
    }, null, 2) + "\n");
    const table = [
      "| 페르소나 | 회차 | 결과 | raw 카드/explore | accepted 카드/explore | 스키마 | 탈락 | 호출 |",
      "|---|---:|---|---:|---:|---|---:|---:|",
      ...rows.map((row) => `| ${row.persona} | ${row.run} | ${row.status} | ${row.raw_cards}/${row.raw_explore} | ${row.accepted_cards}/${row.accepted_explore} | ${row.schema_pass === null ? "미검증" : row.schema_pass ? "통과" : "실패"} | ${row.rejected} | ${row.api_calls} |`),
    ].join("\n");
    const frequencies = frequency.map((row) => `- ${row.persona}: explore 발생 ${row.runs_with_accepted_explore}/${row.attempted_runs}, explore 총 ${row.accepted_explore}장`).join("\n");
    await writeFile(path.join(outDir, "summary.md"), `# v0.5 explore 제한 검증\n\n모델: ${model}. 실제 직접 호출 ${apiCalls}/${PLANNED_CALLS}, 자동 재시도 0회.\n\n기본 입력 두 개를 각각 그대로 3회 사용했습니다. 피드백 입력은 없습니다. 방법 분류 및 next_steps·blockers 중복 여부는 별도 수동 리뷰합니다.\n\n${table}\n\n${frequencies}\n`);
  }

  await writeSummary();
  for (const fixture of fixtures) {
    for (let run = 1; run <= 3; run += 1) {
      if (apiCalls >= PLANNED_CALLS) throw new Error("API 호출 상한을 넘을 수 없습니다.");
      const file = `${fixture.persona}-${run}.json`;
      const startedAt = Date.now();
      console.log(`${apiCalls + 1}/${PLANNED_CALLS}: ${fixture.persona} ${run}/3 호출 중`);
      apiCalls += 1;
      try {
        // Deliberately bypass generateCards: this experiment never retries.
        const response = await generateJSON({ system, user: fixture.user, schema: nudgeSchema });
        const validation = validateCards(response, fixture.baseline.input);
        const raw: unknown[] = "nudges" in response && Array.isArray(response.nudges) ? response.nudges : [];
        const status = validation.nudges.length > 0 || (validation.schemaValid && raw.length === 0)
          ? "success" : validation.shouldRetry ? "all_discarded" : "invalid_response";
        const row: SummaryRow = {
          persona: fixture.persona, run, source_file: fixture.sourceFile, file,
          input_sha256: fixture.inputHash, status, api_calls: 1,
          raw_cards: raw.length, raw_explore: raw.filter(isExplore).length,
          accepted_cards: validation.nudges.length,
          accepted_explore: validation.nudges.filter((card) => card.slot === "explore").length,
          rejected: validation.rejected.length, schema_pass: validation.schemaValid,
          elapsed_ms: Date.now() - startedAt,
        };
        rows.push(row);
        await writeFile(path.join(outDir, file), JSON.stringify({
          prompt_version: "0.5", prompt_sha256: promptHash, schema_sha256: schemaHash,
          model, baseline_model: fixture.baseline.model,
          baseline_file: path.join(BASELINE_DIR, fixture.sourceFile),
          input_sha256: fixture.inputHash, input: fixture.baseline.input,
          persona: fixture.persona, run, api_calls: 1, retries: 0,
          status, elapsed_ms: row.elapsed_ms, response, validation,
        }, null, 2) + "\n");
        await writeSummary();
        console.log(`${fixture.persona} ${run}/3: ${status}, raw ${row.raw_cards}, accepted ${row.accepted_cards}, explore ${row.accepted_explore}`);
      } catch (error) {
        const detail = error instanceof LLMError
          ? { code: error.code, status: error.status, parameter: error.parameter, message: error.message }
          : { code: "unexpected_error", message: "검증 실행 중 오류가 발생했습니다." };
        rows.push({
          persona: fixture.persona, run, source_file: fixture.sourceFile, file,
          input_sha256: fixture.inputHash, status: "error", api_calls: 1,
          raw_cards: 0, raw_explore: 0, accepted_cards: 0, accepted_explore: 0,
          rejected: 0, schema_pass: null, elapsed_ms: Date.now() - startedAt,
        });
        await writeFile(path.join(outDir, file), JSON.stringify({
          prompt_version: "0.5", prompt_sha256: promptHash, model,
          baseline_file: path.join(BASELINE_DIR, fixture.sourceFile), input_sha256: fixture.inputHash,
          input: fixture.baseline.input, persona: fixture.persona, run,
          api_calls: 1, retries: 0, status: "error", error: detail,
        }, null, 2) + "\n");
        await writeSummary();
        throw error;
      }
    }
  }
  await writeSummary();
  console.log(`완료: 실제 API ${apiCalls}회, 재시도 0회. ${outDir}`);
}

main().catch((error: unknown) => {
  if (error instanceof LLMError) console.error(`${error.code}${error.status ? ` (HTTP ${error.status})` : ""}: ${error.message}`);
  else console.error(error instanceof Error ? error.message : "검증에 실패했습니다.");
  process.exitCode = 1;
});
