import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardInput, Nudge } from "../lib/card-types";

vi.mock("server-only", () => ({}));
const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("../lib/llm", () => ({ generateJSON: generate }));

import { POST, runtime } from "../app/api/cards/route";
import { loadNudgePrompt } from "../lib/prompts";

function input(): CardInput {
  return {
    today: "2026-11-12",
    profile: { roles: ["가상 개발자"], interests: [], current_focus: [], work_style: null },
    topics: [{
      id: "t1", name: "가상 프로젝트", theme: "개발", starred: false, days_left: null,
      deadline_label: null, deadline_text: null, goal: null, status_text: "초안이 있어요",
      outputs: [], recent_decisions: [], blockers: null, next_steps: ["초안 확인"],
    }],
    feedback: [],
  };
}

function card(): Nudge {
  return {
    id: "n1", topic_id: "t1", new_topic_name: null, slot: "focus", type: "continue",
    title: "초안 확인하기", action: "준비된 초안에서 확인할 항목을 고르세요.", est_minutes: 5,
    why_now: "초안이 있어 확인할 수 있어요.", evidence: [{ source: "topic", fact: "초안이 있어요" }],
    head_start: { kind: "checklist", content: "- [ ] 제목 확인", options: [] },
    first_step: "제목 항목을 확인해 주세요.",
  };
}

let nextIP = 1;
function request(value: unknown = input(), ip = `192.0.2.${nextIP++}`): Request {
  return new Request("http://localhost/api/cards", {
    method: "POST", body: JSON.stringify(value),
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
  });
}

beforeEach(() => {
  generate.mockReset();
  generate.mockResolvedValue({ nudges: [] });
});

describe("POST /api/cards", () => {
  it("uses Node and returns only validated cards with the unchanged prompt", async () => {
    const nudge = card();
    generate.mockResolvedValue({ nudges: [nudge] });
    const response = await POST(request());
    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ nudges: [nudge] });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0]).toMatchObject({ system: await loadNudgePrompt(), user: JSON.stringify(input()) });
  });

  it("returns normal zero-card success without retrying", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ nudges: [] });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("retries once after all cards fail validation and returns the accepted retry", async () => {
    generate.mockResolvedValueOnce({ nudges: [{ ...card(), topic_id: "not-sent" }] })
      .mockResolvedValueOnce({ nudges: [card()] });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ nudges: [card()] });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[0]).toEqual(generate.mock.calls[1]);
  });

  it("returns a safe failure after the second rejected response", async () => {
    generate.mockResolvedValue({ nudges: [{ id: "private-invalid-id" }] });
    const response = await POST(request());
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({ error: "제안 형식을 확인하지 못했어요. 다시 시도해 주세요." });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("drops invalid cards while preserving a valid card without retrying", async () => {
    generate.mockResolvedValue({ nudges: [{ id: "invalid" }, card()] });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ nudges: [card()] });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("sends dismissed feedback through validation and rejects the same action", async () => {
    const value = input();
    value.feedback = [{ topic_id: "t1", type: "continue", title: "이전 카드", action: card().action, result: "dismissed", note: null }];
    generate.mockResolvedValue({ nudges: [card()] });
    const response = await POST(request(value));
    expect(response.status).toBe(502);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(JSON.parse(generate.mock.calls[0][0].user).feedback).toEqual(value.feedback);
  });

  it("rejects malformed input and oversized UTF-8 input before the LLM call", async () => {
    const value = input();
    value.profile.work_style = "가".repeat(70_000);
    for (const invalid of [{ ...input(), extra: "data" }, { ...input(), topics: [null] }, value]) {
      const response = await POST(request(invalid));
      expect(response.status).toBe(400);
      expect(await response.json()).toHaveProperty("error");
    }
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects cross-site simple POST and cross-origin JSON before contacting the provider", async () => {
    for (const contentType of ["text/plain", "application/json"]) {
      const value = request();
      value.headers.set("origin", "https://foreign.example");
      value.headers.set("content-type", contentType);
      const response = await POST(value);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "이 페이지에서 다시 요청해 주세요." });
    }
    expect(generate).not.toHaveBeenCalled();
  });

  it("requires JSON Content-Type even without an Origin header", async () => {
    const value = request();
    value.headers.delete("content-type");
    const missing = await POST(value);
    expect(missing.status).toBe(415);
    expect(await missing.json()).toEqual({ error: "JSON 형식으로 요청해 주세요." });
    const plain = request();
    plain.headers.set("content-type", "text/plain");
    expect((await POST(plain)).status).toBe(415);
    expect(generate).not.toHaveBeenCalled();
  });

  it("accepts same-origin JSON with a UTF-8 charset", async () => {
    const value = request();
    value.headers.set("origin", "http://localhost");
    value.headers.set("content-type", "application/json; charset=utf-8");
    expect((await POST(value)).status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("hides provider errors and user data without retrying API failures", async () => {
    generate.mockRejectedValue(new Error("secret-key private-user-data provider-debug"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await POST(request());
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "초안을 준비하지 못했어요. 잠시 뒤 다시 시도해 주세요." });
      expect(generate).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("limits each IP to ten requests per minute without contacting the provider for the eleventh", async () => {
    const ip = "198.51.100.10";
    for (let count = 0; count < 10; count++) expect((await POST(request(input(), ip))).status).toBe(200);
    const response = await POST(request(input(), `${ip}, 198.51.100.11`));
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await response.json()).toEqual({ error: "요청이 많아요. 잠시 뒤 다시 시도해 주세요." });
    expect(generate).toHaveBeenCalledTimes(10);
    expect((await POST(request(input(), "198.51.100.12"))).status).toBe(200);
  });
});
