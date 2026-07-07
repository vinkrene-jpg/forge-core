// Architecture Validator: checks Forge's own architecture rules against the
// current self-model and source. Read-only.

import { scanSourceFiles, type ScannedFile } from "./codeScan";
import { scanSelf } from "./selfAwareness";
import { audit } from "./audit";

export interface RuleResult {
  rule: string;
  passed: boolean;
  detail: string;
}

export interface ArchitectureValidation {
  generatedAt: string;
  rulesChecked: number;
  passed: boolean;
  violations: number;
  results: RuleResult[];
}

export function computeArchitectureResults(files: ScannedFile[], endpointCount: number): RuleResult[] {
  const results: RuleResult[] = [];
  const byFile = new Map(files.map((f) => [f.file, f.content]));

  // 1. Every route file is registered in routes/index.ts.
  const indexContent = byFile.get("artifacts/api-server/src/routes/index.ts") ?? "";
  const routeFiles = files
    .map((f) => f.file)
    .filter((f) => f.startsWith("artifacts/api-server/src/routes/") && !f.endsWith("/index.ts"));
  const unregistered = routeFiles.filter((f) => {
    const base = f.split("/").pop()!.replace(".ts", "");
    return !indexContent.includes(`./${base}`);
  });
  results.push({
    rule: "all-routers-registered",
    passed: unregistered.length === 0,
    detail: unregistered.length === 0 ? `${routeFiles.length} route file(s) all registered in routes/index.ts` : `Unregistered: ${unregistered.join(", ")}`,
  });

  // 2. Route files validating responses with Zod must wrap data in jsonSafe
  //    (Drizzle Date columns otherwise 500 at runtime).
  const parseWithoutJsonSafe = routeFiles.filter((f) => {
    const c = byFile.get(f) ?? "";
    return /Response\.parse\(/.test(c) && !c.includes("jsonSafe");
  });
  results.push({
    rule: "responses-use-jsonsafe",
    passed: parseWithoutJsonSafe.length === 0,
    detail:
      parseWithoutJsonSafe.length === 0
        ? "every route file that parses responses imports jsonSafe"
        : `Missing jsonSafe: ${parseWithoutJsonSafe.join(", ")}`,
  });

  // 3. No console.log in server source (structured logger is mandatory).
  const consoleFiles = files
    .filter((f) => f.file.startsWith("artifacts/api-server/src/") && !f.file.includes("/tests/") && /console\.log\(/.test(f.content))
    .map((f) => f.file);
  results.push({
    rule: "no-console-log-in-server",
    passed: consoleFiles.length === 0,
    detail: consoleFiles.length === 0 ? "no console.log in server source" : `console.log found in: ${consoleFiles.join(", ")}`,
  });

  // 4. Locked Core protection present.
  const corelockPresent = byFile.has("artifacts/api-server/src/lib/corelock.ts");
  results.push({
    rule: "locked-core-protection-present",
    passed: corelockPresent,
    detail: corelockPresent ? "corelock.ts present" : "corelock.ts missing",
  });

  // 5. Governance chain present (guardian + governor + rollback support).
  const governance = ["guardian.ts", "governor.ts"].filter((f) => !byFile.has(`artifacts/api-server/src/lib/${f}`));
  results.push({
    rule: "governance-chain-present",
    passed: governance.length === 0,
    detail: governance.length === 0 ? "guardian.ts and governor.ts present" : `Missing: ${governance.join(", ")}`,
  });

  // 6. API surface exists (contract-first server actually exposes endpoints).
  results.push({
    rule: "api-surface-nonempty",
    passed: endpointCount > 0,
    detail: `${endpointCount} endpoint(s) in the self-model`,
  });

  return results;
}

export async function validateArchitecture(): Promise<ArchitectureValidation> {
  const files = scanSourceFiles();
  const model = scanSelf();
  const results = computeArchitectureResults(files, model.endpoints.length);
  const violations = results.filter((r) => !r.passed).length;
  const report: ArchitectureValidation = {
    generatedAt: new Date().toISOString(),
    rulesChecked: results.length,
    passed: violations === 0,
    violations,
    results,
  };
  await audit({
    actor: "architecture-validator",
    action: "architecture_validated",
    targetType: "analysis",
    details: `${results.length} rule(s) checked; ${violations} violation(s).`,
    outcome: violations === 0 ? "allowed" : "blocked",
  });
  return report;
}
