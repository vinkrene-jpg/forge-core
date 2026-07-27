import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveAuthorityLevel,
  detectAbsoluteStopReasons,
  parseEvolutionManifest,
  pathAllowedForAuthority,
} from "../lib/selfEvolutionPolicyCore";

const manifest = {
  name: "safe-module",
  version: "0.1.0",
  paths: ["index.js"],
  scope: "sandbox-only" as const,
  actions: [],
  acceptance: ["typecheck", "build", "unit", "scope-integrity"],
};

test("trust ladder starts narrow and expands only after clean successes", () => {
  assert.equal(deriveAuthorityLevel({ successfulReleases: 0, scopeViolations: 0 }), "sandbox-only");
  assert.equal(deriveAuthorityLevel({ successfulReleases: 3, scopeViolations: 0 }), "isolated-module-root");
  assert.equal(deriveAuthorityLevel({ successfulReleases: 10, scopeViolations: 0 }), "bounded-extension-root");
  assert.equal(deriveAuthorityLevel({ successfulReleases: 100, scopeViolations: 1 }), "sandbox-only");
});

test("sandbox authority blocks protected and escaping paths", () => {
  assert.equal(pathAllowedForAuthority("index.js", "sandbox-only", "sandbox-only"), true);
  assert.equal(pathAllowedForAuthority("../evil.js", "sandbox-only", "sandbox-only"), false);
  assert.equal(pathAllowedForAuthority("core/guardian.ts", "sandbox-only", "sandbox-only"), false);
  assert.equal(pathAllowedForAuthority("extensions/isolated/x.ts", "isolated-module-root", "sandbox-only"), false);
});

test("absolute stop actions and content are detected", () => {
  const dangerous = {
    ...manifest,
    actions: ["production-deploy"],
  };
  const reasons = detectAbsoluteStopReasons(dangerous, [
    { path: "index.js", content: "console.log('safe')" },
  ]);
  assert.ok(reasons.some((reason) => reason.includes("production-deploy")));

  const contentReasons = detectAbsoluteStopReasons(manifest, [
    { path: "migration.sql", content: "DROP TABLE users;" },
  ]);
  assert.ok(contentReasons.length >= 1);
});

test("manifest parser requires machine-testable scope, actions and acceptance", () => {
  const parsed = parseEvolutionManifest(JSON.stringify(manifest));
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.manifest?.scope, "sandbox-only");

  const invalid = parseEvolutionManifest(JSON.stringify({ name: "x", version: "1", paths: [] }));
  assert.ok(invalid.errors.length >= 1);
});