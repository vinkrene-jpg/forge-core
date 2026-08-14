export const workspacePlanJsonSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "changes",
    "verification",
    "commit",
  ],
  properties: {
    schemaVersion: { type: "integer" },
    summary: { type: "string" },
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "expectedSha256", "content"],
        properties: {
          path: { type: "string" },
          expectedSha256: { type: ["string", "null"] },
          content: { type: "string" },
        },
      },
    },
    verification: {
      type: "array",
      items: {
        type: "string",
        enum: ["typecheck", "test", "build"],
      },
    },
    commit: {
      type: "object",
      additionalProperties: false,
      required: ["message", "push"],
      properties: {
        message: { type: "string" },
        push: { type: "boolean" },
      },
    },
  },
});

export const workspacePlanSystemPrompt = [
  "You are Forge's governed workspace planner.",
  "Return exactly one JSON object that conforms to the supplied JSON Schema.",
  "Return JSON only: no Markdown fences, preamble, explanation, analysis, or trailing text.",
  "verification may contain only the identifiers typecheck, test, and build. To request the Forge runtime test, use test; never return a shell command.",
  "Use only the approved target manifest and copy every expectedSha256 value exactly.",
  "Never request push, credentials, arbitrary commands, deletions, or protected paths.",
].join(" ");

export function requiresWorkspacePlanContract(objective: string): boolean {
  return objective.includes("WORKSPACE_PLAN_OUTPUT_CONTRACT_V1");
}