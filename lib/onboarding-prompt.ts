import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

export async function loadOnboardingPrompt(): Promise<string> {
  const text = await readFile(path.join(process.cwd(), "docs/onboarding_prompts.md"), "utf8");
  const section = text.split("## ① 내보내기 프롬프트")[1];
  const prompt = section?.match(/```\r?\n([\s\S]*?)\r?\n```/)?.[1];
  if (!prompt) throw new Error("기준 문서에서 내보내기 프롬프트를 찾지 못했습니다.");
  return prompt;
}
