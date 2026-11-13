import { generateCards } from "../../../lib/card-generation";
import { CardRateLimiter, CardRequestError, cardRequestIP, readCardRequest } from "../../../lib/card-request";
import { loadNudgePrompt } from "../../../lib/prompts";

export const runtime = "nodejs";

const limiter = new CardRateLimiter();
const responseHeaders = { "Cache-Control": "no-store" };

export async function POST(request: Request): Promise<Response> {
  const limit = limiter.consume(cardRequestIP(request));
  if (!limit.allowed) {
    return Response.json({ error: "요청이 많아요. 잠시 뒤 다시 시도해 주세요." }, {
      status: 429,
      headers: { ...responseHeaders, "Retry-After": String(limit.retryAfterSeconds) },
    });
  }

  try {
    const input = await readCardRequest(request);
    const result = await generateCards(input, await loadNudgePrompt());
    if (result.status !== "success") {
      return Response.json({ error: "제안 형식을 확인하지 못했어요. 다시 시도해 주세요." }, {
        status: 502, headers: responseHeaders,
      });
    }
    return Response.json({ nudges: result.nudges }, { headers: responseHeaders });
  } catch (error) {
    if (error instanceof CardRequestError) {
      return Response.json({ error: error.message }, { status: error.status, headers: responseHeaders });
    }
    return Response.json({ error: "초안을 준비하지 못했어요. 잠시 뒤 다시 시도해 주세요." }, {
      status: 502, headers: responseHeaders,
    });
  }
}
