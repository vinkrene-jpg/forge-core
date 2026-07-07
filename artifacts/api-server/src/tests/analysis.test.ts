import test from "node:test";
import assert from "node:assert/strict";
import { computeQualityFindings } from "../lib/qualityAnalyzer";
import { computeDebtFindings } from "../lib/techDebtAnalyzer";
import { computeDependencyReport } from "../lib/dependencyAnalyzer";
import { computeArchitectureResults } from "../lib/architectureValidator";
import { findingToImprovement } from "../lib/refactoringEngine";
import type { ScannedFile } from "../lib/codeScan";

function file(name: string, content: string): ScannedFile {
  return { file: name, content, lines: content.split("\n").length };
}

test("quality analyzer flags oversized files and console.log in server code", () => {
  const big = file("artifacts/api-server/src/lib/big.ts", Array(700).fill("const x = 1;").join("\n"));
  const logging = file("artifacts/api-server/src/lib/log.ts", 'console.log("hi");');
  const clean = file("artifacts/api-server/src/lib/ok.ts", "export const a = 1;");
  const findings = computeQualityFindings([big, logging, clean]);
  assert.ok(findings.some((f) => f.code === "file-too-large" && f.severity === "critical"));
  assert.ok(findings.some((f) => f.code === "console-log-in-server" && f.file === logging.file));
  assert.ok(!findings.some((f) => f.file === clean.file));
});

test("debt analyzer flags TODO markers, skipped tests and duplicate routes", () => {
  const todo = file("artifacts/api-server/src/lib/a.ts", "// TODO: fix\n// FIXME: later");
  const skipped = file("artifacts/api-server/src/tests/b.ts", "test.skip('x', () => {});");
  const dupA = file("artifacts/api-server/src/routes/r1.ts", 'router.get("/things", h);');
  const dupB = file("artifacts/api-server/src/routes/r2.ts", 'router.get("/things", h);');
  const findings = computeDebtFindings([todo, skipped, dupA, dupB]);
  assert.ok(findings.some((f) => f.code === "todo-markers"));
  assert.ok(findings.some((f) => f.code === "skipped-tests"));
  assert.ok(findings.some((f) => f.code === "duplicate-route" && f.severity === "critical"));
});

test("dependency analyzer flags version mismatches but not catalog/workspace pins", () => {
  const { dependencies, mismatches, findings } = computeDependencyReport([
    { file: "a/package.json", deps: { zod: "^3.0.0", react: "catalog:", shared: "workspace:*" } },
    { file: "b/package.json", deps: { zod: "^4.0.0", react: "catalog:", shared: "workspace:*" } },
  ]);
  assert.equal(dependencies.length, 3);
  assert.equal(mismatches.length, 1);
  assert.ok(mismatches[0].startsWith("zod:"));
  assert.equal(findings[0].code, "version-mismatch");
});

test("architecture validator detects unregistered routers and missing jsonSafe", () => {
  const index = file("artifacts/api-server/src/routes/index.ts", 'import a from "./good";');
  const good = file("artifacts/api-server/src/routes/good.ts", 'import { jsonSafe } from "../lib/jsonSafe"; XResponse.parse(jsonSafe(x));');
  const rogue = file("artifacts/api-server/src/routes/rogue.ts", "XResponse.parse(x);");
  const corelock = file("artifacts/api-server/src/lib/corelock.ts", "");
  const guardian = file("artifacts/api-server/src/lib/guardian.ts", "");
  const governor = file("artifacts/api-server/src/lib/governor.ts", "");
  const results = computeArchitectureResults([index, good, rogue, corelock, guardian, governor], 10);
  const byRule = new Map(results.map((r) => [r.rule, r]));
  assert.equal(byRule.get("all-routers-registered")!.passed, false);
  assert.ok(byRule.get("all-routers-registered")!.detail.includes("rogue.ts"));
  assert.equal(byRule.get("responses-use-jsonsafe")!.passed, false);
  assert.equal(byRule.get("locked-core-protection-present")!.passed, true);
  assert.equal(byRule.get("governance-chain-present")!.passed, true);
  assert.equal(byRule.get("api-surface-nonempty")!.passed, true);
});

test("refactoring engine maps finding severity to improvement priority", () => {
  const critical = findingToImprovement({ code: "file-too-large", severity: "critical", file: "x.ts", message: "700 lines" });
  const warning = findingToImprovement({ code: "todo-markers", severity: "warning", file: "y.ts", message: "2 markers" });
  assert.equal(critical.priority, "high");
  assert.equal(warning.priority, "medium");
  assert.equal(critical.risk, "low");
  assert.ok(critical.problem.includes("x.ts"));
});
