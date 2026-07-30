import { randomUUID } from "node:crypto";
import type { RuntimeEventBus } from "./event-bus";
import type { RuntimeHealthSnapshot } from "./kernel";
import {
  FileMissionStateStore,
  MISSION_STORE_VERSION,
  type MissionStateStore,
  type PersistedMissionState,
} from "./mission-store";
import type {
  CreateMissionRequest,
  MissionKind,
  MissionRecord,
  MissionResult,
  MissionResultStatus,
  MissionStatus,
  MissionSummary,
} from "./mission";

export class MissionAbortError extends Error {
  constructor() {
    super("Mission execution was interrupted");
    this.name = "MissionAbortError";
  }
}

export interface MissionEngineOptions {
  readonly events: RuntimeEventBus;
  readonly getRuntimeHealth: () => RuntimeHealthSnapshot;
  readonly executeAutonomousCycle?: (
    mission: MissionRecord,
    signal: AbortSignal,
  ) => Promise<Readonly<Record<string, unknown>>>;
  readonly executeWorkspaceChange?: (
    mission: MissionRecord,
    signal: AbortSignal,
  ) => Promise<Readonly<Record<string, unknown>>>;
  readonly executeWorkspacePlan?: (
    mission: MissionRecord,
    signal: AbortSignal,
  ) => Promise<Readonly<Record<string, unknown>>>;
  readonly stateStore?: MissionStateStore;
}

type InitialMissionStatus = Extract<
  MissionStatus,
  "queued" | "awaiting_approval"
>;

function cloneMission(mission: MissionRecord): MissionRecord {
  return Object.freeze({
    ...mission,
    input: Object.freeze({ ...mission.input }),
    output:
      mission.output === null
        ? null
        : Object.freeze({ ...mission.output }),
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "Unknown error");
}

interface MissionFailurePayload {
  readonly status: MissionResultStatus;
  readonly cause: string;
  readonly message: string;
  readonly output: Readonly<Record<string, unknown>> | null;
}

function missionResult(
  status: MissionResultStatus,
  cause: string,
  message: string,
): MissionResult {
  return Object.freeze({
    status,
    cause,
    message,
    producedAt: new Date().toISOString(),
  });
}

function failurePayload(error: unknown): MissionFailurePayload {
  const fallbackMessage = errorMessage(error);

  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      missionResultStatus?: unknown;
      missionResultCause?: unknown;
      missionOutput?: unknown;
      message?: unknown;
    };

    const status =
      candidate.missionResultStatus === "failed" ||
      candidate.missionResultStatus === "blocked" ||
      candidate.missionResultStatus === "rejected"
        ? candidate.missionResultStatus
        : fallbackMessage.includes("rejected by evaluation")
          ? "rejected"
          : /blocked|forbidden|not allowed|requires explicit operator approval/i.test(
                fallbackMessage,
              )
            ? "blocked"
            : "failed";

    const cause =
      typeof candidate.missionResultCause === "string" &&
      candidate.missionResultCause.trim().length > 0
        ? candidate.missionResultCause.trim()
        : status === "rejected"
          ? "evaluation"
          : status === "blocked"
            ? "governance"
            : "execution";

    const output =
      typeof candidate.missionOutput === "object" &&
      candidate.missionOutput !== null &&
      !Array.isArray(candidate.missionOutput)
        ? Object.freeze({ ...(candidate.missionOutput as Record<string, unknown>) })
        : null;

    return Object.freeze({
      status,
      cause,
      message:
        typeof candidate.message === "string" && candidate.message.length > 0
          ? candidate.message
          : fallbackMessage,
      output,
    });
  }

  return Object.freeze({
    status: /blocked|forbidden|not allowed|requires explicit operator approval/i.test(
      fallbackMessage,
    )
      ? "blocked"
      : "failed",
    cause: "execution",
    message: fallbackMessage,
    output: null,
  });
}

function assertSupportedKind(kind: unknown): asserts kind is MissionKind {
  if (
    kind !== "runtime.self-check" &&
    kind !== "runtime.stability-window" &&
    kind !== "operator.autonomous-cycle" &&
    kind !== "operator.workspace-change" &&
    kind !== "operator.workspace-plan"
  ) {
    throw new Error(`Unsupported mission kind: ${String(kind)}`);
  }
}

function integerInput(
  input: Readonly<Record<string, unknown>>,
  field: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = input[field];

  if (value === undefined) {
    return fallback;
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      `${field} must be an integer between ${minimum} and ${maximum}`,
    );
  }

  return value;
}

function wait(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new MissionAbortError());
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);

    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new MissionAbortError());
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class MissionEngine {
  readonly #events: RuntimeEventBus;
  readonly #getRuntimeHealth: () => RuntimeHealthSnapshot;
  readonly #executeAutonomousCycle:
    MissionEngineOptions["executeAutonomousCycle"];
  readonly #executeWorkspaceChange:
    MissionEngineOptions["executeWorkspaceChange"];
  readonly #executeWorkspacePlan:
    MissionEngineOptions["executeWorkspacePlan"];
  readonly #stateStore: MissionStateStore;
  #state: PersistedMissionState = Object.freeze({
    version: MISSION_STORE_VERSION,
    missions: Object.freeze([]),
  });
  #initialized = false;
  #mutation = Promise.resolve();

  constructor(options: MissionEngineOptions) {
    this.#events = options.events;
    this.#getRuntimeHealth = options.getRuntimeHealth;
    this.#executeAutonomousCycle =
      options.executeAutonomousCycle;
    this.#executeWorkspaceChange =
      options.executeWorkspaceChange;
    this.#executeWorkspacePlan =
      options.executeWorkspacePlan;
    this.#stateStore =
      options.stateStore ?? new FileMissionStateStore();
  }

  async #mutate<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;

    const next = new Promise<void>((resolve) => {
      release = resolve;
    });

    const previous = this.#mutation;
    this.#mutation = next;

    await previous;

    try {
      return await operation();
    } finally {
      release();
    }
  }

  #ensureInitialized(): void {
    if (!this.#initialized) {
      throw new Error("MissionEngine is not initialized");
    }
  }

  async initialize(): Promise<void> {
    await this.#mutate(async () => {
      if (this.#initialized) {
        return;
      }

      const loaded = await this.#stateStore.load();
      const recoveredMissionIds: string[] = [];
      const now = new Date().toISOString();

      const missions = loaded.missions.map((mission) => {
        if (mission.status !== "running") {
          return cloneMission(mission);
        }

        recoveredMissionIds.push(mission.id);

        return cloneMission({
          ...mission,
          status: "queued",
          updatedAt: now,
          startedAt: null,
          completedAt: null,
          interruptedCount: mission.interruptedCount + 1,
          lastError: "Recovered after unclean runtime shutdown",
        });
      });

      this.#state = Object.freeze({
        version: MISSION_STORE_VERSION,
        missions: Object.freeze(missions),
      });

      if (recoveredMissionIds.length > 0) {
        await this.#stateStore.save(this.#state);

        for (const missionId of recoveredMissionIds) {
          this.#events.publish("mission.recovered", {
            missionId,
          });
        }
      }

      this.#initialized = true;
    });
  }

  list(): readonly MissionRecord[] {
    this.#ensureInitialized();

    return this.#state.missions.map(cloneMission);
  }

  get(missionId: string): MissionRecord | null {
    this.#ensureInitialized();

    const mission = this.#state.missions.find(
      (candidate) => candidate.id === missionId,
    );

    return mission ? cloneMission(mission) : null;
  }

  summary(currentMissionId: string | null): MissionSummary {
    this.#ensureInitialized();

    const counts = {
      awaiting_approval: 0,
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const mission of this.#state.missions) {
      counts[mission.status] += 1;
    }

    return Object.freeze({
      total: this.#state.missions.length,
      awaitingApproval: counts.awaiting_approval,
      queued: counts.queued,
      running: counts.running,
      succeeded: counts.succeeded,
      failed: counts.failed,
      cancelled: counts.cancelled,
      currentMissionId,
    });
  }

  async enqueue(
    request: CreateMissionRequest,
    initialStatus: InitialMissionStatus = "queued",
  ): Promise<MissionRecord> {
    this.#ensureInitialized();
    assertSupportedKind(request.kind);

    return this.#mutate(async () => {
      const now = new Date().toISOString();
      const title =
        request.title?.trim() ||
        (
          request.kind === "runtime.self-check"
            ? "Runtime self-check"
            : request.kind === "runtime.stability-window"
              ? "Runtime stability window"
              : request.kind === "operator.autonomous-cycle"
                ? "Autonomous provider cycle"
                : request.kind === "operator.workspace-change"
                  ? "Governed workspace change"
                  : "Governed provider workspace plan"
        );

      const mission = cloneMission({
        id: randomUUID(),
        kind: request.kind,
        title,
        status: initialStatus,
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        completedAt: null,
        attempts: 0,
        interruptedCount: 0,
        input: Object.freeze({ ...(request.input ?? {}) }),
        output: null,
        lastError: null,
      });

      this.#state = Object.freeze({
        version: MISSION_STORE_VERSION,
        missions: Object.freeze([
          ...this.#state.missions,
          mission,
        ]),
      });

      await this.#stateStore.save(this.#state);

      this.#events.publish(
        initialStatus === "queued"
          ? "mission.enqueued"
          : "mission.awaiting_approval",
        {
          missionId: mission.id,
          kind: mission.kind,
        },
      );

      return cloneMission(mission);
    });
  }

  async approve(missionId: string): Promise<MissionRecord> {
    this.#ensureInitialized();

    return this.#mutate(async () => {
      const index = this.#state.missions.findIndex(
        (mission) => mission.id === missionId,
      );

      if (index < 0) {
        throw new Error(`Mission not found: ${missionId}`);
      }

      const current = this.#state.missions[index];

      if (current.status !== "awaiting_approval") {
        return cloneMission(current);
      }

      const mission = cloneMission({
        ...current,
        status: "queued",
        updatedAt: new Date().toISOString(),
        lastError: null,
      });

      const missions = [...this.#state.missions];
      missions[index] = mission;

      this.#state = Object.freeze({
        version: MISSION_STORE_VERSION,
        missions: Object.freeze(missions),
      });

      await this.#stateStore.save(this.#state);

      this.#events.publish("mission.approved", {
        missionId,
      });

      return cloneMission(mission);
    });
  }

  async reject(
    missionId: string,
    reason: string,
  ): Promise<MissionRecord> {
    this.#ensureInitialized();

    return this.#mutate(async () => {
      const index = this.#state.missions.findIndex(
        (mission) => mission.id === missionId,
      );

      if (index < 0) {
        throw new Error(`Mission not found: ${missionId}`);
      }

      const current = this.#state.missions[index];

      if (current.status !== "awaiting_approval") {
        return cloneMission(current);
      }

      const now = new Date().toISOString();

      const mission = cloneMission({
        ...current,
        status: "cancelled",
        updatedAt: now,
        completedAt: now,
        output: Object.freeze({
          missionResult: missionResult("rejected", "governance", reason),
        }),
        lastError: reason,
      });

      const missions = [...this.#state.missions];
      missions[index] = mission;

      this.#state = Object.freeze({
        version: MISSION_STORE_VERSION,
        missions: Object.freeze(missions),
      });

      await this.#stateStore.save(this.#state);

      this.#events.publish("mission.rejected", {
        missionId,
        reason,
      });

      return cloneMission(mission);
    });
  }

  async claimNext(): Promise<MissionRecord | null> {
    this.#ensureInitialized();

    return this.#mutate(async () => {
      const index = this.#state.missions.findIndex(
        (mission) => mission.status === "queued",
      );

      if (index < 0) {
        return null;
      }

      const now = new Date().toISOString();
      const current = this.#state.missions[index];

      const running = cloneMission({
        ...current,
        status: "running",
        updatedAt: now,
        startedAt: now,
        completedAt: null,
        attempts: current.attempts + 1,
        output: null,
        lastError: null,
      });

      const missions = [...this.#state.missions];
      missions[index] = running;

      this.#state = Object.freeze({
        version: MISSION_STORE_VERSION,
        missions: Object.freeze(missions),
      });

      await this.#stateStore.save(this.#state);

      this.#events.publish("mission.started", {
        missionId: running.id,
        kind: running.kind,
        attempt: running.attempts,
      });

      return cloneMission(running);
    });
  }

  async complete(
    missionId: string,
    output: Readonly<Record<string, unknown>>,
  ): Promise<MissionRecord> {
    const current = this.get(missionId);

    if (
      current?.kind === "operator.autonomous-cycle" &&
      current.input.objectiveExecutionMode === "build-or-mutate" &&
      current.input.objectiveProfile === "generic-build" &&
      (
        output.objectiveExecutionMode !== "build-or-mutate" ||
        output.objectiveProfile !== "generic-build" ||
        typeof output.workspaceExecutionMissionId !== "string" ||
        output.workspaceExecutionMissionId.length === 0 ||
        typeof output.workspaceExecutionApprovalId !== "string" ||
        output.workspaceExecutionApprovalId.length === 0
      )
    ) {
      throw new Error(
        "Generic build may not complete without a linked workspace execution mission and approval",
      );
    }

    return this.#updateRunningMission(
      missionId,
      "succeeded",
      Object.freeze({
        ...output,
        missionResult: missionResult(
          "completed",
          "execution",
          "Mission completed successfully",
        ),
      }),
      null,
    );
  }

  async fail(
    missionId: string,
    error: unknown,
  ): Promise<MissionRecord> {
    const failure = failurePayload(error);

    return this.#updateRunningMission(
      missionId,
      "failed",
      Object.freeze({
        ...(failure.output ?? {}),
        missionResult: missionResult(
          failure.status,
          failure.cause,
          failure.message,
        ),
      }),
      failure.message,
    );
  }

  async requeueAfterGracefulStop(
    missionId: string,
  ): Promise<MissionRecord> {
    this.#ensureInitialized();

    return this.#mutate(async () => {
      const index = this.#state.missions.findIndex(
        (mission) => mission.id === missionId,
      );

      if (index < 0) {
        throw new Error(`Mission not found: ${missionId}`);
      }

      const current = this.#state.missions[index];

      if (current.status !== "running") {
        return cloneMission(current);
      }

      const mission = cloneMission({
        ...current,
        status: "queued",
        updatedAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        output: null,
        lastError: "Requeued during graceful runtime shutdown",
      });

      const missions = [...this.#state.missions];
      missions[index] = mission;

      this.#state = Object.freeze({
        version: MISSION_STORE_VERSION,
        missions: Object.freeze(missions),
      });

      await this.#stateStore.save(this.#state);

      this.#events.publish("mission.requeued", {
        missionId,
      });

      return cloneMission(mission);
    });
  }

  async #updateRunningMission(
    missionId: string,
    status: "succeeded" | "failed",
    output: Readonly<Record<string, unknown>> | null,
    lastError: string | null,
  ): Promise<MissionRecord> {
    this.#ensureInitialized();

    return this.#mutate(async () => {
      const index = this.#state.missions.findIndex(
        (mission) => mission.id === missionId,
      );

      if (index < 0) {
        throw new Error(`Mission not found: ${missionId}`);
      }

      const current = this.#state.missions[index];

      if (current.status !== "running") {
        throw new Error(
          `Mission ${missionId} is not running`,
        );
      }

      const now = new Date().toISOString();

      const mission = cloneMission({
        ...current,
        status,
        updatedAt: now,
        completedAt: now,
        output:
          output === null
            ? null
            : Object.freeze({ ...output }),
        lastError,
      });

      const missions = [...this.#state.missions];
      missions[index] = mission;

      this.#state = Object.freeze({
        version: MISSION_STORE_VERSION,
        missions: Object.freeze(missions),
      });

      await this.#stateStore.save(this.#state);

      this.#events.publish(
        status === "succeeded"
          ? "mission.succeeded"
          : "mission.failed",
        {
          missionId,
          kind: mission.kind,
          attempt: mission.attempts,
          error: lastError,
        },
      );

      return cloneMission(mission);
    });
  }

  async execute(
    mission: MissionRecord,
    signal: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    if (mission.kind === "runtime.self-check") {
      const health = this.#getRuntimeHealth();

      if (
        health.status !== "ok" ||
        health.kernelStatus !== "running"
      ) {
        throw new Error(
          `Runtime self-check failed: ${health.status}/${health.kernelStatus}`,
        );
      }

      return Object.freeze({
        checkedAt: health.checkedAt,
        kernelStatus: health.kernelStatus,
        uptimeMs: health.uptimeMs,
        eventCount: health.eventCount,
      });
    }

    if (mission.kind === "runtime.stability-window") {
      const durationMs = integerInput(
        mission.input,
        "durationMs",
        10_000,
        1_000,
        120_000,
      );

      const sampleIntervalMs = integerInput(
        mission.input,
        "sampleIntervalMs",
        500,
        100,
        5_000,
      );

      const startedAt = Date.now();
      let samples = 0;
      let lastHealth = this.#getRuntimeHealth();

      while (Date.now() - startedAt < durationMs) {
        if (signal.aborted) {
          throw new MissionAbortError();
        }

        lastHealth = this.#getRuntimeHealth();

        if (
          lastHealth.status !== "ok" ||
          lastHealth.kernelStatus !== "running"
        ) {
          throw new Error(
            `Runtime degraded during stability window: ${lastHealth.status}/${lastHealth.kernelStatus}`,
          );
        }

        samples += 1;

        const remaining =
          durationMs - (Date.now() - startedAt);

        if (remaining > 0) {
          await wait(
            Math.min(sampleIntervalMs, remaining),
            signal,
          );
        }
      }

      return Object.freeze({
        durationMs,
        sampleIntervalMs,
        samples,
        completedAt: new Date().toISOString(),
        finalKernelStatus: lastHealth.kernelStatus,
        finalHealthStatus: lastHealth.status,
      });
    }

    if (mission.kind === "operator.autonomous-cycle") {
      if (!this.#executeAutonomousCycle) {
        throw new Error(
          "Autonomous cycle executor is not configured",
        );
      }

      return this.#executeAutonomousCycle(mission, signal);
    }

    if (mission.kind === "operator.workspace-change") {
      if (!this.#executeWorkspaceChange) {
        throw new Error("Workspace executor is not configured");
      }

      return this.#executeWorkspaceChange(mission, signal);
    }

    if (mission.kind === "operator.workspace-plan") {
      if (!this.#executeWorkspacePlan) {
        throw new Error("Workspace plan executor is not configured");
      }

      return this.#executeWorkspacePlan(mission, signal);
    }

    const exhaustiveCheck: never = mission.kind;
    throw new Error(
      `No executor registered for ${String(exhaustiveCheck)}`,
    );
  }
}
