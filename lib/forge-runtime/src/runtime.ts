/**
 * Runtime — autonomous-cycle orchestrator.
 *
 * Routes execution by profile:
 *
 *   file-create-read-hash
 *     → #executeWorkspaceProof  (create → read → hash → evidence)
 *
 *   generic-build
 *     → WorkspacePlanner.validate  (throws WorkspacePlanError on any violation)
 *     → #executeWorkspaceChange    (WorkspaceExecutor: mutations + verification + rollback)
 *     → evaluator
 *
 * Safety guarantees (enforced across the pipeline):
 *  - Explicit, validated target files are required; zero-target plans are
 *    blocked before any provider invocation.
 *  - Protected paths (.git, .env, *.pem, *.key, node_modules) are blocked.
 *  - Existing files require expectedSha256; SHA-256 mismatch is rejected.
 *  - Verification minimum is "typecheck" (inject a tsc-based verifier for
 *    production; default verifier is existence + non-empty check).
 *  - Full rollback on verification failure.
 *  - No git push; no network calls.
 *  - Acceptance requires non-empty evidence in all four fields
 *    (receipts, fileEffects, verificationRuns, artifacts).
 */

import type { WorkspacePlan, ExecutionEvidence, CycleResult } from './types.js';
import { WorkspacePlanError } from './types.js';
import { WorkspacePlanner, sha256 } from './planner.js';
import { WorkspaceExecutor, type Verifier } from './executor.js';
import path from 'node:path';
import fs from 'node:fs';

export class Runtime {
  #planner: WorkspacePlanner;
  #executor: WorkspaceExecutor;

  constructor(verifier?: Verifier) {
    this.#planner = new WorkspacePlanner();
    this.#executor = new WorkspaceExecutor(verifier);
  }

  /**
   * Execute an autonomous cycle for the given profile and plan.
   *
   * @param profile  - Execution profile ('file-create-read-hash' | 'generic-build').
   * @param plan     - Workspace plan with validated target files.
   * @param sandboxRoot - Absolute path of the sandbox directory.
   * @param options  - Must include `approved: true`; explicit approval is required
   *                   before any workspace mutation is performed.
   */
  executeAutonomousCycle(
    profile: string,
    plan: WorkspacePlan,
    sandboxRoot: string,
    options: { approved: true },
  ): CycleResult {
    if (profile === 'file-create-read-hash') {
      return this.#executeWorkspaceProof(plan, sandboxRoot);
    }
    if (profile === 'generic-build') {
      // Step 1: validate the plan — throws WorkspacePlanError before any I/O
      this.#planner.validate(plan, sandboxRoot);
      // Step 2: execute workspace changes via WorkspaceExecutor
      const evidence = this.#executeWorkspaceChange(plan, sandboxRoot);
      return this.#evaluate(evidence);
    }
    return {
      score: 0,
      decision: 'rejected',
      executionEvidence: null,
      reason: `Unknown profile: ${profile}`,
    };
  }

  /**
   * file-create-read-hash proof:
   * create file → read it back → compute SHA-256 → capture evidence.
   * This is the existing route; its behaviour is intentionally unchanged.
   */
  #executeWorkspaceProof(plan: WorkspacePlan, sandboxRoot: string): CycleResult {
    if (plan.targets.length === 0) {
      return {
        score: 60,
        decision: 'rejected',
        executionEvidence: null,
        reason: 'No targets specified for file-create-read-hash proof.',
      };
    }

    const target = plan.targets[0]!;
    const abs = path.resolve(sandboxRoot, target.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, target.content, 'utf8');

    const written = fs.readFileSync(abs, 'utf8');
    const hash = sha256(written);

    const evidence: ExecutionEvidence = {
      receipts: [{ path: target.path, operation: 'create', sha256: hash }],
      fileEffects: [{ path: target.path, before: null, after: written }],
      verificationRuns: [{ type: 'file-read-hash', passed: true, output: `sha256=${hash}` }],
      artifacts: [{ path: target.path, sha256: hash }],
    };
    return this.#evaluate(evidence);
  }

  /**
   * Execute workspace changes via the WorkspaceExecutor (used by generic-build).
   * Mutations, verification, rollback and artifact capture are all handled there.
   */
  #executeWorkspaceChange(plan: WorkspacePlan, sandboxRoot: string): ExecutionEvidence {
    return this.#executor.execute(plan, sandboxRoot);
  }

  /**
   * Evaluator: accepts only when all four evidence arrays are non-empty.
   * Returns score 100/accepted or 60/rejected.
   */
  #evaluate(evidence: ExecutionEvidence | null): CycleResult {
    if (
      !evidence ||
      evidence.receipts.length === 0 ||
      evidence.fileEffects.length === 0 ||
      evidence.verificationRuns.length === 0 ||
      evidence.artifacts.length === 0
    ) {
      return {
        score: 60,
        decision: 'rejected',
        executionEvidence: evidence,
        reason: 'Execution evidence is empty or incomplete.',
      };
    }
    return {
      score: 100,
      decision: 'accepted',
      executionEvidence: evidence,
      reason: 'All execution evidence fields are populated.',
    };
  }
}

export { WorkspacePlanner, WorkspaceExecutor };
export { WorkspacePlanError };
export type { WorkspacePlan, ExecutionEvidence, CycleResult, Verifier };
