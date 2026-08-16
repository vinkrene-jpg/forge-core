export type ExerciseSourceKind = "exercism";

export interface ExerciseFile {
  readonly path: string;
  readonly content: string;
  readonly sha256: string;
}

export interface ExerciseRecord {
  readonly id: string;
  readonly source: Readonly<{
    kind: ExerciseSourceKind;
    repository: string;
    revision: string;
    track: string;
    exercise: string;
  }>;
  readonly language: string;
  readonly title: string;
  readonly instructions: string;
  readonly difficulty: number;
  readonly concepts: readonly string[];
  readonly prerequisites: readonly string[];
  readonly starterFiles: readonly ExerciseFile[];
  readonly testFiles: readonly ExerciseFile[];
  readonly importedAt: string;
}

export interface ExerciseAttemptRecord {
  readonly id: string;
  readonly exerciseId: string;
  readonly missionId: string;
  readonly attemptNumber: number;
  readonly status: "running" | "passed" | "failed";
  readonly durationMs: number | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly upstreamTestCommand: readonly string[];
  readonly upstreamTestsSha256: string;
  readonly verification: Readonly<{
    readonly exitCode: number;
    readonly passed: boolean;
    readonly testFilesUnchanged: boolean;
  }> | null;
}

export interface ExerciseRegistrySummary {
  readonly exercises: number;
  readonly attempts: number;
  readonly passed: number;
  readonly failed: number;
  readonly remaining: number;
}

export interface ExerciseSolutionFile {
  readonly path: string;
  readonly content: string;
}

export interface ExerciseRunResult {
  readonly command: readonly string[];
  readonly exitCode: number;
  readonly durationMs: number;
  readonly testsSha256Before: string;
  readonly testsSha256After: string;
  readonly image: string | null;
  readonly containerId: string | null;
}

export interface ExerciseRunner {
  run(
    exercise: ExerciseRecord,
    solutionFiles: readonly ExerciseSolutionFile[],
    signal: AbortSignal,
  ): Promise<ExerciseRunResult>;
}