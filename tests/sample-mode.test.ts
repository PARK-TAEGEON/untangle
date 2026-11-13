import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fixtures from "../samples/card-fixtures.json";
import { acceptCard, getCardState, updateCardContent } from "../lib/card-state";
import type { Nudge } from "../lib/card-types";
import { validateCards } from "../lib/cards";
import { buildWorkspaceCardInput } from "../lib/card-state";
import { parseExport } from "../lib/parse";
import { SAMPLE_PERSONAS, advanceSampleCards, createSampleWorkspace } from "../lib/sample-mode";
import { validateExportData } from "../lib/schemas";

const NOW = "2026-11-12T12:00:00.000Z";
const TODAY = "2026-11-12";

describe("curated fictional sample fixtures", () => {
  it.each(SAMPLE_PERSONAS)("uses the approved fictional text and at least two validated rounds for $id", ({ id }) => {
    const fixture = fixtures.personas[id];
    const text = readFileSync(new URL(`../${fixture.source_text}`, import.meta.url), "utf8");
    const { profile, themes, topics } = parseExport(text, { source: "other", today: TODAY });
    expect(fixture.data).toEqual({ profile, themes, topics });
    expect(createHash("sha256").update(readFileSync(new URL(`../${fixture.source_text}`, import.meta.url))).digest("hex")).toBe(fixture.source_text_sha256);
    expect(validateExportData(fixture.data)).toBe(true);
    expect(fixture.rounds.length).toBeGreaterThanOrEqual(2);
    for (const round of fixture.rounds) {
      expect(round.source_sha256).toMatch(/^[a-f\d]{64}$/);
      expect(round.source_file).toMatch(/^out\/2026-11-12T12-48-08-v05\//);
      expect(round.selected_ids).toEqual(round.nudges.map((card) => card.id));
      expect(round.selection_note.length).toBeGreaterThan(0);
      const workspace = createSampleWorkspace(id, NOW, TODAY);
      const validation = validateCards({ nudges: round.nudges }, buildWorkspaceCardInput(workspace, TODAY));
      expect(validation.schemaValid).toBe(true);
      expect(validation.nudges).toHaveLength(round.nudges.length);
      // Source recordings remain ignored. When present locally, verify verbatim selection too.
      const source = new URL(`../${round.source_file}`, import.meta.url);
      if (existsSync(source)) {
        const raw = readFileSync(source);
        const recorded = JSON.parse(raw.toString("utf8")) as { response: { nudges: Nudge[] } };
        expect(createHash("sha256").update(raw).digest("hex")).toBe(round.source_sha256);
        expect(round.nudges).toEqual(recorded.response.nudges.filter((card) => round.selected_ids.includes(card.id)));
      }
    }
  });

  it("omits the uncertain SQL cards rather than editing recorded text", () => {
    for (const round of fixtures.personas.student.rounds) {
      expect(round.nudges).toHaveLength(2);
      expect(round.omitted).toEqual([expect.objectContaining({ id: "n1", reason: expect.stringContaining("SQL 기대 행 수") })]);
    }
  });

  it.each(SAMPLE_PERSONAS)("cycles two different local responses for $id", ({ id }) => {
    const first = createSampleWorkspace(id, NOW, TODAY);
    const second = advanceSampleCards(first, NOW, TODAY);
    const third = advanceSampleCards(second, NOW, TODAY);
    expect(getCardState(second).items.map((card) => card.nudge)).not.toEqual(getCardState(first).items.map((card) => card.nudge));
    expect(getCardState(third).items.map((card) => card.nudge)).toEqual(getCardState(first).items.map((card) => card.nudge));
    expect(first.sample?.baseline_date).toBe(TODAY);
    expect(advanceSampleCards({ ...first, sample: undefined }, NOW, TODAY).sample).toBeUndefined();
  });

  it("preserves accepted edited cards while cycling and creates a new sample project only on acceptance", () => {
    let state = createSampleWorkspace("student", NOW, TODAY);
    const firstKey = getCardState(state).items[0].key;
    state = updateCardContent(state, firstKey, "샘플에서 고친 초안");
    state = acceptCard(state, firstKey, NOW);
    state = advanceSampleCards(state, NOW, TODAY);
    expect(getCardState(state).items.find((card) => card.key === firstKey)?.content).toBe("샘플에서 고친 초안");
    const project = getCardState(state).items.find((card) => card.nudge.type === "new_project")!;
    expect(state.topics.some((topic) => topic.name === project.nudge.new_topic_name)).toBe(false);
    const accepted = acceptCard(state, project.key, NOW);
    expect(accepted.topics.some((topic) => topic.name === project.nudge.new_topic_name)).toBe(true);
  });
});
