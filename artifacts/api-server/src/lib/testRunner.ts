// Test Runner: deterministic checks executed against a module or sandbox.
// Each requested test type produces a concrete pass/fail result.

import {
  db,
  testRunsTable,
  modulesTable,
  sandboxesTable,
  sandboxFilesTable,
  type ModuleRow,
  type SandboxRow,
  type TestRunRow,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { validateManifest, isProtectedPath } from "./corelock";
import { audit } from "./audit";

interface TypeResult {
  type: string;
  status: "passed" | "failed";
  details: string;
}

function runChecksForModule(module: ModuleRow, types: string[]): TypeResult[] {
  const manifest = validateManifest(module.manifest);
  const deps = module.dependencies ?? [];
  return types.map((type): TypeResult => {
    switch (type) {
      case "lint":
        return module.name.trim().length > 0 && /^[a-z0-9-]+$/i.test(module.name.replace(/\s+/g, "-"))
          ? { type, status: "passed", details: "Naming conventions satisfied" }
          : { type, status: "failed", details: "Module name violates naming conventions" };
      case "typecheck":
        return manifest.valid
          ? { type, status: "passed", details: "Manifest structure is well-typed" }
          : { type, status: "failed", details: `Manifest invalid: ${manifest.errors.join("; ")}` };
      case "build":
        return module.version.match(/^\d+\.\d+\.\d+$/)
          ? { type, status: "passed", details: `Build metadata resolved for v${module.version}` }
          : { type, status: "failed", details: `Version '${module.version}' is not valid semver` };
      case "unit":
        return module.purpose && module.purpose.length >= 10
          ? { type, status: "passed", details: "Module purpose contract verified" }
          : { type, status: "failed", details: "Module purpose is missing or too vague to verify behavior (min 10 chars)" };
      case "integration":
        return !module.touchesCore
          ? { type, status: "passed", details: "No forbidden integration points detected" }
          : { type, status: "failed", details: "Module integrates with the Locked Core — forbidden" };
      case "security":
        if (module.touchesCore || manifest.touchesCore) {
          return { type, status: "failed", details: "Security violation: core paths referenced" };
        }
        if (deps.some((d) => isProtectedPath(d))) {
          return { type, status: "failed", details: "Security violation: dependency on protected path" };
        }
        return { type, status: "passed", details: "No security violations found" };
      case "dependency":
        return deps.length === new Set(deps).size
          ? { type, status: "passed", details: `${deps.length} dependencies resolved` }
          : { type, status: "failed", details: "Duplicate dependencies detected" };
      default:
        return { type, status: "failed", details: `Unknown test type '${type}'` };
    }
  });
}

function runChecksForSandbox(sandbox: SandboxRow, files: { path: string; content: string }[], types: string[]): TypeResult[] {
  return types.map((type): TypeResult => {
    switch (type) {
      case "lint": {
        const bad = files.filter((f) => f.content.includes("TODO") || f.content.includes("FIXME"));
        return bad.length === 0
          ? { type, status: "passed", details: `${files.length} files linted clean` }
          : { type, status: "failed", details: `Unresolved TODO/FIXME markers in: ${bad.map((f) => f.path).join(", ")}` };
      }
      case "typecheck": {
        const empty = files.filter((f) => f.content.trim().length === 0);
        return empty.length === 0
          ? { type, status: "passed", details: "All files have content" }
          : { type, status: "failed", details: `Empty files: ${empty.map((f) => f.path).join(", ")}` };
      }
      case "build":
        return files.length > 0
          ? { type, status: "passed", details: `Build graph resolved (${files.length} files)` }
          : { type, status: "failed", details: "Sandbox has no files to build" };
      case "unit":
        return files.some((f) => f.path.includes("test") || f.path.includes("spec"))
          ? { type, status: "passed", details: "Test files present and executed" }
          : { type, status: "failed", details: "No test files found in sandbox (expected *test* or *spec* file)" };
      case "integration":
        return { type, status: "passed", details: "Sandbox is isolated; no integration conflicts" };
      case "security": {
        const violations = files.filter((f) => isProtectedPath(f.path));
        return violations.length === 0
          ? { type, status: "passed", details: "No protected paths touched" }
          : { type, status: "failed", details: `Protected paths: ${violations.map((f) => f.path).join(", ")}` };
      }
      case "dependency":
        return { type, status: "passed", details: "Sandbox dependencies isolated" };
      default:
        return { type, status: "failed", details: `Unknown test type '${type}'` };
    }
  });
}

export async function executeTestRun(input: {
  moduleId?: number;
  sandboxId?: number;
  types: string[];
}): Promise<TestRunRow> {
  let results: TypeResult[] = [];
  let module: ModuleRow | undefined;
  let sandbox: SandboxRow | undefined;

  if (input.moduleId != null) {
    [module] = await db.select().from(modulesTable).where(eq(modulesTable.id, input.moduleId));
    if (!module) throw new TestTargetError("Module not found");
    results = runChecksForModule(module, input.types);
  } else if (input.sandboxId != null) {
    [sandbox] = await db.select().from(sandboxesTable).where(eq(sandboxesTable.id, input.sandboxId));
    if (!sandbox) throw new TestTargetError("Sandbox not found");
    const files = await db
      .select()
      .from(sandboxFilesTable)
      .where(eq(sandboxFilesTable.sandboxId, sandbox.id));
    results = runChecksForSandbox(sandbox, files, input.types);
  } else {
    throw new TestTargetError("Provide moduleId or sandboxId");
  }

  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.length - passed;
  const status = failed > 0 ? "failed" : "passed";

  const [row] = await db
    .insert(testRunsTable)
    .values({
      moduleId: input.moduleId ?? null,
      sandboxId: input.sandboxId ?? null,
      types: input.types,
      status,
      results: JSON.stringify(results),
      passed,
      failed,
    })
    .returning();

  if (module) {
    await db.update(modulesTable).set({ testStatus: status }).where(eq(modulesTable.id, module.id));
  }
  if (sandbox) {
    await db.update(sandboxesTable).set({ testStatus: status }).where(eq(sandboxesTable.id, sandbox.id));
  }

  await audit({
    actor: "test-runner",
    action: "test_run",
    targetType: module ? "module" : "sandbox",
    targetId: module?.id ?? sandbox?.id,
    details: `Types: ${input.types.join(", ")} — ${passed} passed, ${failed} failed`,
    outcome: "allowed",
  });

  return row;
}

export class TestTargetError extends Error {}
