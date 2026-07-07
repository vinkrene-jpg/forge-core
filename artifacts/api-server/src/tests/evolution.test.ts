// Unit tests for the pure logic of the self-evolution services.
// Run with: pnpm --filter @workspace/api-server run test

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGaps } from "../lib/gapAnalysis";
import { deriveLessons } from "../lib/selfLearning";
import { buildFallbackPlan } from "../lib/evolutionPlanner";
import { assessCapability, CAPABILITY_SEEDS, type SelfModel } from "../lib/selfAwareness";
import { isUnsafeRelativePath, parseProposalResponse } from "../lib/proposalGenerator";
import type { CapabilityRow } from "@workspace/db";

function cap(partial: Partial<CapabilityRow> & { key: string }): CapabilityRow {
  return {
    id: 1,
    name: partial.key,
    description: "",
    status: "missing",
    maturity: 0,
    dependencies: [],
    limitations: null,
    missingParts: [],
    evidence: [],
    updatedAt: new Date(),
    ...partial,
  } as CapabilityRow;
}

test("computeGaps: working capabilities produce no gaps", () => {
  const gaps = computeGaps([cap({ key: "a", status: "working", maturity: 90 })]);
  assert.equal(gaps.length, 0);
});

test("computeGaps: ranks a gap that unblocks others higher", () => {
  const gaps = computeGaps([
    cap({ key: "base", status: "partial", maturity: 40 }),
    cap({ key: "leaf", status: "partial", maturity: 40, dependencies: ["base"] }),
    cap({ key: "leaf2", status: "partial", maturity: 40, dependencies: ["base"] }),
  ]);
  assert.equal(gaps[0].capabilityKey, "base");
  assert.ok(gaps[0].impactScore > gaps[1].impactScore);
  assert.deepEqual(gaps[0].blocking.sort(), ["leaf", "leaf2"]);
});

test("computeGaps: unmet dependencies lower the score", () => {
  const gaps = computeGaps([
    cap({ key: "dep", status: "missing", maturity: 0 }),
    cap({ key: "dependent", status: "missing", maturity: 0, dependencies: ["dep"] }),
  ]);
  const dep = gaps.find((g) => g.capabilityKey === "dep")!;
  const dependent = gaps.find((g) => g.capabilityKey === "dependent")!;
  assert.ok(dep.impactScore > dependent.impactScore);
  assert.match(dependent.reason, /blocked by unmet dependencies: dep/);
});

test("deriveLessons: full green pipeline yields a success lesson", () => {
  const lessons = deriveLessons({
    runId: 1,
    capabilityKey: "x",
    planCreated: true,
    planSource: "ai",
    proposalGenerated: true,
    blockedFiles: [],
    testStatus: "passed",
    guardianVerdict: "pass",
    governorDecision: "install_allowed",
  });
  assert.ok(lessons.some((l) => l.category === "successful_module"));
});

test("deriveLessons: failed tests and blocked files each yield a lesson", () => {
  const lessons = deriveLessons({
    runId: 2,
    capabilityKey: "x",
    planCreated: true,
    proposalGenerated: true,
    blockedFiles: ["../evil.js"],
    testStatus: "failed",
  });
  assert.ok(lessons.some((l) => l.category === "test_result"));
  assert.ok(lessons.some((l) => l.category === "recurring_blockade"));
});

test("deriveLessons: always yields at least one lesson", () => {
  const lessons = deriveLessons({ runId: 3, planCreated: false, proposalGenerated: false, blockedFiles: [] });
  assert.ok(lessons.length >= 1);
});

test("buildFallbackPlan: produces a complete deterministic plan", () => {
  const plan = buildFallbackPlan({
    capabilityKey: "self_learning",
    name: "Self Learning",
    status: "missing",
    maturity: 0,
    impactScore: 60,
    reason: "no lessons stored",
    blocking: [],
    risks: [],
    missingParts: ["memory engine usage"],
  });
  assert.equal(plan.source, "fallback");
  assert.ok(plan.steps.length >= 3);
  assert.equal(plan.risk, "medium");
  assert.equal(plan.priority, "high");
  assert.match(plan.testStrategy, /--test-isolation=none/);
  assert.ok(plan.affectedFiles.every((f) => !f.startsWith("/") && !f.includes("..")));
});

test("assessCapability: endpoint present + usage evidence => working", () => {
  const model = {
    scannedAt: "",
    sourceFiles: [],
    endpoints: [{ method: "POST", path: "/api/evolution/introspect", file: "r.ts" }],
    dbTables: [],
    docs: [],
    dependencies: [],
    configKeys: [],
    version: "1.0.0",
    architecture: [],
  } satisfies SelfModel;
  const seed = CAPABILITY_SEEDS.find((s) => s.key === "self_awareness")!;
  const counts = {
    snapshots: 2, nodes: 0, capabilities: 0, plans: 0, proposals: 0, sandboxes: 0,
    testRuns: 0, guardianReviews: 0, governorDecisions: 0, approvals: 0,
    moduleSnapshots: 0, auditEntries: 0, memoryItems: 0, evolutionRuns: 0, consoleModules: 0,
    actionCounts: {} as Record<string, number>,
  };
  const working = assessCapability(seed, model, counts);
  assert.equal(working.status, "working");
  assert.ok(working.maturity >= 80);

  const noUse = assessCapability(seed, model, { ...counts, snapshots: 0 });
  assert.equal(noUse.status, "partial");

  const noEndpoint = assessCapability(seed, { ...model, endpoints: [] }, counts);
  assert.equal(noEndpoint.status, "missing");
  assert.equal(noEndpoint.maturity, 0);

  const consoleSeed = CAPABILITY_SEEDS.find((s) => s.key === "operator_console")!;
  const consoleMissing = assessCapability(consoleSeed, model, counts);
  assert.equal(consoleMissing.status, "missing");
  const consoleWorking = assessCapability(consoleSeed, model, { ...counts, consoleModules: 1 });
  assert.equal(consoleWorking.status, "working");
});

test("path safety: traversal and absolute paths stay blocked", () => {
  assert.equal(isUnsafeRelativePath("../evil.js"), true);
  assert.equal(isUnsafeRelativePath("/etc/passwd"), true);
  assert.equal(isUnsafeRelativePath("C:\\windows\\x"), true);
  assert.equal(isUnsafeRelativePath("a/../../b.js"), true);
  assert.equal(isUnsafeRelativePath("modules/helper/index.js"), false);
});

test("parseProposalResponse: parses fenced JSON proposals", () => {
  const parsed = parseProposalResponse(
    '```json\n{"moduleName":"m","moduleType":"planner","purpose":"p","riskEstimate":"low","summary":"s","files":[{"path":"index.js","content":"x"}]}\n```',
  );
  assert.equal(parsed.moduleName, "m");
  assert.equal(parsed.files.length, 1);
});
