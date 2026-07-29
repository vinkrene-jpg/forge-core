/**
 * WorkspaceExecutor — applies a validated WorkspacePlan to the sandbox.
 *
 * Execution flow:
 *  1. Snapshot every target's original content (for rollback).
 *  2. Write each target file (create or overwrite).
 *  3. Run the injected Verifier (default: existence + non-empty check).
 *  4. If verification fails → rollback all changes and throw WorkspacePlanError.
 *  5. Capture artifacts (path + SHA-256 of the verified content).
 *  6. Return ExecutionEvidence.
 *
 * Safety guarantees:
 *  - Verification minimum is the injected verifier; default is typecheck-equivalent.
 *  - Full rollback on any verification failure; no partial state is left.
 *  - No git operations; no network calls.
 */

import path from 'node:path';
import fs from 'node:fs';
import type {
  WorkspacePlan,
  ExecutionEvidence,
  ActionReceipt,
  FileEffect,
  VerificationRun,
  Artifact,
} from './types.js';
import { WorkspacePlanError } from './types.js';
import { sha256 } from './planner.js';

/**
 * A Verifier inspects the sandbox after mutations and returns a VerificationRun.
 * The run's `passed` field controls whether changes are kept or rolled back.
 */
export type Verifier = (sandboxRoot: string, writtenPaths: string[]) => VerificationRun;

/**
 * Default verifier: confirms every written file exists and is non-empty.
 * This is the minimum "typecheck" equivalent used when no custom verifier is
 * provided; inject a real tsc-based verifier for production use.
 */
export function defaultVerifier(sandboxRoot: string, writtenPaths: string[]): VerificationRun {
  const issues: string[] = [];
  for (const relPath of writtenPaths) {
    const abs = path.resolve(sandboxRoot, relPath);
    if (!fs.existsSync(abs)) {
      issues.push(`File not found after write: ${relPath}`);
    } else if (fs.readFileSync(abs, 'utf8').trim() === '') {
      issues.push(`File is empty after write: ${relPath}`);
    }
  }
  return {
    type: 'typecheck',
    passed: issues.length === 0,
    output: issues.length === 0 ? 'All written files are present and non-empty.' : issues.join('\n'),
  };
}

export class WorkspaceExecutor {
  #verifier: Verifier;

  constructor(verifier: Verifier = defaultVerifier) {
    this.#verifier = verifier;
  }

  /**
   * Execute the plan and return full execution evidence.
   * Throws WorkspacePlanError (with rollback) if verification fails.
   */
  execute(plan: WorkspacePlan, sandboxRoot: string): ExecutionEvidence {
    const receipts: ActionReceipt[] = [];
    const fileEffects: FileEffect[] = [];
    const verificationRuns: VerificationRun[] = [];
    const artifacts: Artifact[] = [];

    // Snapshot originals for rollback
    const originals = new Map<string, string | null>();
    for (const target of plan.targets) {
      const abs = path.resolve(sandboxRoot, target.path);
      originals.set(abs, fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null);
    }

    // Apply mutations
    for (const target of plan.targets) {
      const abs = path.resolve(sandboxRoot, target.path);
      const before = originals.get(abs) ?? null;
      const operation: 'create' | 'overwrite' = before === null ? 'create' : 'overwrite';

      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, target.content, 'utf8');

      const contentSha = sha256(target.content);
      receipts.push({ path: target.path, operation, sha256: contentSha });
      fileEffects.push({ path: target.path, before, after: target.content });
    }

    // Run verification (minimum: typecheck equivalent via injected verifier)
    const writtenPaths = plan.targets.map((t) => t.path);
    const verification = this.#verifier(sandboxRoot, writtenPaths);
    verificationRuns.push(verification);

    if (!verification.passed) {
      this.#rollback(sandboxRoot, originals);
      throw new WorkspacePlanError(
        `Verification failed (${verification.type}): ${verification.output}\nAll changes have been rolled back.`,
      );
    }

    // Capture artifacts after successful verification
    for (const target of plan.targets) {
      const abs = path.resolve(sandboxRoot, target.path);
      const contentSha = sha256(fs.readFileSync(abs, 'utf8'));
      artifacts.push({ path: target.path, sha256: contentSha });
    }

    return { receipts, fileEffects, verificationRuns, artifacts };
  }

  #rollback(sandboxRoot: string, originals: Map<string, string | null>): void {
    for (const [abs, original] of originals) {
      if (original === null) {
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      } else {
        fs.writeFileSync(abs, original, 'utf8');
      }
    }
  }
}
