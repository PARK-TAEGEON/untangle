import { describe, expect, it, vi } from "vitest";
import OpenAI from "openai";
// @ts-expect-error Local QA preloader is intentionally plain ESM JavaScript.
import { budgetFetch } from "../scripts/live-api-budget.mjs";

const profile = { roles: ["가상 대학생"], interests: [], current_focus: [], work_style: null };
const topics = [{ id: "t1", name: "가상 과제" }];
const body = { store: false, instructions: "가상 프롬프트", input: JSON.stringify({ profile, topics, feedback: [] }), model: "gpt-5.6-terra" };
const request = (changes = {}) => new Request("https://api.openai.com/v1/responses", { method: "POST", body: JSON.stringify({ ...body, ...changes }) });

describe("local live verification hard cap", () => {
  it("forwards only the first three paid requests, including concurrent calls", async () => {
    const transport = vi.fn(async () => Response.json({ output: [] }));
    const fetch = budgetFetch(transport, { allowedProfile: profile, allowedTopics: topics });
    const results = await Promise.all(Array.from({ length: 5 }, () => fetch(request())));
    expect(transport).toHaveBeenCalledTimes(3);
    expect(results.map((response: Response) => response.status)).toEqual([200, 200, 200, 429, 429]);
  });

  it("retains the cap across a restarted verification process", async () => {
    const transport = vi.fn(async () => Response.json({ output: [] }));
    const fetch = budgetFetch(transport, { initialCalls: 3, allowedProfile: profile, allowedTopics: topics });
    expect((await fetch(request())).status).toBe(429);
    expect(transport).not.toHaveBeenCalled();
  });

  it("blocks any profile outside the authorized fictional persona before transmission", async () => {
    const transport = vi.fn();
    const fetch = budgetFetch(transport, { allowedProfile: profile, allowedTopics: topics });
    expect((await fetch(request({ input: JSON.stringify({ profile: { roles: ["different"] }, topics, feedback: [] }) }))).status).toBe(429);
    expect(transport).not.toHaveBeenCalled();
  });

  it("spends a reserved slot on a network error", async () => {
    const transport = vi.fn(async () => { throw new Error("network unavailable"); });
    const fetch = budgetFetch(transport, { initialCalls: 2, allowedProfile: profile, allowedTopics: topics });
    await expect(fetch(request())).rejects.toThrow("network unavailable");
    expect((await fetch(request())).status).toBe(429);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("also caps the installed OpenAI SDK transport without making any network request", async () => {
    const transport = vi.fn(async () => Response.json({ status: "completed", output: [] }));
    vi.stubGlobal("fetch", budgetFetch(transport, { allowedProfile: profile, allowedTopics: topics }));
    try {
      const client = new OpenAI({ apiKey: "local-unit-test-only", maxRetries: 0 });
      const input = { model: body.model, input: body.input, instructions: body.instructions, store: false };
      for (let i = 0; i < 3; i++) await client.responses.create(input);
      await expect(client.responses.create(input)).rejects.toMatchObject({ status: 429 });
      expect(transport).toHaveBeenCalledTimes(3);
    } finally { vi.unstubAllGlobals(); }
  });
});
