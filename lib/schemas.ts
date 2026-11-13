import Ajv2020 from "ajv/dist/2020";
import canonicalNudgeSchema from "../docs/nudge_schema.json";
import canonicalTopicSchema from "../docs/topic_schema.json";
import type { ExportData, ParseResult } from "./types";
import type { Nudge } from "./card-types";

// Use the archived schemas verbatim. quality is parser metadata, not schema data.
export const nudgeSchema = canonicalNudgeSchema;
export const topicSchema = canonicalTopicSchema;

const ajv = new Ajv2020({ allErrors: true, strict: true });
export const validateExportData = ajv.compile<ExportData>(topicSchema);
export const validateNudgeResponse = ajv.compile<{ nudges: Nudge[] }>(nudgeSchema);
export const validateNudge = ajv.compile<Nudge>(nudgeSchema.properties.nudges.items);

export function exportDataFromParse(result: ParseResult): ExportData {
  const { profile, themes, topics } = result;
  return { profile, themes, topics };
}
