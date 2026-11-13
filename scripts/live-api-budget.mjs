/**
 * Local, fictional-data-only UI verification. Never load this in a deployed app.
 * Run the QA Next process with UNTANGLE_LIVE_QA=1 and this Node --import preloader.
 * Next reads the real key from .env.local; this script never reads or records keys.
 * The persistent ledger permits at most THREE actual OpenAI requests in this run.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const LIMIT = 3;
const blocked = (code) => new Response(JSON.stringify({ error: { message: "Local UI verification request blocked.", type: "qa_limit", code } }), {
  status: 429, headers: { "Content-Type": "application/json" },
});

export function budgetFetch(nativeFetch, { initialCalls = 0, allowedProfile, allowedTopics, onStart, onFinish, onBlocked }) {
  let calls = initialCalls;
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== "api.openai.com") return nativeFetch(request);
    if (request.method !== "POST" || url.pathname !== "/v1/responses") return blocked("qa_endpoint_blocked");
    let body;
    let user;
    try {
      body = await request.clone().json();
      user = JSON.parse(body.input);
    } catch { return blocked("qa_input_blocked"); }
    if (body.store !== false || body.stream || JSON.stringify(user.profile) !== JSON.stringify(allowedProfile)
      || !Array.isArray(user.topics) || !Array.isArray(user.feedback)
      || user.topics.some((topic) => !allowedTopics.some((allowed) => allowed.id === topic.id && allowed.name === topic.name))) {
      return blocked("qa_input_blocked");
    }
    if (calls >= LIMIT) {
      await onBlocked?.();
      return blocked("qa_budget_exhausted");
    }
    const sequence = ++calls;
    // Record the reservation before transmission; network failures also spend a slot.
    await onStart?.({ sequence, model: body.model, input: user, prompt_sha256: createHash("sha256").update(body.instructions).digest("hex") });
    try {
      const response = await nativeFetch(request);
      if (response.ok) {
        const result = await response.clone().json();
        await onFinish?.(sequence, { http_status: response.status, response: result });
      } else {
        // Error messages can contain masked credentials, so retain only the status.
        await onFinish?.(sequence, { http_status: response.status });
      }
      return response;
    } catch (cause) {
      await onFinish?.(sequence, { transport_error: true });
      throw cause;
    }
  };
}

if (process.env.UNTANGLE_LIVE_QA === "1") {
  const directory = path.resolve("out/final-qa-2026-11-12/live");
  const authorized = JSON.parse(await readFile(path.join(directory, "authorized.json"), "utf8"));
  const ledgerPath = path.join(directory, "ledger.json");
  let ledger = { limit: LIMIT, calls: [], blocked_after_limit: 0 };
  try { ledger = JSON.parse(await readFile(ledgerPath, "utf8")); } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!Array.isArray(ledger.calls) || ledger.limit !== LIMIT) throw new Error("Invalid local QA ledger.");
  await mkdir(directory, { recursive: true });
  const save = () => writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + "\n", "utf8");
  globalThis.fetch = budgetFetch(globalThis.fetch, {
    initialCalls: process.env.UNTANGLE_LIVE_QA_LOCKED === "1" ? LIMIT : ledger.calls.length,
    allowedProfile: authorized.profile,
    allowedTopics: authorized.topics,
    onStart: async (call) => {
      ledger.calls.push({ ...call, started_at: new Date().toISOString() });
      await save();
    },
    onFinish: async (sequence, result) => {
      Object.assign(ledger.calls.find((call) => call.sequence === sequence), result, { finished_at: new Date().toISOString() });
      await save();
    },
    onBlocked: async () => { ledger.blocked_after_limit += 1; await save(); },
  });
  await save();
  process.stdout.write(`Live UI verification guard: ${ledger.calls.length}/${LIMIT} calls used${process.env.UNTANGLE_LIVE_QA_LOCKED === "1" ? "; further calls locked" : ""}.\n`);
}
