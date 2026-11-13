import type { CardFeedback, CardInput, CardTopic } from "./card-types";

export const MAX_CARD_REQUEST_BYTES = 200 * 1024;
export const CARD_REQUESTS_PER_MINUTE = 10;
const WINDOW_MS = 60_000;

export class CardRequestError extends Error {
  constructor(
    message = "입력 형식을 확인해 주세요.",
    public readonly status: 400 | 403 | 415 = 400,
  ) {
    super(message);
    this.name = "CardRequestError";
  }
}

export function assertCardRequestHeaders(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin !== null) {
    const url = new URL(request.url);
    const host = request.headers.get("host");
    let expectedOrigin = url.origin;
    if (host !== null) {
      // Next may reconstruct request.url with an internal hostname. Host is the
      // browser-facing authority and port; retain the request URL's protocol.
      try {
        if (!host || /[\s/@\\?#]/.test(host)) throw new Error("Invalid host");
        expectedOrigin = new URL(`${url.protocol}//${host}`).origin;
      } catch {
        throw new CardRequestError("이 페이지에서 다시 요청해 주세요.", 403);
      }
    }
    if (origin !== expectedOrigin) throw new CardRequestError("이 페이지에서 다시 요청해 주세요.", 403);
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(?:;\s*charset\s*=\s*(?:utf-?8|"utf-?8")\s*)?$/i.test(contentType)) {
    throw new CardRequestError("JSON 형식으로 요청해 주세요.", 415);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function date(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function topic(value: unknown): value is CardTopic {
  if (!record(value) || !exactKeys(value, [
    "id", "name", "theme", "starred", "days_left", "deadline_label", "deadline_text",
    "goal", "status_text", "outputs", "recent_decisions", "blockers", "next_steps",
  ])) return false;
  return typeof value.id === "string" && value.id.trim().length > 0 && value.id !== "new" &&
    typeof value.name === "string" && typeof value.theme === "string" &&
    typeof value.starred === "boolean" &&
    (value.days_left === null || Number.isSafeInteger(value.days_left)) &&
    [value.deadline_label, value.deadline_text, value.goal, value.status_text, value.blockers].every(nullableString) &&
    strings(value.outputs) && strings(value.recent_decisions) && strings(value.next_steps);
}

function feedback(value: unknown): value is CardFeedback {
  if (!record(value) || !exactKeys(value, ["topic_id", "type", "title", "action", "result", "note"])) return false;
  return typeof value.topic_id === "string" && typeof value.title === "string" &&
    typeof value.action === "string" && nullableString(value.note) &&
    ["continue", "unblock", "expand", "new_project"].includes(value.type as string) &&
    ["completed", "dismissed", "snoozed"].includes(value.result as string);
}

/** Validate only the exact user-message contract in docs/nudge_prompt.md §②. */
export function isCardInput(value: unknown): value is CardInput {
  if (!record(value) || !exactKeys(value, ["today", "profile", "topics", "feedback"]) || !date(value.today)) return false;
  const profile = value.profile;
  if (!record(profile) || !exactKeys(profile, ["roles", "interests", "current_focus", "work_style"]) ||
    !strings(profile.roles) || !strings(profile.interests) || !strings(profile.current_focus) ||
    !nullableString(profile.work_style)) return false;
  if (!Array.isArray(value.topics) || value.topics.length > 9 || !value.topics.every(topic)) return false;
  if (new Set(value.topics.map((item) => item.id)).size !== value.topics.length) return false;
  return Array.isArray(value.feedback) && value.feedback.length <= 20 && value.feedback.every(feedback);
}

/** Bound the actual UTF-8 stream, including when Content-Length is absent or inaccurate. */
export async function readCardRequest(request: Request): Promise<CardInput> {
  assertCardRequestHeaders(request);
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_CARD_REQUEST_BYTES) {
    throw new CardRequestError("입력은 200KB 이하로 보내 주세요.");
  }
  if (!request.body) throw new CardRequestError();
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_CARD_REQUEST_BYTES) {
        await reader.cancel();
        throw new CardRequestError("입력은 200KB 이하로 보내 주세요.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof CardRequestError) throw error;
    throw new CardRequestError();
  } finally {
    reader.releaseLock();
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CardRequestError();
  }
  if (!isCardInput(value)) throw new CardRequestError();
  return value;
}

/** In-memory request counts only; no profile, topic, feedback, or response data is retained. */
export class CardRateLimiter {
  private readonly buckets = new Map<string, { count: number; expiresAt: number }>();

  consume(ip: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    for (const [key, bucket] of this.buckets) {
      if (bucket.expiresAt <= now) this.buckets.delete(key);
    }
    let bucket = this.buckets.get(ip);
    if (!bucket) {
      bucket = { count: 0, expiresAt: now + WINDOW_MS };
      this.buckets.set(ip, bucket);
    }
    if (bucket.count >= CARD_REQUESTS_PER_MINUTE) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000)) };
    }
    bucket.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export function cardRequestIP(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() || "unknown";
}
