// Validation tests for the Forge Self-Upgrade Loop runner.
// Run via: pnpm forge:self-review:test

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseBacklog,
  analyzeGoal,
  runSelfReview,
  BacklogValidationError,
  repoRoot,
  type UpgradeGoal,
} from "./forge-self-review.js";

const validGoal: UpgradeGoal = {
  id: "UPG-T1",
  title: "Test goal",
  description: "A test goal.",
  priority: "low",
  risk: "low",
  status: "planned",
  acceptanceCriteria: ["exists"],
  testRequirements: ["none"],
  ownerApprovalRequired: false,
  evidence: { filesExist: ["package.json"], patterns: [{ file: "package.json", contains: "forge:self-review" }] },
};

test("backlog can be read and parsed", () => {
  const raw = fs.readFileSync(path.join(repoRoot, "config", "forge-upgrades.json"), "utf8");
  const backlog = parseBacklog(raw);
  assert.ok(backlog.upgrades.length >= 1);
  assert.ok(backlog.upgrades.every((u) => u.id && u.title));
});

test("validation fails when mandatory fields are missing", () => {
  const broken = { version: 1, description: "x", upgrades: [{ id: "UPG-X", title: "No priority" }] };
  assert.throws(() => parseBacklog(JSON.stringify(broken)), BacklogValidationError);
  assert.throws(() => parseBacklog("not json"), BacklogValidationError);
  const emptyCriteria = { version: 1, description: "x", upgrades: [{ ...validGoal, acceptanceCriteria: [] }] };
  assert.throws(() => parseBacklog(JSON.stringify(emptyCriteria)), BacklogValidationError);
});

test("evidence paths may not escape the repository", () => {
  const evil: UpgradeGoal = { ...validGoal, evidence: { filesExist: ["../../etc/passwd"] } };
  assert.throws(() => analyzeGoal(evil), BacklogValidationError);
});

test("evidence paths may not reference secret/credential files", () => {
  for (const bad of [".env", ".env.production", "config/server.key", "certs/tls.pem", "ops/db-credentials.json"]) {
    const goal: UpgradeGoal = { ...validGoal, evidence: { filesExist: [bad] } };
    assert.throws(() => analyzeGoal(goal), BacklogValidationError, `should reject ${bad}`);
  }
});

test("symlinks pointing outside the repository are rejected", () => {
  const linkDir = path.join(repoRoot, "reports");
  fs.mkdirSync(linkDir, { recursive: true });
  const link = path.join(linkDir, "tmp-escape-link");
  if (fs.existsSync(link) || fs.lstatSync(link, { throwIfNoEntry: false })) fs.unlinkSync(link);
  fs.symlinkSync(os.tmpdir(), link);
  try {
    const goal: UpgradeGoal = { ...validGoal, evidence: { filesExist: ["reports/tmp-escape-link"] } };
    assert.throws(() => analyzeGoal(goal), BacklogValidationError);
  } finally {
    fs.unlinkSync(link);
  }
});

test("report writes outside reports/ are rejected", () => {
  const backlogPath = path.join(repoRoot, "config", "forge-upgrades.json");
  const outside = path.join(os.tmpdir(), "forge-escape.md");
  assert.throws(() => runSelfReview(backlogPath, outside), BacklogValidationError);
  assert.ok(!fs.existsSync(outside));
});

test("report writes through a symlinked subdir of reports/ are rejected", () => {
  const reportsDir = path.join(repoRoot, "reports");
  fs.mkdirSync(reportsDir, { recursive: true });
  const link = path.join(reportsDir, "tmp-write-escape");
  if (fs.lstatSync(link, { throwIfNoEntry: false })) fs.unlinkSync(link);
  fs.symlinkSync(os.tmpdir(), link);
  try {
    const backlogPath = path.join(repoRoot, "config", "forge-upgrades.json");
    const target = path.join(link, "escaped.md");
    assert.throws(() => runSelfReview(backlogPath, target), BacklogValidationError);
    assert.ok(!fs.existsSync(path.join(os.tmpdir(), "escaped.md")));
  } finally {
    fs.unlinkSync(link);
  }
});

test("report is generated and contains the owner gate", () => {
  const reportDir = path.join(repoRoot, "reports", "test-output");
  const reportPath = path.join(reportDir, "forge-self-review.test.md");
  const backlogPath = path.join(repoRoot, "config", "forge-upgrades.json");
  const { report, analyses } = runSelfReview(backlogPath, reportPath);
  assert.ok(fs.existsSync(reportPath));
  assert.ok(report.includes("# Forge Self-Review Report"));
  assert.ok(report.includes("Owner approval required:"));
  assert.ok(report.includes("never modifies code, never commits"));
  assert.ok(analyses.length >= 1);
  fs.rmSync(reportDir, { recursive: true, force: true });
});

test("runner source contains no git, deploy or production actions", () => {
  const src = fs.readFileSync(path.join(repoRoot, "scripts", "src", "forge-self-review.ts"), "utf8");
  // Forbid any way of invoking external commands or network calls: without
  // these primitives the runner cannot commit, push, deploy or reach a VPS.
  for (const forbidden of ["child_process", "execSync", "execFile", "spawn(", "fork(", "fetch(", "http.", "https.", "net.connect", "process.env"]) {
    assert.ok(!src.includes(forbidden), `runner must not reference '${forbidden}'`);
  }
});
