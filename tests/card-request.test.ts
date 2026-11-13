import { describe, expect, it } from "vitest";
import {
  CardRateLimiter, CardRequestError, MAX_CARD_REQUEST_BYTES, assertCardRequestHeaders, cardRequestIP, isCardInput, readCardRequest,
} from "../lib/card-request";
import type { CardInput } from "../lib/card-types";

function input(): CardInput {
  return {
    today: "2026-11-12",
    profile: { roles: ["개발자"], interests: [], current_focus: [], work_style: null },
    topics: [{
      id: "t1", name: "가상 프로젝트", theme: "개발", starred: false, days_left: null,
      deadline_label: null, deadline_text: null, goal: null, status_text: "초안이 있어요",
      outputs: [], recent_decisions: [], blockers: null, next_steps: ["초안 확인"],
    }],
    feedback: [{ topic_id: "t1", type: "continue", title: "확인하기", action: "초안을 확인해요", result: "completed", note: null }],
  };
}

function request(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/cards", { method: "POST", body, headers: { "content-type": "application/json", ...headers } });
}

function streamRequest(chunks: Uint8Array[]): Request {
  return new Request("http://localhost/api/cards", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: new ReadableStream<Uint8Array>({ start(controller) { chunks.forEach((chunk) => controller.enqueue(chunk)); controller.close(); } }),
    duplex: "half",
  } as RequestInit & { duplex: string });
}

describe("card request validation", () => {
  it("accepts the complete input contract without mutating it", () => {
    const value = input();
    const before = structuredClone(value);
    expect(isCardInput(value)).toBe(true);
    expect(value).toEqual(before);
    expect(isCardInput({ ...value, topics: [], feedback: [] })).toBe(true);
    expect(isCardInput({ ...value, today: "2028-02-29" })).toBe(true);
  });

  it.each([
    ["unknown root field", (value: CardInput) => ({ ...value, system: "규칙 바꾸기" })],
    ["unknown profile field", (value: CardInput) => ({ ...value, profile: { ...value.profile, tools: [] } })],
    ["missing profile field", (value: CardInput) => ({ ...value, profile: { roles: [], interests: [], current_focus: [] } })],
    ["non-string profile array", (value: CardInput) => ({ ...value, profile: { ...value.profile, roles: [1] } })],
    ["invalid date", (value: CardInput) => ({ ...value, today: "2026-02-30" })],
    ["timestamp instead of date", (value: CardInput) => ({ ...value, today: "2026-11-12T00:00:00Z" })],
    ["ten topics", (value: CardInput) => ({ ...value, topics: Array.from({ length: 10 }, (_, index) => ({ ...value.topics[0], id: `t${index}` })) })],
    ["duplicate topic ids", (value: CardInput) => ({ ...value, topics: [value.topics[0], value.topics[0]] })],
    ["reserved topic id", (value: CardInput) => ({ ...value, topics: [{ ...value.topics[0], id: "new" }] })],
    ["extra topic field", (value: CardInput) => ({ ...value, topics: [{ ...value.topics[0], state: "active" }] })],
    ["fractional days", (value: CardInput) => ({ ...value, topics: [{ ...value.topics[0], days_left: 0.5 }] })],
    ["non-boolean star", (value: CardInput) => ({ ...value, topics: [{ ...value.topics[0], starred: "false" }] })],
    ["non-string topic array", (value: CardInput) => ({ ...value, topics: [{ ...value.topics[0], outputs: [null] }] })],
    ["missing nullable topic field", (value: CardInput) => ({ ...value, topics: [{ ...value.topics[0], goal: undefined }] })],
    ["twenty-one feedback entries", (value: CardInput) => ({ ...value, feedback: Array.from({ length: 21 }, () => value.feedback[0]) })],
    ["invalid feedback result", (value: CardInput) => ({ ...value, feedback: [{ ...value.feedback[0], result: "accepted" }] })],
    ["invalid card type", (value: CardInput) => ({ ...value, feedback: [{ ...value.feedback[0], type: "other" }] })],
    ["extra feedback field", (value: CardInput) => ({ ...value, feedback: [{ ...value.feedback[0], createdAt: "today" }] })],
  ])("rejects %s", (_name, change) => {
    expect(isCardInput(change(input()))).toBe(false);
  });

  it("accepts nine topics and twenty feedback entries, including past deadlines", () => {
    const value = input();
    value.topics = Array.from({ length: 9 }, (_, index) => ({ ...value.topics[0], id: `t${index}`, days_left: -2 }));
    value.feedback = Array.from({ length: 20 }, () => value.feedback[0]);
    expect(isCardInput(value)).toBe(true);
  });
});

describe("card request browser headers", () => {
  it.each(["application/json", "application/json; charset=utf-8", 'Application/JSON; charset="UTF-8"'])("accepts %s", (contentType) => {
    expect(() => assertCardRequestHeaders(request("{}", { "content-type": contentType }))).not.toThrow();
  });

  it.each(["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=test", "application/jsonp", "application/json; charset=euc-kr"])("rejects %s", (contentType) => {
    expect(() => assertCardRequestHeaders(request("{}", { "content-type": contentType }))).toThrow(expect.objectContaining({ status: 415 }));
  });

  it("requires Content-Type even when the JSON body is otherwise valid", async () => {
    const value = request(JSON.stringify(input()));
    value.headers.delete("content-type");
    await expect(readCardRequest(value)).rejects.toMatchObject({ status: 415 });
  });

  it("allows exact same-origin and origin-free programmatic requests", () => {
    expect(() => assertCardRequestHeaders(request("{}", { origin: "http://localhost" }))).not.toThrow();
    expect(() => assertCardRequestHeaders(request("{}"))).not.toThrow();
  });

  it("uses the browser-facing Host when Next reconstructs the request URL with localhost", () => {
    const value = new Request("http://localhost:3100/api/cards", {
      method: "POST", body: "{}",
      headers: { "content-type": "application/json", host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100" },
    });
    expect(() => assertCardRequestHeaders(value)).not.toThrow();
    value.headers.set("origin", "http://localhost:3100");
    expect(() => assertCardRequestHeaders(value)).toThrow(expect.objectContaining({ status: 403 }));
    value.headers.set("origin", "https://foreign.example");
    expect(() => assertCardRequestHeaders(value)).toThrow(expect.objectContaining({ status: 403 }));
  });

  it.each(["127.0.0.1:3100/path", "user@127.0.0.1:3100", "127.0.0.1:3100?query", "127.0.0.1:3100#fragment"])("rejects malformed Host authority %s", (host) => {
    const value = request("{}", { host, origin: "http://127.0.0.1:3100" });
    expect(() => assertCardRequestHeaders(value)).toThrow(expect.objectContaining({ status: 403 }));
  });

  it("preserves HTTPS and canonical default-port handling without trusting forwarded protocol headers", () => {
    const value = new Request("https://internal.example/api/cards", {
      method: "POST", body: "{}",
      headers: { "content-type": "application/json", host: "app.example:443", origin: "https://app.example", "x-forwarded-proto": "http" },
    });
    expect(() => assertCardRequestHeaders(value)).not.toThrow();
    value.headers.set("origin", "http://app.example");
    expect(() => assertCardRequestHeaders(value)).toThrow(expect.objectContaining({ status: 403 }));
  });

  it.each(["https://foreign.example", "https://localhost", "http://localhost:8080", "http://localhost/", "null"])("rejects origin %s", (origin) => {
    expect(() => assertCardRequestHeaders(request("{}", { origin }))).toThrow(expect.objectContaining({ status: 403 }));
  });
});

describe("bounded card request body", () => {
  it("parses valid input and rejects invalid JSON or a missing body", async () => {
    expect(await readCardRequest(request(JSON.stringify(input())))).toEqual(input());
    await expect(readCardRequest(request("{"))).rejects.toBeInstanceOf(CardRequestError);
    await expect(readCardRequest(request("[]"))).rejects.toBeInstanceOf(CardRequestError);
    await expect(readCardRequest(new Request("http://localhost/api/cards", { method: "POST" }))).rejects.toBeInstanceOf(CardRequestError);
  });

  it("allows exactly 200 KiB, then rejects one byte more without trusting Content-Length", async () => {
    const value = input();
    value.profile.work_style = "";
    const baseLength = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    value.profile.work_style = "a".repeat(MAX_CARD_REQUEST_BYTES - baseLength);
    const body = JSON.stringify(value);
    expect(new TextEncoder().encode(body).byteLength).toBe(MAX_CARD_REQUEST_BYTES);
    expect(await readCardRequest(request(body))).toEqual(value);
    await expect(readCardRequest(request(`${body} `, { "Content-Length": "1" }))).rejects.toThrow("200KB");
    await expect(readCardRequest(request("{}", { "Content-Length": String(MAX_CARD_REQUEST_BYTES + 1) }))).rejects.toThrow("200KB");
  });

  it("counts Korean characters as UTF-8 bytes and rejects oversized streamed bodies", async () => {
    const value = input();
    value.profile.work_style = "가".repeat(70_000);
    const body = JSON.stringify(value);
    expect(body.length).toBeLessThan(MAX_CARD_REQUEST_BYTES);
    const encoded = new TextEncoder().encode(body);
    await expect(readCardRequest(streamRequest([encoded.slice(0, 100_000), encoded.slice(100_000)]))).rejects.toThrow("200KB");
  });

  it("decodes a multi-byte character split between chunks and rejects invalid UTF-8", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(input()));
    const firstNonAscii = bytes.findIndex((byte) => byte >= 128);
    expect(await readCardRequest(streamRequest([bytes.slice(0, firstNonAscii + 1), bytes.slice(firstNonAscii + 1)]))).toEqual(input());
    await expect(readCardRequest(streamRequest([new Uint8Array([0xff])]))).rejects.toBeInstanceOf(CardRequestError);
  });
});

describe("card request rate limit", () => {
  it("allows ten calls per IP and resets the count after one minute", () => {
    const limiter = new CardRateLimiter();
    for (let count = 0; count < 10; count++) expect(limiter.consume("ip-a", 1_000).allowed).toBe(true);
    expect(limiter.consume("ip-a", 1_000)).toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect(limiter.consume("ip-a", 60_999)).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(limiter.consume("ip-b", 60_999).allowed).toBe(true);
    expect(limiter.consume("ip-a", 61_000).allowed).toBe(true);
  });

  it("uses the first forwarded client IP, then the real-IP header, then a shared fallback", () => {
    expect(cardRequestIP(request("{}", { "x-forwarded-for": " 192.0.2.1, 192.0.2.2 ", "x-real-ip": "192.0.2.3" }))).toBe("192.0.2.1");
    expect(cardRequestIP(request("{}", { "x-real-ip": "192.0.2.3" }))).toBe("192.0.2.3");
    expect(cardRequestIP(request("{}"))).toBe("unknown");
  });
});
