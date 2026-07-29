/**
 * Shared types for the forge-runtime autonomous-cycle pipeline.
 */

export type Profile = 'file-create-read-hash' | 'generic-build';

/** A single file that the executor should write inside the sandbox. */
export interface FileTarget {
  /** Path relative to the sandbox root. */
  path: string;
  /** Content to write. */
  content: string;
  /**
   * SHA-256 hex of the *current* file content.
   * Required when the file already exists; prevents accidental overwrites.
   */
  expectedSha256?: string;
}

/** Validated plan produced by the WorkspacePlanner. */
export interface WorkspacePlan {
  profile: Profile;
  targets: FileTarget[];
}

/** Proof that a single file mutation was applied. */
export interface ActionReceipt {
  path: string;
  operation: 'create' | 'overwrite';
  /** SHA-256 hex of the content that was written. */
  sha256: string;
}

/** Before/after snapshot of one file. */
export interface FileEffect {
  path: string;
  /** null when the file did not exist before the mutation. */
  before: string | null;
  after: string;
}

/** Result of one verification pass (typecheck, lint, …). */
export interface VerificationRun {
  type: string;
  passed: boolean;
  output: string;
}

/** Immutable artifact captured after successful verification. */
export interface Artifact {
  path: string;
  /** SHA-256 hex of the artifact content as it exists after verification. */
  sha256: string;
}

/**
 * All evidence collected during a workspace execution cycle.
 * All four arrays must be non-empty for the evaluator to accept the result.
 */
export interface ExecutionEvidence {
  receipts: ActionReceipt[];
  fileEffects: FileEffect[];
  verificationRuns: VerificationRun[];
  artifacts: Artifact[];
}

/** Final result returned by Runtime.executeAutonomousCycle. */
export interface CycleResult {
  /** 100 = accepted, 60 = rejected. */
  score: number;
  decision: 'accepted' | 'rejected';
  executionEvidence: ExecutionEvidence | null;
  reason: string;
}

/** Thrown when the workspace plan is invalid or a safety check fails. */
export class WorkspacePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspacePlanError';
  }
}
