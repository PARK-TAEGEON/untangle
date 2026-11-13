import "server-only";
import OpenAI from "openai";

export const DEFAULT_OPENAI_MODEL = "gpt-5.6-terra";

export interface GenerateJSONInput {
  system: string;
  user: string;
  schema: Record<string, unknown>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
    public readonly parameter?: string,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

export async function generateJSON({ system, user, schema }: GenerateJSONInput): Promise<object> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new LLMError(".env.local에 OPENAI_API_KEY를 설정해 주세요.", "missing_api_key");
  }

  // SDK transport retries are disabled; card validation owns the one allowed retry.
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 120_000 });
  try {
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
      instructions: system,
      input: user,
      store: false,
      text: {
        format: { type: "json_schema", name: "untangle_response", strict: true, schema },
      },
    });

    if (response.status !== "completed") {
      throw new LLMError("응답이 끝까지 생성되지 않았습니다.", "incomplete_response");
    }
    if (response.output.some((item) => item.type === "message" &&
      item.content.some((part) => part.type === "refusal"))) {
      throw new LLMError("모델이 요청에 응답하지 못했습니다.", "refusal");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.output_text);
    } catch {
      throw new LLMError("응답을 JSON으로 읽지 못했습니다.", "invalid_json");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new LLMError("JSON 응답의 최상위 값이 객체가 아닙니다.", "invalid_json_object");
    }
    return parsed;
  } catch (error) {
    if (error instanceof LLMError) throw error;
    if (error instanceof OpenAI.APIError) {
      // Keep schema rejection details; never print the request, key, or user data.
      throw new LLMError(error.message, error.code || "openai_api_error", error.status, error.param || undefined);
    }
    throw new LLMError("OpenAI API에 연결하지 못했습니다.", "connection_error");
  }
}
