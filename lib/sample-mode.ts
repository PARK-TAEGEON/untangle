import fixtureData from "../samples/card-fixtures.json";
import { applyGeneratedCards, applyTopicGeneratedCards, buildTopicCardInput, getCardState } from "./card-state";
import { buildWorkspaceCardInput } from "./card-state";
import type { Nudge } from "./card-types";
import { validateCards } from "./cards";
import type { ExportData } from "./types";
import { confirmOnboarding } from "./workspace";
import type { WorkspaceData } from "./workspace";

export type SamplePersonaId = "game-developer" | "student";
export interface SampleMode {
  persona: SamplePersonaId;
  next_round: number;
  baseline_date: string;
}

export const SAMPLE_PERSONAS: ReadonlyArray<{ id: SamplePersonaId; title: string; description: string }> = [
  { id: "game-developer", title: "게임 개발자", description: "협동 게임 안내, 오류 재현, 작은 퍼즐을 함께 다뤄요." },
  { id: "student", title: "대학생", description: "수업 팀플과 데이터베이스 과제, 개인 게임을 함께 다뤄요." },
];
export const SAMPLE_BASELINE_DATE = fixtureData.baseline_date;

/** All examples are fictional. Card text is selected verbatim from the recorded API responses. */
export function createSampleWorkspace(persona: SamplePersonaId, now: string, today: string): WorkspaceData {
  const data = structuredClone(fixtureData.personas[persona].data) as ExportData;
  const workspace = confirmOnboarding(data, {}, null, now);
  return advanceSampleCards({ ...workspace, sample: { persona, next_round: 0, baseline_date: SAMPLE_BASELINE_DATE } }, now, today);
}

/** A deterministic local replacement for generation. This module never calls fetch or the LLM. */
export function advanceSampleCards(workspace: WorkspaceData, now: string, today: string): WorkspaceData {
  if (!workspace.sample) return workspace;
  const sample = workspace.sample;
  const rounds = fixtureData.personas[sample.persona].rounds;
  const index = sample.next_round % rounds.length;
  const input = buildWorkspaceCardInput(workspace, sample.baseline_date);
  const nudges = structuredClone(rounds[index].nudges) as Nudge[];
  const candidates = nudges.filter((card) => card.type !== "new_project"
    || !workspace.topics.some((topic) => topic.name === card.new_topic_name));
  const validation = validateCards({ nudges: candidates }, input);
  const next = applyGeneratedCards(workspace, validation.nudges, now, today);
  return {
    ...next,
    sample: { ...sample, next_round: (index + 1) % rounds.length },
    cards: { ...getCardState(next), request_id: null },
  };
}

/** Explicit topic requests reuse only that topic's saved examples and never change the daily cache. */
export function advanceSampleTopicCards(workspace: WorkspaceData, topicId: string, now: string, requestId: string): WorkspaceData {
  if (!workspace.sample) return workspace;
  const sample = workspace.sample;
  const rounds = fixtureData.personas[sample.persona].rounds;
  const index = sample.next_round % rounds.length;
  const input = buildTopicCardInput(workspace, topicId, sample.baseline_date);
  const candidates = structuredClone(rounds[index].nudges).filter((card) => card.topic_id === topicId);
  const validation = validateCards({ nudges: candidates }, input);
  const next = applyTopicGeneratedCards(workspace, topicId, validation.nudges, now, requestId);
  return { ...next, sample: { ...sample, next_round: (index + 1) % rounds.length } };
}
