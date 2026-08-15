import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveCapabilityOutcomeGaps,
  rankCapabilityGapCandidates,
} from "./capability-gap-feedback";
import type { CapabilityRecord } from "./capability";
import type { MissionRecord } from "./mission";

const capabilities: CapabilityRecord[] = [
  "mission.loop.execute",
  "evaluation.output.assess",
  "governance.risk.assess",
  "tool.workspace.verify",
  "ai.provider.execute",
  "workspace.plan.validate",
].map((id) => ({
  id,
  name: id,
  description: id,
  status: "operational",
  version: "1.0.0",
  confidence: 1,
  source: "test",
  createdAt: "2026-08-15T00:00:00.000Z",
  updatedAt: "2026-08-15T00:00:00.000Z",
}));

function failedMission(id: string, output: MissionRecord["output"]): MissionRecord {
  return {
    id,
    kind: "operator.autonomous-cycle",
    title: id,
    status: "failed",
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T01:00:00.000Z",
    startedAt: "2026-08-15T00:30:00.000Z",
    completedAt: "2026-08-15T01:00:00.000Z",
    attempts: 1,
    interruptedCount: 0,
    input: {},
    output,
    lastError: null,
  };
}

test("derives and ranks mission, evaluation and mandate outcome gaps", () => {
  const rejected = failedMission("mission-a", {
    missionResult: {
      status: "rejected",
      cause: "evaluation",
      message: "Evaluation rejected",
      producedAt: "2026-08-15T01:00:00.000Z",
    },
    evaluation: {
      decision: "rejected",
      checks: [{ id: "verification-explicit", passed: false }],
    },
  });
  const repeated = failedMission("mission-b", rejected.output);
  const bounded = failedMission("mission-c", {
    missionResult: {
      status: "blocked",
      cause: "goal-mandate.duration",
      message: "Duration boundary reached",
      producedAt: "2026-08-15T01:00:00.000Z",
    },
    mandateBoundary: { boundary: "duration", limit: 1, actual: 2 },
  });
  const missions = [rejected, repeated, bounded];
  const analyses = missions.flatMap((mission) =>
    deriveCapabilityOutcomeGaps(mission, capabilities)
  );

  assert.equal(analyses.filter((item) => item.outcomeType === "mission_failure").length, 3);
  assert.equal(analyses.filter((item) => item.outcomeType === "evaluation_rejection").length, 2);
  assert.equal(analyses.filter((item) => item.outcomeType === "mandate_boundary").length, 1);

  const candidates = rankCapabilityGapCandidates(analyses, missions, capabilities);
  assert.equal(candidates[0].capabilityId, "evaluation.output.assess");
  assert.equal(candidates[0].occurrences, 2);
  assert.deepEqual(candidates[0].missionIds, ["mission-a", "mission-b"]);
  assert.equal(candidates[0].releasedGoalSpecMissionId, null);
  assert.match(candidates[0].proposedGoalSpec.objective, /evaluation\.output\.assess/);
});

test("links provider plan contract rejection to workspace plan validation", () => {
  const mission = failedMission("ed87826a", {
    missionResult: {
      status: "failed",
      cause: "provider-output-contract",
      message: "Workspace provider plan rejected: target manifest mismatch",
      producedAt: "2026-08-15T01:00:00.000Z",
    },
  });

  const [analysis] = deriveCapabilityOutcomeGaps(mission, capabilities);
  assert.equal(analysis.gaps[0].capabilityId, "workspace.plan.validate");
  assert.equal(analysis.outcomeCause, "workspace-plan-validation-failed");
});