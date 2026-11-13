import "server-only";
import { validateCards } from "./cards";
import { generateJSON } from "./llm";
import { nudgeSchema } from "./schemas";
import type { CardInput, CardValidationResult, Nudge } from "./card-types";

export interface CardAttempt {
  response: object;
  validation: CardValidationResult;
}

export interface CardGenerationResult {
  status: "success" | "validation_failed";
  nudges: Nudge[];
  attempts: CardAttempt[];
}

export class CardGenerationError extends Error {
  constructor(
    public readonly attempts: CardAttempt[],
    public readonly apiCalls: number,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : "카드 생성 중 오류가 발생했습니다.", { cause });
    this.name = "CardGenerationError";
  }
}

export async function generateCards(
  input: CardInput,
  system: string,
  generate: typeof generateJSON = generateJSON,
): Promise<CardGenerationResult> {
  const attempts: CardAttempt[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: object;
    try {
      response = await generate({ system, user: JSON.stringify(input), schema: nudgeSchema });
    } catch (cause) {
      throw new CardGenerationError(attempts, attempt + 1, cause);
    }
    const validation = validateCards(response, input);
    attempts.push({ response, validation });
    if (validation.shouldRetry && attempt === 0) continue;
    const success = validation.nudges.length > 0 ||
      (validation.schemaValid && !validation.shouldRetry && validation.rejected.length === 0);
    return { status: success ? "success" : "validation_failed", nudges: validation.nudges, attempts };
  }
  throw new Error("카드 검증 흐름을 마치지 못했습니다.");
}
