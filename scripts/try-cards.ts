import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildCardInput } from "../lib/cards";
import { CardGenerationError, generateCards } from "../lib/card-generation";
import { DEFAULT_OPENAI_MODEL, LLMError } from "../lib/llm";
import { parseExport } from "../lib/parse";
import { loadNudgePrompt } from "../lib/prompts";
import { exportDataFromParse, validateExportData } from "../lib/schemas";
import type { CardFeedback, Nudge } from "../lib/card-types";

config({ path: ".env.local", quiet: true });

interface SummaryRow {
  persona: string;
  run: number;
  scenario: string;
  status: string;
  schema_pass: boolean | null;
  cards: number;
  explore: number;
  api_calls: number;
  rejected: number;
  file: string;
}

function getToday(): string {
  const index = process.argv.indexOf("--today");
  const value = index >= 0 ? process.argv[index + 1] :
    new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new Error("--today에는 YYYY-MM-DD 형식의 실제 날짜를 넣어 주세요.");
  }
  return value;
}

async function main(): Promise<void> {
  const today = getToday();
  const dryRun = process.argv.includes("--dry-run");
  const model = process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
  const personas = ["game-developer", "student"];
  const fixtures = await Promise.all(personas.map(async (persona) => {
    const text = await readFile(path.join("samples", `${persona}.txt`), "utf8");
    const parsed = parseExport(text, { source: "other", today });
    const data = exportDataFromParse(parsed);
    if (!parsed.quality.ok || !validateExportData(data)) {
      throw new Error(`${persona}: 샘플 파싱/스키마 검증에 실패했습니다.`);
    }
    return { persona, data, quality: parsed.quality };
  }));

  if (!dryRun && !process.env.OPENAI_API_KEY?.trim()) {
    throw new LLMError(".env.local에 OPENAI_API_KEY를 설정해 주세요. 실제 API 검증은 실행되지 않았습니다.", "missing_api_key");
  }

  const runId = new Date().toISOString().replace(/[:.]/g, "-") + (dryRun ? "-dry-run" : "");
  const outDir = path.join("out", runId);
  await mkdir(outDir, { recursive: true });
  const system = await loadNudgePrompt();
  const rows: SummaryRow[] = [];

  async function writeSummary(display = false): Promise<void> {
    const report = { today, model, dryRun, planned_runs: 10, completed_runs: rows.length, rows };
    await writeFile(path.join(outDir, "summary.json"), JSON.stringify(report, null, 2) + "\n");
    const table = [
      "| 페르소나 | 회차 | 시나리오 | 결과 | 스키마 | 카드 | explore | 호출 | 탈락 |",
      "|---|---:|---|---|---|---:|---:|---:|---:|",
      ...rows.map((r) => `| ${r.persona} | ${r.run} | ${r.scenario} | ${r.status} | ${r.schema_pass === null ? "미검증" : r.schema_pass ? "통과" : "실패"} | ${r.cards} | ${r.explore} | ${r.api_calls} | ${r.rejected} |`),
    ].join("\n");
    await writeFile(path.join(outDir, "summary.md"),
      `# 카드 품질 확인\n\n날짜: ${today}, 모델: ${model}\n\n${dryRun ? "로컬 입력 확인만 실행했습니다. 실제 API 결과가 아닙니다." : "가상 페르소나만 사용했습니다. 세 번의 기본 호출 뒤 이전 카드로 dismissed/completed 피드백을 확인합니다."}\n\n${table}\n\n문장 품질은 docs/nudge_prompt.md ④ 체크리스트로 별도 검토합니다. 프롬프트와 스키마는 수정하지 않습니다.\n`);
    if (display) {
      console.table(rows.map(({ file: _file, ...row }) => row));
      console.log(`결과: ${outDir}`);
    }
  }

  for (const { persona, data, quality } of fixtures) {
    if (dryRun) {
      const input = buildCardInput(data, today);
      await writeFile(path.join(outDir, `${persona}-input.json`), JSON.stringify({ quality, input }, null, 2) + "\n");
      console.log(`${persona}: 파싱 품질 통과, 전체 토픽 ${data.topics.length}, 카드 입력 ${input.topics.length}`);
      continue;
    }

    let baseline: Nudge | undefined;
    for (let run = 1; run <= 5; run++) {
      const requestedScenario = run === 4 ? "dismissed" : run === 5 ? "completed" : "baseline";
      const scenario = requestedScenario !== "baseline" && !baseline ? "feedback_unavailable" : requestedScenario;
      const feedback: CardFeedback[] = baseline && (requestedScenario === "dismissed" || requestedScenario === "completed") ? [{
        topic_id: baseline.topic_id, type: baseline.type, title: baseline.title,
        action: baseline.action, result: requestedScenario, note: null,
      }] : [];
      const input = buildCardInput(data, today, { feedback });
      const file = `${persona}-${run}.json`;
      console.log(`${persona} ${run}/5: ${scenario} 호출 중`);
      const startedAt = Date.now();
      try {
        const result = await generateCards(input, system);
        const last = result.attempts.at(-1)!;
        const row: SummaryRow = {
          persona, run, scenario, status: result.status,
          schema_pass: result.attempts.every((a) => a.validation.schemaValid),
          cards: result.nudges.length, explore: result.nudges.filter((n) => n.slot === "explore").length,
          api_calls: result.attempts.length,
          rejected: result.attempts.reduce((sum, a) => sum + a.validation.rejected.length, 0), file,
        };
        rows.push(row);
        await writeFile(path.join(outDir, file), JSON.stringify({
          today, model, persona, scenario, requested_scenario: requestedScenario,
          input, elapsed_ms: Date.now() - startedAt, ...result,
        }, null, 2) + "\n");
        if (run <= 3 && (!baseline || baseline.type !== "continue")) {
          baseline = last.validation.nudges.find((n) => n.type === "continue") || baseline ||
            last.validation.nudges.find((n) => n.type !== "new_project");
        }
        await writeSummary();
      } catch (error) {
        const cause = error instanceof CardGenerationError ? error.cause : error;
        const attempts = error instanceof CardGenerationError ? error.attempts : [];
        const detail = cause instanceof LLMError ? {
          code: cause.code, status: cause.status, parameter: cause.parameter, message: cause.message,
        } : { code: "unexpected_error", message: "실행 중 오류가 발생했습니다." };
        rows.push({ persona, run, scenario, status: "error", schema_pass: attempts.length ? attempts.every((a) => a.validation.schemaValid) : null,
          cards: 0, explore: 0, api_calls: error instanceof CardGenerationError ? error.apiCalls : 1,
          rejected: attempts.reduce((sum, a) => sum + a.validation.rejected.length, 0), file });
        await writeFile(path.join(outDir, file), JSON.stringify({ today, model, persona, scenario, requested_scenario: requestedScenario,
          input, attempts, error: detail }, null, 2) + "\n");
        await writeSummary(true);
        throw cause;
      }
    }
  }
  await writeSummary(true);
  if (rows.some((r) => r.status !== "success")) process.exitCode = 1;
}

main().catch((error: unknown) => {
  if (error instanceof LLMError) {
    console.error(`${error.code}${error.status ? ` (HTTP ${error.status})` : ""}: ${error.message}`);
    if (error.parameter) console.error(`거부된 위치: ${error.parameter}`);
  } else {
    console.error(error instanceof Error ? error.message : "실행에 실패했습니다.");
  }
  process.exitCode = 1;
});
