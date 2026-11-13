/**
 * Browser QA only. This local upstream never calls OpenAI or reads .env files.
 * Run: node --import tsx scripts/mock-cards-server.ts
 * Point only the QA Next server at OPENAI_BASE_URL=http://127.0.0.1:3111/v1
 * with OPENAI_API_KEY=local-qa-only. Never use this server in production.
 */
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CardFeedback, CardInput, CardTopic, Nudge } from "../lib/card-types";

type Mode = "normal" | "empty" | "error" | "new_project";
interface RequestStats {
  topic_ids: string[];
  topic_names: string[];
  feedback: CardFeedback[];
}
interface MockChoice { action: string; title: string; content: string }

const HOST = "127.0.0.1";
const PORT = 3111;
const MAX_BODY_BYTES = 300 * 1024;
const MODES: readonly string[] = ["normal", "empty", "error", "new_project"];
let mode: Mode = "normal";
let count = 0;
let models: string[] = [];
let lastInput: RequestStats | null = null;

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += part.length;
    if (bytes > MAX_BODY_BYTES) throw new Error("body_too_large");
    chunks.push(part);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function parseInput(value: unknown): CardInput | null {
  if (typeof value !== "string") return null;
  let input: unknown;
  try { input = JSON.parse(value) as unknown; } catch { return null; }
  if (!record(input) || typeof input.today !== "string" || !record(input.profile)
    || !Array.isArray(input.topics) || input.topics.length > 9 || !Array.isArray(input.feedback)) return null;
  if (!input.topics.every((topic) => record(topic) && typeof topic.id === "string" && typeof topic.name === "string"
    && (topic.days_left === null || (typeof topic.days_left === "number" && Number.isFinite(topic.days_left))))) return null;
  if (!input.feedback.every((feedback) => record(feedback) && typeof feedback.topic_id === "string"
    && typeof feedback.action === "string" && typeof feedback.title === "string"
    && ["continue", "unblock", "expand", "new_project"].includes(feedback.type as string)
    && ["completed", "dismissed", "snoozed"].includes(feedback.result as string)
    && (feedback.note === null || typeof feedback.note === "string"))) return null;
  if (!isStringArray(input.profile.roles)) return null;
  return input as unknown as CardInput;
}

function choose(choices: readonly MockChoice[], excludedActions: ReadonlySet<string>): MockChoice | undefined {
  // Exhausted directions produce fewer cards, never a renamed dismissed action.
  return choices.find((choice) => !excludedActions.has(choice.action));
}

const CONTINUE_CHOICES: readonly MockChoice[] = [
  {
    title: "가상 재현 기록 확인하기",
    action: "가상 기록표의 입력과 기대 결과를 확인하고 다른 문구 한 곳만 고치세요.",
    content: "가정: 아래는 브라우저 검증용 가상 예시입니다.\n\n| 입력 | 기대 결과 |\n|---|---|\n| 목록 항목을 선택 | 선택한 상세를 표시 |\n| 닫기 버튼을 선택 | 목록으로 돌아가기 |\n\n- [ ] 첫 행의 입력 확인\n- [ ] 두 번째 행의 기대 결과 확인",
  },
  {
    title: "가상 시연 순서 선택하기",
    action: "가상 시연 체크리스트에서 먼저 볼 순서 하나를 골라 표시하세요.",
    content: "가정: 아래는 브라우저 검증용 가상 시연안입니다.\n\n| 시연안 | 먼저 볼 동작 |\n|---|---|\n| A | 목록에서 상세 열기 |\n| B | 상세에서 목록으로 돌아오기 |\n\n- [ ] 먼저 확인할 시연안 선택\n- [ ] 관찰할 동작 한 가지 선택",
  },
  {
    title: "가상 관찰 기준 고르기",
    action: "가상 관찰 기준 중 화면 전환과 선택 유지 중 하나를 먼저 확인할 기준으로 고르세요.",
    content: "가정: 아래는 브라우저 검증용 가상 관찰안입니다.\n\n| 기준 | 관찰할 것 |\n|---|---|\n| 화면 전환 | 닫은 뒤 목록이 보이는가 |\n| 선택 유지 | 선택한 항목 표시가 남는가 |\n\n- [ ] 기준 하나 선택\n- [ ] 선택한 기준의 표현 확인",
  },
];
const QUESTION_CHOICES: readonly MockChoice[] = [
  { title: "가상 확인 화면 고르기", action: "가상 테스트에서 목록 화면과 상세 화면 중 먼저 확인할 화면을 선택하세요.", content: "가상 테스트에서 어느 화면부터 확인할까요?" },
  { title: "가상 기록 기준 고르기", action: "가상 점검 기록에서 화면 전환과 선택 표시 중 먼저 남길 관찰 기준을 선택하세요.", content: "가상 점검에서 어느 관찰 기준을 먼저 기록할까요?" },
];
const EXPLORE_CHOICES: readonly MockChoice[] = [
  { title: "가상 초안을 기록으로 쓰기", action: "가상 초안을 개인 기록으로 바꾼 문장에서 보관할 문장 한 가지를 고르세요.", content: "가정: 아래는 브라우저 검증용 가상 기록 초안입니다.\n\n## 작은 화면 전환 기록\n목록에서 항목을 고르면 상세를 확인한다. 상세를 닫은 뒤에는 목록으로 돌아오는 흐름을 살펴본다.\n\n기록으로 남길 문장 하나를 골라보세요." },
  { title: "가상 실험 역할 뒤집기", action: "가상 실험에서 설명하는 역할과 관찰하는 역할을 바꾼 뒤 먼저 볼 항목을 고르세요.", content: "가정: 아래는 브라우저 검증용 가상 역할 실험입니다.\n\n- 1회차: A가 화면을 설명하고 B가 선택 순서를 관찰한다.\n- 2회차: B가 설명하고 A가 관찰한다.\n\n먼저 볼 항목: 설명이 멈추는 곳 / 선택을 다시 확인하는 곳" },
];
const NEW_PROJECT_CHOICES: readonly MockChoice[] = [
  { title: "가상 제작 기록 시작하기", action: "가상 제작 기록의 제목을 확인하고 새 기록으로 남길 문장 한 가지를 고르세요.", content: "가정: 아래는 브라우저 검증용 가상 제작 기록입니다.\n\n## 작은 동작 기록\n준비된 초안을 확인하고 한 곳을 고친다. 고친 이유는 짧은 문장으로 남긴다.\n\n첫 기록으로 남길 문장을 하나 골라보세요." },
  { title: "가상 종이 실험 시작하기", action: "새 가상 종이 실험에서 설명자와 관찰자 중 먼저 맡을 역할을 고르세요.", content: "가정: 아래는 브라우저 검증용 가상 종이 실험입니다.\n\n- 설명자: 준비된 동작 순서를 읽는다.\n- 관찰자: 설명을 다시 읽은 지점을 표시한다.\n\n첫 역할 하나를 골라 작은 실험을 시작해보세요." },
];

function makeCard(id: string, topic: CardTopic | undefined, type: Nudge["type"], choice: MockChoice): Nudge {
  const questionIndex = QUESTION_CHOICES.indexOf(choice);
  const isQuestion = type === "unblock";
  const options = !isQuestion ? [] : questionIndex === 1 ? [
    { id: "transition", label: "화면 전환", value: "화면 전환부터 기록할게요." },
    { id: "selection", label: "선택 표시", value: "선택 표시부터 기록할게요." },
  ] : [
    { id: "list", label: "목록 화면", value: "목록 화면부터 확인할게요." },
    { id: "detail", label: "상세 화면", value: "상세 화면부터 확인할게요." },
  ];
  return {
    id, slot: type === "continue" || isQuestion ? "focus" : "explore",
    topic_id: type === "new_project" ? "new" : topic!.id,
    new_topic_name: type === "new_project" ? (choice === NEW_PROJECT_CHOICES[0] ? "가상 제작 기록" : "가상 종이 실험") : null,
    type, title: choice.title, action: choice.action, est_minutes: isQuestion ? 5 : 10,
    why_now: "전달된 토픽을 바탕으로 가상 초안을 확인하는 작은 행동을 준비했어요.",
    evidence: [{ source: topic ? "topic" : "profile", fact: topic ? `카드 입력에 ID ${topic.id}인 토픽이 있어요.` : "카드 입력에 프로필의 역할 목록이 있어요." }],
    head_start: { kind: isQuestion ? "question" : type === "continue" ? "checklist" : "draft", content: choice.content, options },
    first_step: isQuestion ? "두 선택지 중 먼저 확인할 하나를 골라보세요." : "준비된 초안에서 확인할 문장 한 곳을 골라보세요.",
  };
}

function generateMockCards(input: CardInput): Nudge[] {
  if (mode === "empty") return [];
  const excluded = new Set(input.feedback.map((feedback) => feedback.action));
  const used = new Set<string>();
  const nudges: Nudge[] = [];
  const first = input.topics[0];
  const continuation = choose(CONTINUE_CHOICES, excluded);
  if (first && continuation) {
    nudges.push(makeCard(`n${nudges.length + 1}`, first, "continue", continuation));
    used.add(first.id);
  }
  const second = input.topics.find((topic) => !used.has(topic.id));
  const question = choose(QUESTION_CHOICES, excluded);
  if (second && question) {
    nudges.push(makeCard(`n${nudges.length + 1}`, second, "unblock", question));
    used.add(second.id);
  }
  if (mode === "new_project") {
    const fresh = choose(NEW_PROJECT_CHOICES, excluded);
    if (fresh) nudges.push(makeCard(`n${nudges.length + 1}`, undefined, "new_project", fresh));
  } else {
    const topic = input.topics.find((item) => !used.has(item.id) && (item.days_left === null || item.days_left > 3));
    const expansion = choose(EXPLORE_CHOICES, excluded);
    if (topic && expansion) nudges.push(makeCard(`n${nudges.length + 1}`, topic, "expand", expansion));
  }
  return nudges;
}

function completedResponse(model: string, nudges: Nudge[]): object {
  return {
    id: `resp_local_mock_${count}`, object: "response", created_at: Math.floor(Date.now() / 1000),
    status: "completed", error: null, incomplete_details: null, model, store: false,
    output: [{ id: `msg_local_mock_${count}`, type: "message", status: "completed", role: "assistant",
      content: [{ type: "output_text", text: JSON.stringify({ nudges }), annotations: [], logprobs: [] }] }],
    parallel_tool_calls: false, tools: [], tool_choice: "auto", metadata: {},
    usage: { input_tokens: 0, input_tokens_details: { cached_tokens: 0 }, output_tokens: 0,
      output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 0 },
  };
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
    if (request.method === "GET" && url.pathname === "/control") {
      const requested = url.searchParams.get("mode");
      if (requested !== null && !MODES.includes(requested)) return send(response, 400, { error: "unknown_mode" });
      if (requested !== null) mode = requested as Mode;
      if (url.searchParams.get("reset") === "1") { count = 0; models = []; lastInput = null; }
      return send(response, 200, { mode, count });
    }
    if (request.method === "GET" && url.pathname === "/stats") {
      return send(response, 200, { mode, count, requestCount: count, models, lastInput, inputs: lastInput ? [lastInput] : [] });
    }
    if (request.method !== "POST" || url.pathname !== "/v1/responses") return send(response, 404, { error: "not_found" });
    count += 1;
    console.log(`mock request ${count}`);
    let body: unknown;
    try { body = await readBody(request); } catch { return send(response, 400, { error: { message: "모의 요청을 읽지 못했습니다.", type: "invalid_request_error", code: "mock_invalid_body" } }); }
    if (!record(body)) return send(response, 400, { error: { message: "모의 요청 형식을 확인해 주세요.", type: "invalid_request_error", code: "mock_invalid_body" } });
    const input = parseInput(body.input);
    if (!input || typeof body.model !== "string") return send(response, 400, { error: { message: "CardInput 형식의 모의 입력이 필요합니다.", type: "invalid_request_error", code: "mock_invalid_input" } });
    models.push(body.model);
    // Retain only the last projected input in memory; never store the profile,
    // instructions, original paste text, Authorization header, or any files.
    lastInput = {
      topic_ids: input.topics.map((topic) => topic.id),
      topic_names: input.topics.map((topic) => topic.name),
      feedback: input.feedback.map((feedback) => ({ ...feedback })),
    };
    if (mode === "error") return send(response, 500, { error: { message: "브라우저 검증용 모의 오류입니다.", type: "server_error", param: null, code: "mock_error" } });
    return send(response, 200, completedResponse(body.model, generateMockCards(input)));
  })().catch(() => {
    if (!response.headersSent) send(response, 500, { error: { message: "모의 서버 처리 오류입니다.", type: "server_error", code: "mock_error" } });
    else response.end();
  });
});

server.on("error", () => { console.error("모의 서버를 시작하지 못했어요."); process.exitCode = 1; });
server.listen(PORT, HOST, () => console.log(`mock ready http://${HOST}:${PORT}`));
