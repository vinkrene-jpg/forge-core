/**
 * Regression tests for lib/forge-runtime.
 *
 * Acceptance criteria covered:
 *  AC1  – generic-build creates at least one file in the sandbox.
 *  AC2  – executionEvidence.receipts.length > 0
 *  AC3  – executionEvidence.fileEffects.length > 0
 *  AC4  – executionEvidence.verificationRuns.length > 0
 *  AC5  – executionEvidence.artifacts.length > 0
 *  AC6  – evaluator returns score 100 / accepted
 *  AC7  – empty targets are blocked before any provider execution
 *  AC8  – protected-path (.git, .env) is blocked
 *  AC9  – rollback occurs when verification fails (new file removed; existing restored)
 *  AC10 – existing file-create-read-hash route stays green
 *
 * Additional safety tests:
 *  – path traversal is blocked
 *  – existing file without expectedSha256 is rejected
 *  – existing file with wrong expectedSha256 is rejected
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Runtime, WorkspacePlanError } from './runtime.js';
import { sha256 } from './planner.js';
import { defaultVerifier } from './executor.js';
import type { WorkspacePlan, VerificationRun } from './types.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeSandbox(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'forge-runtime-test-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Stub verifier that always passes (for happy-path tests). */
const passingVerifier = (_root: string, _paths: string[]): VerificationRun => ({
  type: 'typecheck',
  passed: true,
  output: 'stub: all checks passed',
});

/** Stub verifier that always fails (for rollback tests). */
const failingVerifier = (_root: string, _paths: string[]): VerificationRun => ({
  type: 'typecheck',
  passed: false,
  output: 'stub: type error injected for rollback test',
});

// ─── AC1–AC5: generic-build creates a file and populates all evidence fields ─

test('AC1+AC2+AC3+AC4+AC5: generic-build creates a file and populates all evidence fields', () => {
  const sandbox = makeSandbox();
  try {
    const runtime = new Runtime(passingVerifier);
    const plan: WorkspacePlan = {
      profile: 'generic-build',
      targets: [{ path: 'src/hello.ts', content: 'export const greeting = "hello";' }],
    };
    const result = runtime.executeAutonomousCycle('generic-build', plan, sandbox, { approved: true });

    assert.ok(
      fs.existsSync(path.join(sandbox, 'src', 'hello.ts')),
      'AC1: file was created in the sandbox',
    );

    const ev = result.executionEvidence;
    assert.ok(ev !== null, 'executionEvidence must not be null');
    assert.ok(ev!.receipts.length > 0, 'AC2: receipts.length > 0');
    assert.ok(ev!.fileEffects.length > 0, 'AC3: fileEffects.length > 0');
    assert.ok(ev!.verificationRuns.length > 0, 'AC4: verificationRuns.length > 0');
    assert.ok(ev!.artifacts.length > 0, 'AC5: artifacts.length > 0');

    assert.equal(ev!.receipts[0]!.operation, 'create');
    assert.equal(ev!.fileEffects[0]!.before, null, 'new file has no prior content');
    assert.equal(ev!.verificationRuns[0]!.passed, true);
  } finally {
    cleanup(sandbox);
  }
});

// ─── AC6: evaluator returns 100 / accepted ────────────────────────────────────

test('AC6: evaluator returns score 100 / accepted when all evidence fields are populated', () => {
  const sandbox = makeSandbox();
  try {
    const runtime = new Runtime(passingVerifier);
    const plan: WorkspacePlan = {
      profile: 'generic-build',
      targets: [{ path: 'output.js', content: 'console.log("ok");' }],
    };
    const result = runtime.executeAutonomousCycle('generic-build', plan, sandbox, { approved: true });
    assert.equal(result.score, 100, 'score must be 100');
    assert.equal(result.decision, 'accepted', 'decision must be accepted');
  } finally {
    cleanup(sandbox);
  }
});

// ─── AC7: empty targets blocked before provider invocation ────────────────────

test('AC7: empty targets are blocked before any execution', () => {
  const sandbox = makeSandbox();
  try {
    const runtime = new Runtime(passingVerifier);
    const plan: WorkspacePlan = { profile: 'generic-build', targets: [] };
    assert.throws(
      () => runtime.executeAutonomousCycle('generic-build', plan, sandbox, { approved: true }),
      WorkspacePlanError,
    );
    // No files should have been created
    assert.deepEqual(fs.readdirSync(sandbox), [], 'sandbox must remain empty');
  } finally {
    cleanup(sandbox);
  }
});

// ─── AC8: protected paths are blocked ─────────────────────────────────────────

test('AC8: .git path is blocked by protected-path rule', () => {
  const sandbox = makeSandbox();
  try {
    const runtime = new Runtime(passingVerifier);
    const plan: WorkspacePlan = {
      profile: 'generic-build',
      targets: [{ path: '.git/config', content: '[core]\n  bare = false' }],
    };
    assert.throws(
      () => runtime.executeAutonomousCycle('generic-build', plan, sandbox, { approved: true }),
      WorkspacePlanError,
    );
  } finally {
    cleanup(sandbox);
  }
});

test('AC8: .env is blocked by protected-path rule', () => {
  const sandbox = makeSandbox();
  try {
    const runtime = new Runtime(passingVerifier);
    const plan: WorkspacePlan = {
      profile: 'generic-build',
      targets: [{ path: '.env', content: 'SECRET=leaked' }],
    };
    assert.throws(
      () => runtime.executeAutonomousCycle('generic-build', plan, sandbox, { approved: true }),
      WorkspacePlanError,
    );
  } finally {
    cleanup(sandbox);
  }
});

// ─── AC9: rollback on verification failure ────────────────────────────────────

test('AC9: new file is rolled back when verification fails', () => {
  const sandbox = makeSandbox();
  try {
    const runtime = new Runtime(failingVerifier);
    const plan: WorkspacePlan = {
      profile: 'generic-build',
      targets: [{ path: 'should-be-rolled-back.ts', content: 'const x: string = 42;' }],
    };
    assert.throws(
      () => runtime.executeAutonomousCycle('generic-build', plan, sandbox, { approved: true }),
      WorkspacePlanError,
    );
    assert.ok(
      !fs.existsSync(path.join(sandbox, 'should-be-rolled-back.ts')),
      'AC9: new file must be removed after rollback',
    );
  } finally {
    cleanup(sandbox);
  }
});

test('AC9: pre-existing file content is restored after rollback', () => {
  const sandbox = makeSandbox();
  try {
    const original = 'const a = 1;';
    const filePath = path.join(sandbox, 'existing.ts');
    fs.writeFileSync(filePath, original, 'utf8');
    const currentSha = sha256(original);

    const runtime = new Runtime(failingVerifier);
    const plan: WorkspacePlan = {
      profile: 'generic-build',
      targets: [{ path: 'existing.ts', content: 'const b = 2;', expectedSha256: currentSha }],
    };
    assert.throws(
      () => runtime.executeAutonomousCycle('generic-build', plan, sandbox, { approved: true }),
      WorkspacePlanError,
    );
    assert.equal(
      fs.readFileSync(filePath, 'utf8'),
      original,
      'AC9: original content must be restored after rollback',
    );
  } finally {
    cleanup(sandbox);
  }
});

// ─── AC10: file-create-read-hash route stays green ────────────────────────────

test('AC10: file-create-read-hash route returns 100/accepted with full evidence', () => {
  const sandbox = makeSandbox();
  try {
    const runtime = new Runtime(passingVerifier);
    const plan: WorkspacePlan = {
      profile: 'file-create-read-hash',
      targets: [{ path: 'proof.txt', content: 'hello world' }],
    };
    const result = runtime.executeAutonomousCycle('file-create-read-hash', plan, sandbox, {
      approved: true,
    });
    assert.equal(result.score, 100, 'score must be 100');
    assert.equal(result.decision, 'accepted', 'decision must be accepted');

    const ev = result.executionEvidence!;
    assert.ok(ev.receipts.length > 0, 'receipts must be non-empty');
    assert.ok(ev.fileEffects.length > 0, 'fileEffects must be non-empty');
    assert.ok(ev.verificationRuns.length > 0, 'verificationRuns must be non-empty');
    assert.ok(ev.artifacts.length > 0, 'artifacts must be non-empty');

    assert.ok(
      fs.existsSync(path.join(sandbox, 'proof.txt')),
      'proof.txt must exist in sandbox',
    );
  } finally {
    cleanup(sandbox);
  }
});

// ─── Safety: path traversal ───────────────────────────────────────────────────

test('Safety: path traversal outside sandbox root is blocked', () => {
  const sandbox = makeSandbox();
  try {
    const runtime = new Runtime(passingVerifier);
    const plan: WorkspacePlan = {
      profile: 'generic-build',
      targets: [{ path: '../../../etc/passwd', content: 'hacked' }],
    };
    assert.throws(
      () => runtime.executeAutonomousCycle('generic-build', plan, sandbox, { approved: true }),
      WorkspacePlanError,
    );
  } finally {
    cleanup(sandbox);
  }
});

// ─── Safety: existing file guards ─────────────────────────────────────────────

test('Safety: existing file without expectedSha256 is rejected', () => {
  const sandbox = makeSandbox();
  try {
    fs.writeFileSync(path.join(sandbox, 'existing.ts'), 'const a = 1;', 'utf8');

    const runtime = new Runtime(passingVerifier);
    const plan: WorkspacePlan = {
      profile: 'generic-build',
      targets: [{ path: 'existing.ts', content: 'const b = 2;' }],
    };
    assert.throws(
      () => runtime.executeAutonomousCycle('generic-build', plan, sandbox, { approved: true }),
      WorkspacePlanError,
    );
  } finally {
    cleanup(sandbox);
  }
});

test('Safety: existing file with wrong expectedSha256 is rejected', () => {
  const sandbox = makeSandbox();
  try {
    fs.writeFileSync(path.join(sandbox, 'existing.ts'), 'const a = 1;', 'utf8');

    const runtime = new Runtime(passingVerifier);
    const plan: WorkspacePlan = {
      profile: 'generic-build',
      targets: [{ path: 'existing.ts', content: 'const b = 2;', expectedSha256: 'wrong-hash-value' }],
    };
    assert.throws(
      () => runtime.executeAutonomousCycle('generic-build', plan, sandbox, { approved: true }),
      WorkspacePlanError,
    );
  } finally {
    cleanup(sandbox);
  }
});

// ─── defaultVerifier ──────────────────────────────────────────────────────────

test('defaultVerifier passes when all files are present and non-empty', () => {
  const sandbox = makeSandbox();
  try {
    const filePath = path.join(sandbox, 'ok.ts');
    fs.writeFileSync(filePath, 'export {};', 'utf8');

    const result = defaultVerifier(sandbox, ['ok.ts']);
    assert.equal(result.passed, true);
  } finally {
    cleanup(sandbox);
  }
});

test('defaultVerifier fails when a written file is missing', () => {
  const sandbox = makeSandbox();
  try {
    const result = defaultVerifier(sandbox, ['missing.ts']);
    assert.equal(result.passed, false);
    assert.ok(result.output.includes('missing.ts'));
  } finally {
    cleanup(sandbox);
  }
});
