/**
 * WorkspacePlanner — validates a WorkspacePlan before any file mutations occur.
 *
 * Safety guarantees enforced here:
 *  - At least one explicit target is required; zero-target plans are blocked.
 *  - The target count may not exceed MAX_TARGETS.
 *  - No target path may escape the sandbox root (path traversal blocked).
 *  - Protected paths (.git, .env, *.pem, *.key, node_modules) are blocked.
 *  - When a target file already exists, expectedSha256 is mandatory and must
 *    match the file's current SHA-256 digest.
 */

import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { WorkspacePlan, FileTarget } from './types.js';
import { WorkspacePlanError } from './types.js';

/** Patterns that match paths considered protected from autonomous mutation. */
const PROTECTED_PATTERNS: RegExp[] = [
  /^\.git(\/|$)/,
  /^\.env(\..*)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /node_modules(\/|$)/,
];

/** Compute the SHA-256 hex digest of a UTF-8 string. */
export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Return true when the given relative path matches a protected pattern. */
export function isProtected(relPath: string): boolean {
  return PROTECTED_PATTERNS.some((p) => p.test(relPath));
}

export class WorkspacePlanner {
  static readonly MAX_TARGETS = 100;

  /**
   * Validate a plan against the sandbox root.
   * Throws WorkspacePlanError on any violation.
   */
  validate(plan: WorkspacePlan, sandboxRoot: string): void {
    if (plan.targets.length === 0) {
      throw new WorkspacePlanError(
        'No targets specified; execution blocked before provider invocation. ' +
          'Provide at least one explicit target file.',
      );
    }
    if (plan.targets.length > WorkspacePlanner.MAX_TARGETS) {
      throw new WorkspacePlanError(
        `Target count ${plan.targets.length} exceeds the maximum allowed (${WorkspacePlanner.MAX_TARGETS}).`,
      );
    }
    for (const target of plan.targets) {
      this.#validateTarget(target, sandboxRoot);
    }
  }

  #validateTarget(target: FileTarget, sandboxRoot: string): void {
    const absRoot = path.resolve(sandboxRoot);
    const abs = path.resolve(absRoot, target.path);

    // Block path traversal outside sandbox
    if (!abs.startsWith(absRoot + path.sep)) {
      throw new WorkspacePlanError(
        `Target path escapes the sandbox root: ${target.path}`,
      );
    }

    // Block protected paths
    if (isProtected(target.path)) {
      throw new WorkspacePlanError(
        `Target path is protected and may not be modified autonomously: ${target.path}`,
      );
    }

    // Existing files require expectedSha256
    if (fs.existsSync(abs)) {
      if (!target.expectedSha256) {
        throw new WorkspacePlanError(
          `Target ${target.path} already exists; expectedSha256 is required to prevent accidental overwrites.`,
        );
      }
      const actual = sha256(fs.readFileSync(abs, 'utf8'));
      if (actual !== target.expectedSha256) {
        throw new WorkspacePlanError(
          `SHA-256 mismatch for ${target.path}: expected ${target.expectedSha256}, got ${actual}.`,
        );
      }
    }
  }
}
