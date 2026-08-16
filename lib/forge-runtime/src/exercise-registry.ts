import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RuntimeEventBus } from "./event-bus";
import type { ExerciseAttemptRecord, ExerciseRecord, ExerciseRegistrySummary, ExerciseRunResult } from "./exercise";
import {
  createInitialExerciseState,
  EXERCISE_STORE_VERSION,
  FileExerciseStateStore,
  type ExerciseStateStore,
  type PersistedExerciseState,
} from "./exercise-store";

interface ExercismTrackExercise {
  readonly slug: string;
  readonly name?: string;
  readonly difficulty: number;
  readonly practices?: readonly string[];
  readonly prerequisites?: readonly string[];
}

interface ExercismExerciseConfig {
  readonly files: Readonly<{
    readonly solution: readonly string[];
    readonly test: readonly string[];
  }>;
}

export interface ExercismTrackCheckout {
  readonly rootPath: string;
  readonly repository: string;
  readonly revision: string;
  cleanup(): Promise<void>;
}

export interface ExercismTrackSource {
  checkout(track: string): Promise<ExercismTrackCheckout>;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function safeRelativePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (normalized.length === 0 || path.isAbsolute(value) || normalized.split("/").includes("..")) {
    throw new Error(`Unsafe Exercism file path: ${value}`);
  }
  return normalized;
}

async function runGit(args: readonly string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve(stdout.trim())
      : reject(new Error(`Exercism acquisition failed (${code ?? 1}): ${stderr.slice(0, 500)}`)));
  });
}

export class GitHubExercismTrackSource implements ExercismTrackSource {
  async checkout(track: string): Promise<ExercismTrackCheckout> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(track)) {
      throw new Error("Exercism track has an invalid format");
    }
    const repository = `https://github.com/exercism/${track}.git`;
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), `forge-exercism-${track}-`));
    const rootPath = path.join(temporaryRoot, "track");
    try {
      await runGit(["clone", "--depth", "1", "--filter=blob:none", repository, rootPath]);
      const revision = await runGit(["rev-parse", "HEAD"], rootPath);
      if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("Exercism revision is invalid");
      return Object.freeze({
        rootPath,
        repository,
        revision,
        cleanup: () => rm(temporaryRoot, { recursive: true, force: true }),
      });
    } catch (error) {
      await rm(temporaryRoot, { recursive: true, force: true });
      throw error;
    }
  }
}

export interface ExerciseRegistryOptions {
  readonly events: RuntimeEventBus;
  readonly stateStore?: ExerciseStateStore;
  readonly exercismSource?: ExercismTrackSource;
  readonly promoteCapability?: (request: Readonly<{
    capabilityId: string;
    name: string;
    exerciseId: string;
    attemptId: string;
  }>) => Promise<void>;
}

export class ExerciseRegistry {
  readonly #events: RuntimeEventBus;
  readonly #stateStore: ExerciseStateStore;
  readonly #exercismSource: ExercismTrackSource;
  readonly #promoteCapability: ExerciseRegistryOptions["promoteCapability"];
  #state: PersistedExerciseState = createInitialExerciseState();
  #initialized = false;

  constructor(options: ExerciseRegistryOptions) {
    this.#events = options.events;
    this.#stateStore = options.stateStore ?? new FileExerciseStateStore();
    this.#exercismSource = options.exercismSource ?? new GitHubExercismTrackSource();
    this.#promoteCapability = options.promoteCapability;
  }

  async initialize(): Promise<void> {
    this.#state = await this.#stateStore.load();
    this.#initialized = true;
    this.#events.publish("exercise.registry.loaded", { exercises: this.#state.exercises.length });
  }

  listExercises(): readonly ExerciseRecord[] {
    this.#ensureInitialized();
    return [...this.#state.exercises].sort((left, right) =>
      left.difficulty - right.difficulty || left.id.localeCompare(right.id));
  }

  getExercise(exerciseId: string): ExerciseRecord | null {
    this.#ensureInitialized();
    return this.#state.exercises.find((exercise) => exercise.id === exerciseId) ?? null;
  }

  listAttempts(exerciseId?: string): readonly ExerciseAttemptRecord[] {
    this.#ensureInitialized();
    return this.#state.attempts.filter((attempt) => exerciseId === undefined || attempt.exerciseId === exerciseId);
  }

  nextExercise(track?: string): ExerciseRecord | null {
    this.#ensureInitialized();
    const passed = new Set(this.#state.attempts.filter((attempt) => attempt.status === "passed").map((attempt) => attempt.exerciseId));
    return this.listExercises().find((exercise) => (track === undefined || exercise.source.track === track) && !passed.has(exercise.id)) ?? null;
  }

  hasAcquiredTrack(track: string): boolean {
    this.#ensureInitialized();
    return this.#state.acquiredTracks.some((item) => item.track === track);
  }

  estimateDurationMs(exercise: ExerciseRecord): number | null {
    this.#ensureInitialized();
    const durations = this.#state.attempts
      .filter((attempt) => attempt.status !== "running" && attempt.durationMs !== null)
      .flatMap((attempt) => {
        const candidate = this.getExercise(attempt.exerciseId);
        return candidate?.language === exercise.language && candidate.difficulty <= exercise.difficulty && attempt.durationMs !== null
          ? [attempt.durationMs]
          : [];
      })
      .sort((left, right) => left - right);
    if (durations.length === 0) return null;
    const middle = Math.floor(durations.length / 2);
    return durations.length % 2 === 0 ? Math.round((durations[middle - 1] + durations[middle]) / 2) : durations[middle];
  }

  async startAttempt(exerciseId: string, missionId: string, upstreamTestCommand: readonly string[]): Promise<ExerciseAttemptRecord> {
    this.#ensureInitialized();
    const exercise = this.getExercise(exerciseId);
    if (!exercise) throw new Error(`Exercise not found: ${exerciseId}`);
    if (this.#state.attempts.some((attempt) => attempt.exerciseId === exerciseId && attempt.status === "running")) {
      throw new Error(`Exercise already has a running attempt: ${exerciseId}`);
    }
    const attempts = this.#state.attempts.filter((attempt) => attempt.exerciseId === exerciseId);
    const attempt: ExerciseAttemptRecord = Object.freeze({
      id: randomUUID(), exerciseId, missionId, attemptNumber: attempts.length + 1,
      status: "running", durationMs: null, startedAt: new Date().toISOString(), completedAt: null,
      upstreamTestCommand: Object.freeze([...upstreamTestCommand]),
      upstreamTestsSha256: aggregateTestHash(exercise), verification: null,
    });
    await this.#replaceState({ ...this.#state, attempts: Object.freeze([...this.#state.attempts, attempt]) });
    this.#events.publish("exercise.attempt.started", { exerciseId, attemptId: attempt.id, attemptNumber: attempt.attemptNumber, missionId });
    return attempt;
  }

  async completeAttempt(attemptId: string, result: ExerciseRunResult): Promise<ExerciseAttemptRecord> {
    this.#ensureInitialized();
    const index = this.#state.attempts.findIndex((attempt) => attempt.id === attemptId);
    const current = this.#state.attempts[index];
    if (!current || current.status !== "running") throw new Error("A running exercise attempt is required");
    const exercise = this.getExercise(current.exerciseId);
    if (!exercise) throw new Error(`Exercise not found: ${current.exerciseId}`);
    const expectedHash = aggregateTestHash(exercise);
    const testFilesUnchanged = result.testsSha256Before === expectedHash && result.testsSha256After === expectedHash;
    const passed = result.exitCode === 0 && testFilesUnchanged;
    const completed: ExerciseAttemptRecord = Object.freeze({
      ...current, status: passed ? "passed" : "failed", durationMs: result.durationMs,
      completedAt: new Date().toISOString(), verification: Object.freeze({ exitCode: result.exitCode, passed, testFilesUnchanged }),
    });
    const attempts = [...this.#state.attempts];
    attempts[index] = completed;
    await this.#replaceState({ ...this.#state, attempts: Object.freeze(attempts) });
    if (passed && this.#promoteCapability) {
      for (const concept of exercise.concepts) {
        await this.#promoteCapability({
          capabilityId: `language.${exercise.source.track}.${concept.replaceAll("_", "-")}`,
          name: `${exercise.language}: ${concept}`,
          exerciseId: exercise.id,
          attemptId: completed.id,
        });
      }
    }
    this.#events.publish("exercise.attempt.completed", { exerciseId: exercise.id, attemptId, attemptNumber: completed.attemptNumber, passed, durationMs: result.durationMs, testFilesUnchanged });
    return completed;
  }

  summary(): ExerciseRegistrySummary {
    this.#ensureInitialized();
    const passedIds = new Set(this.#state.attempts.filter((attempt) => attempt.status === "passed").map((attempt) => attempt.exerciseId));
    return Object.freeze({
      exercises: this.#state.exercises.length,
      attempts: this.#state.attempts.length,
      passed: this.#state.attempts.filter((attempt) => attempt.status === "passed").length,
      failed: this.#state.attempts.filter((attempt) => attempt.status === "failed").length,
      remaining: this.#state.exercises.filter((exercise) => !passedIds.has(exercise.id)).length,
    });
  }

  async acquireExercismTrack(track: string): Promise<readonly ExerciseRecord[]> {
    this.#ensureInitialized();
    const checkout = await this.#exercismSource.checkout(track);
    try {
      const imported = await this.#readTrack(checkout, track);
      const otherExercises = this.#state.exercises.filter((exercise) =>
        exercise.source.kind !== "exercism" || exercise.source.track !== track);
      const acquiredAt = new Date().toISOString();
      const next: PersistedExerciseState = Object.freeze({
        version: EXERCISE_STORE_VERSION,
        exercises: Object.freeze([...otherExercises, ...imported]),
        attempts: this.#state.attempts,
        acquiredTracks: Object.freeze([
          ...this.#state.acquiredTracks.filter((item) => item.track !== track),
          Object.freeze({ source: "exercism" as const, track, repository: checkout.repository, revision: checkout.revision, acquiredAt }),
        ]),
      });
      await this.#stateStore.save(next);
      this.#state = next;
      this.#events.publish("exercise.track.acquired", { track, revision: checkout.revision, exercises: imported.length });
      return imported;
    } catch (error) {
      this.#events.publish("exercise.track.acquisition.failed", { track, error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      await checkout.cleanup();
    }
  }

  async #readTrack(checkout: ExercismTrackCheckout, track: string): Promise<readonly ExerciseRecord[]> {
    const config = JSON.parse(await readFile(path.join(checkout.rootPath, "config.json"), "utf8")) as { language?: string; exercises?: { practice?: ExercismTrackExercise[] } };
    const exercises = config.exercises?.practice;
    if (!Array.isArray(exercises) || exercises.length === 0) throw new Error("Exercism track contains no practice exercises");
    const importedAt = new Date().toISOString();
    return Promise.all(exercises.map(async (entry) => {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug) || !Number.isInteger(entry.difficulty) || entry.difficulty < 1) {
        throw new Error(`Invalid Exercism exercise metadata: ${entry.slug}`);
      }
      const exerciseRoot = path.join(checkout.rootPath, "exercises", "practice", entry.slug);
      const instructions = await readFile(path.join(exerciseRoot, ".docs", "instructions.md"), "utf8");
      const exerciseConfig = JSON.parse(await readFile(path.join(exerciseRoot, ".meta", "config.json"), "utf8")) as ExercismExerciseConfig;
      if (!Array.isArray(exerciseConfig.files?.solution) || exerciseConfig.files.solution.length === 0 || !Array.isArray(exerciseConfig.files?.test) || exerciseConfig.files.test.length === 0) {
        throw new Error(`Exercise ${entry.slug} must declare solution and test files`);
      }
      const starterFiles = await Promise.all(exerciseConfig.files.solution.map(async (file) => {
        const relative = safeRelativePath(file);
        const target = path.join(exerciseRoot, relative);
        const content = await access(target).then(() => readFile(target, "utf8"), () => "");
        return Object.freeze({ path: relative, content, sha256: sha256(content) });
      }));
      const testFiles = await Promise.all(exerciseConfig.files.test.map(async (file) => {
        const relative = safeRelativePath(file);
        const content = await readFile(path.join(exerciseRoot, relative), "utf8");
        return Object.freeze({ path: relative, content, sha256: sha256(content) });
      }));
      return Object.freeze({
        id: `exercism:${track}:${entry.slug}`,
        source: Object.freeze({ kind: "exercism" as const, repository: checkout.repository, revision: checkout.revision, track, exercise: entry.slug }),
        language: config.language?.trim() || track,
        title: entry.name?.trim() || entry.slug.replaceAll("-", " "),
        instructions,
        difficulty: entry.difficulty,
        concepts: Object.freeze([...(entry.practices ?? [])]),
        prerequisites: Object.freeze([...(entry.prerequisites ?? [])]),
        starterFiles: Object.freeze(starterFiles),
        testFiles: Object.freeze(testFiles),
        importedAt,
      });
    }));
  }

  #ensureInitialized(): void {
    if (!this.#initialized) throw new Error("Exercise registry is not initialized");
  }

  async #replaceState(state: PersistedExerciseState): Promise<void> {
    const next = Object.freeze({ ...state, version: EXERCISE_STORE_VERSION });
    await this.#stateStore.save(next);
    this.#state = next;
  }
}

export function aggregateTestHash(exercise: ExerciseRecord): string {
  return createHash("sha256")
    .update(exercise.testFiles.map((file) => `${file.path}\0${file.sha256}`).sort().join("\n"), "utf8")
    .digest("hex");
}