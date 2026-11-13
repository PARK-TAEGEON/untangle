import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { CardGenerationError, generateCards } from "../lib/card-generation";
import type { CardInput } from "../lib/card-types";

const input: CardInput = {
  today: "2026-11-12",
  profile: { roles: [], interests: [], current_focus: [], work_style: null },
  topics: [], feedback: [],
};

describe("card retry orchestration", () => {
  it("accepts a normal empty result after exactly one request", async () => {
    const generate = vi.fn().mockResolvedValue({ nudges: [] });
    const result = await generateCards(input, "원문 프롬프트", generate);
    expect(result.status).toBe("success");
    expect(result.nudges).toEqual([]);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("retries once when all candidates are rejected, preserving the prompt", async () => {
    const generate = vi.fn().mockResolvedValueOnce({ nudges: [{ id: "invalid" }] })
      .mockResolvedValueOnce({ nudges: [] });
    const result = await generateCards(input, "원문 프롬프트", generate);
    expect(result.status).toBe("success");
    expect(result.attempts).toHaveLength(2);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[0]).toEqual(generate.mock.calls[1]);
  });

  it("stops after the second fully rejected result", async () => {
    const generate = vi.fn().mockResolvedValue({ nudges: [{ id: "invalid" }] });
    const result = await generateCards(input, "원문 프롬프트", generate);
    expect(result.status).toBe("validation_failed");
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("does not retry an API/schema rejection or malformed envelope", async () => {
    const reject = vi.fn().mockRejectedValue(new Error("schema rejected"));
    await expect(generateCards(input, "프롬프트", reject)).rejects.toThrow("schema rejected");
    expect(reject).toHaveBeenCalledTimes(1);
    const malformed = vi.fn().mockResolvedValue({});
    expect((await generateCards(input, "프롬프트", malformed)).status).toBe("validation_failed");
    expect(malformed).toHaveBeenCalledTimes(1);
  });

  it("retains the rejected response and both calls if the retry fails", async () => {
    const cause = new Error("API failed on retry");
    const generate = vi.fn().mockResolvedValueOnce({ nudges: [{ id: "invalid" }] })
      .mockRejectedValueOnce(cause);
    try {
      await generateCards(input, "원문 프롬프트", generate);
      expect.fail("expected a generation error");
    } catch (error) {
      expect(error).toBeInstanceOf(CardGenerationError);
      const failure = error as CardGenerationError;
      expect(failure.cause).toBe(cause);
      expect(failure.apiCalls).toBe(2);
      expect(failure.attempts).toHaveLength(1);
      expect(failure.attempts[0].validation.rejected).toHaveLength(1);
    }
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
