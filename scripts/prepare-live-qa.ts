import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseExport } from "../lib/parse";
import { confirmOnboarding } from "../lib/workspace";
import { buildWorkspaceCardInput } from "../lib/card-state";

async function main() {
// Authorize only this invented persona; no credentials are read by this helper.
const persona = "game-developer";
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const text = await readFile(`samples/${persona}.txt`, "utf8");
const parsed = parseExport(text, { today, source: "chatgpt" });
const workspace = confirmOnboarding(parsed, {}, null, new Date().toISOString());
const input = buildWorkspaceCardInput(workspace, today);
const directory = "out/final-qa-2026-11-12/live";
await mkdir(directory, { recursive: true });
await writeFile(`${directory}/authorized.json`, JSON.stringify({
  persona, today, source_sha256: createHash("sha256").update(text).digest("hex"),
  profile: input.profile, topics: input.topics.map(({ id, name }) => ({ id, name })),
}, null, 2) + "\n", "utf8");
process.stdout.write(`Prepared fictional ${persona} verification: ${input.topics.length} eligible topics.\n`);
}

void main().catch(() => { process.stderr.write("Could not prepare fictional QA input.\n"); process.exitCode = 1; });
