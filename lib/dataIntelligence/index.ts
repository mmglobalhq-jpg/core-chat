/**
 * Public entrypoint for the data-intelligence `query_data` tool.
 *
 * `getQueryDataToolDefinition()` returns the tool descriptor a tool registry
 * (e.g. the chat backend) would advertise to the model — or `null` when the
 * feature is disabled, so NO tool is exposed to the chat model. This is the
 * server-side gate; the browser is never involved.
 */

import { isFundsModeEnabled } from "./flags";

export { runQueryData } from "./tool";
export { isDataIntelligenceEnabled, isFundsModeEnabled, enabledModes } from "./flags";
export type { QueryDataToolInput, QueryDataToolResult, ServerContext } from "./types";

export type QueryDataToolDefinition = {
  name: "query_data";
  description: string;
  input_schema: Record<string, unknown>;
};

export function getQueryDataToolDefinition(): QueryDataToolDefinition | null {
  if (!isFundsModeEnabled()) return null;
  return {
    name: "query_data",
    description:
      "Answer fund-data questions (tracked funds, holdings, position changes, " +
      "sector exposure, search) from a verified internal source. Returns structured " +
      "data with provenance and verification; may ask one clarifying question or " +
      "abstain when the data cannot support an answer. Funds mode only.",
    input_schema: {
      type: "object",
      required: ["mode", "question"],
      properties: {
        mode: { type: "string", enum: ["funds"] },
        question: { type: "string" },
        scope: {
          type: "object",
          properties: {
            fund: { type: "string", description: "ticker or alias" },
            manager: { type: "string" },
            start_date: { type: "string", format: "date" },
            end_date: { type: "string", format: "date" },
          },
        },
        constraints: {
          type: "object",
          properties: { max_rows: { type: "integer", maximum: 500 } },
        },
      },
    },
  };
}
