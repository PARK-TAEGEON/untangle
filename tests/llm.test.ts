import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { create, construct, FakeAPIError } = vi.hoisted(() => ({
  create: vi.fn(),
  construct: vi.fn(),
  FakeAPIError: class extends Error {
    code = "invalid_json_schema";
    status = 400;
    param = "text.format.schema";
  },
}));
vi.mock("openai", () => {
  class MockOpenAI {
    static APIError = FakeAPIError;
    responses = { create };
    constructor(options: unknown) { construct(options); }
  }
  return { default: MockOpenAI };
});

import { DEFAULT_OPENAI_MODEL, generateJSON } from "../lib/llm";
import { nudgeSchema } from "../lib/schemas";

const request = { system: "시스템", user: "가상 데이터", schema: nudgeSchema };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "synthetic-test-key");
  vi.stubEnv("OPENAI_MODEL", "");
  create.mockResolvedValue({ status: "completed", output: [], output_text: '{"nudges":[]}' });
});

describe("OpenAI JSON adapter", () => {
  it("passes the unchanged schema, requested default model, and disables storage/retries", async () => {
    expect(await generateJSON(request)).toEqual({ nudges: [] });
    const sent = create.mock.calls[0][0];
    expect(sent.model).toBe(DEFAULT_OPENAI_MODEL);
    expect(sent.model).toBe("gpt-5.6-terra");
    expect(sent.text.format.schema).toBe(nudgeSchema);
    expect(sent.text.format.strict).toBe(true);
    expect(sent.store).toBe(false);
    expect(sent.instructions).toBe(request.system);
    expect(construct).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }));
  });

  it("allows OPENAI_MODEL override", async () => {
    vi.stubEnv("OPENAI_MODEL", "configured-model");
    await generateJSON(request);
    expect(create.mock.calls[0][0].model).toBe("configured-model");
  });

  it("fails before contacting the API without a key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(generateJSON(request)).rejects.toMatchObject({ code: "missing_api_key" });
    expect(create).not.toHaveBeenCalled();
  });

  it("preserves rejected schema keywords without modifying or retrying the schema", async () => {
    create.mockRejectedValue(new FakeAPIError("Unsupported keyword: exampleKeyword"));
    await expect(generateJSON(request)).rejects.toMatchObject({
      code: "invalid_json_schema", status: 400, parameter: "text.format.schema",
      message: "Unsupported keyword: exampleKeyword",
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ status: "incomplete", output: [], output_text: "{}" }, "incomplete_response"],
    [{ status: "completed", output: [], output_text: "{" }, "invalid_json"],
    [{ status: "completed", output: [], output_text: "[]" }, "invalid_json_object"],
    [{ status: "completed", output: [{ type: "message", content: [{ type: "refusal" }] }], output_text: "" }, "refusal"],
  ])("rejects incomplete, malformed or refused output", async (response, code) => {
    create.mockResolvedValue(response);
    await expect(generateJSON(request)).rejects.toMatchObject({ code });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
