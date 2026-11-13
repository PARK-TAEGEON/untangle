import type { ExportData } from "./types";
import type {
  CardInput,
  CardInputOptions,
  CardValidationResult,
  Nudge,
} from "./card-types";
import { validateNudge, validateNudgeResponse } from "./schemas";

export type {
  CardFeedback,
  CardInput,
  CardInputOptions,
  CardValidationResult,
  Nudge,
} from "./card-types";

const DAY_MS = 24 * 60 * 60 * 1000;

function calendarDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString().slice(0, 10) === value ? time : null;
}

/** Build an ephemeral LLM input; imported topics and classifications stay intact. */
export function buildCardInput(
  data: ExportData,
  today: string,
  options: CardInputOptions = {},
): CardInput {
  const todayTime = calendarDay(today);
  if (todayTime === null) throw new TypeError("today must be a valid YYYY-MM-DD date");
  const excluded = new Set(options.excludedTopicIds ?? []);
  const starred = new Set(options.starredTopicIds ?? []);

  return {
    today,
    profile: {
      roles: [...data.profile.roles],
      interests: [...data.profile.interests],
      current_focus: [...data.profile.current_focus],
      work_style: data.profile.work_style,
    },
    topics: data.topics
      .filter((topic) => topic.suggested_state === "active" && !excluded.has(topic.id))
      .slice(0, 9)
      .map((topic) => {
        const deadlineTime = topic.deadline === null ? null : calendarDay(topic.deadline);
        return {
          id: topic.id,
          name: topic.name,
          theme: topic.theme,
          starred: starred.has(topic.id),
          days_left: deadlineTime === null ? null : (deadlineTime - todayTime) / DAY_MS,
          deadline_label: topic.deadline_label,
          deadline_text: topic.deadline_text,
          goal: topic.goal,
          status_text: topic.status_text,
          outputs: [...topic.outputs],
          recent_decisions: [...topic.recent_decisions],
          blockers: topic.blockers,
          next_steps: [...topic.next_steps],
        };
      }),
    feedback: (options.feedback ?? []).slice(-20).map((feedback) => ({ ...feedback })),
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function candidateId(value: unknown): string | null {
  return record(value) && typeof value.id === "string" ? value.id : null;
}

/**
 * Apply the canonical schema, then the deterministic rules stated in the prompt.
 * Structural failures in one card do not discard other valid cards.
 * Semantic quality (e.g. whether an idea is useful or evidence is truthful) still
 * needs the human quality review requested in docs/nudge_prompt.md §④.
 */
export function validateCards(response: unknown, input: CardInput): CardValidationResult {
  const schemaValid = Boolean(validateNudgeResponse(response));
  const candidates = record(response) && Array.isArray(response.nudges) ? response.nudges : [];
  const nudges: Nudge[] = [];
  const rejected: CardValidationResult["rejected"] = [];

  // Envelope constraints are from nudge_schema.json; per-card schema failures
  // below can be salvaged, but unknown root fields cannot silently be accepted.
  if (!record(response) || !Array.isArray(response.nudges) || Object.keys(response).some((key) => key !== "nudges")) {
    rejected.push({ id: null, reasons: ["응답은 nudges 배열만 가진 객체여야 합니다."] });
    return { nudges, rejected, schemaValid, shouldRetry: candidates.length > 0 };
  }

  const sentTopics = new Map(input.topics.map((topic) => [topic.id, topic]));
  const dismissedActions = new Set(
    input.feedback.filter((feedback) => feedback.result === "dismissed").map((feedback) => feedback.action),
  );
  const usedTopics = new Set<string>();
  const usedIds = new Set<string>();
  let focusCount = 0;
  let exploreCount = 0;
  let seenExplore = false;

  for (const candidate of candidates) {
    if (!validateNudge(candidate)) {
      rejected.push({
        id: candidateId(candidate),
        reasons: (validateNudge.errors ?? []).map((error) => `${error.instancePath || "/"}: ${error.message ?? "schema validation failed"}`),
      });
      continue;
    }
    const card = candidate as Nudge;
    const reasons: string[] = [];
    const topic = sentTopics.get(card.topic_id);

    if (card.slot === "focus") {
      if (card.type !== "continue" && card.type !== "unblock") reasons.push("focus는 continue 또는 unblock이어야 합니다.");
      if (focusCount >= 2) reasons.push("focus는 최대 2장입니다.");
      if (seenExplore) reasons.push("focus는 explore보다 먼저 나와야 합니다.");
    } else {
      if (card.type !== "expand" && card.type !== "new_project") reasons.push("explore는 expand 또는 new_project여야 합니다.");
      if (exploreCount >= 1) reasons.push("explore는 최대 1장입니다.");
      if (topic?.days_left !== null && topic?.days_left !== undefined && topic.days_left <= 3) {
        reasons.push("마감까지 3일 이하인 토픽은 explore를 만들 수 없습니다.");
      }
    }

    if (card.type === "new_project") {
      if (card.topic_id !== "new") reasons.push("new_project의 topic_id는 new여야 합니다.");
      if (!card.new_topic_name?.trim()) reasons.push("new_project에는 새 토픽 이름이 필요합니다.");
    } else {
      if (!topic || card.topic_id === "new") reasons.push("topic_id가 보낸 토픽에 없습니다.");
      if (card.new_topic_name !== null) reasons.push("기존 토픽의 new_topic_name은 null이어야 합니다.");
    }
    if (usedTopics.has(card.topic_id)) reasons.push("토픽 하나당 카드는 최대 1장입니다.");
    if (usedIds.has(card.id)) reasons.push("카드 ID는 이번 응답 안에서 고유해야 합니다.");

    if (card.type === "unblock") {
      if (card.head_start.kind !== "question") reasons.push("unblock의 head_start.kind는 question이어야 합니다.");
      if (card.head_start.options.length < 2 || card.head_start.options.length > 4) reasons.push("unblock의 선택지는 2~4개여야 합니다.");
    } else {
      if (card.head_start.kind === "question") reasons.push("unblock이 아니면 초안·목차·체크리스트여야 합니다.");
      if (card.head_start.options.length !== 0) reasons.push("unblock이 아니면 선택지가 없어야 합니다.");
    }
    if (card.est_minutes < 1 || card.est_minutes > 30) reasons.push("est_minutes는 1~30이어야 합니다.");
    if (dismissedActions.has(card.action)) reasons.push("dismissed 카드와 action이 같습니다.");
    if (Array.from(card.title).length > 40 || /[\r\n]/.test(card.title)) reasons.push("title은 40자 이내 한 줄이어야 합니다.");
    if (Array.from(card.head_start.content).length > 600) reasons.push("head_start.content는 600자 이내여야 합니다.");
    if (card.evidence.length < 1 || card.evidence.length > 3) reasons.push("evidence는 1~3개여야 합니다.");
    if (card.head_start.options.some((option) => Array.from(option.label).length > 20)) reasons.push("선택지 label은 20자 이내여야 합니다.");

    if (reasons.length > 0) {
      rejected.push({ id: card.id, reasons });
      continue;
    }
    nudges.push(card);
    usedTopics.add(card.topic_id);
    usedIds.add(card.id);
    if (card.slot === "focus") focusCount += 1;
    else {
      exploreCount += 1;
      seenExplore = true;
    }
  }

  return { nudges, rejected, schemaValid, shouldRetry: candidates.length > 0 && nudges.length === 0 };
}
