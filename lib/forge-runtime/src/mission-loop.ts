import type { RuntimeEventBus } from "./event-bus";
import {
  MissionAbortError,
  MissionEngine,
} from "./mission-engine";
import type {
  MissionLoopSnapshot,
  MissionRecord,
} from "./mission";

export interface MissionLoopOptions {
  readonly engine: MissionEngine;
  readonly events: RuntimeEventBus;
  readonly pollIntervalMs?: number;
}

export class MissionLoop {
  readonly #engine: MissionEngine;
  readonly #events: RuntimeEventBus;
  readonly #pollIntervalMs: number;
  #running = false;
  #currentMissionId: string | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #abortController: AbortController | null = null;
  #activeExecution: Promise<void> | null = null;

  constructor(options: MissionLoopOptions) {
    this.#engine = options.engine;
    this.#events = options.events;
    this.#pollIntervalMs = options.pollIntervalMs ?? 500;

    if (
      !Number.isInteger(this.#pollIntervalMs) ||
      this.#pollIntervalMs < 100
    ) {
      throw new Error(
        "pollIntervalMs must be an integer of at least 100",
      );
    }
  }

  snapshot(): MissionLoopSnapshot {
    return Object.freeze({
      status: this.#running ? "running" : "stopped",
      currentMissionId: this.#currentMissionId,
      pollIntervalMs: this.#pollIntervalMs,
    });
  }

  start(): MissionLoopSnapshot {
    if (this.#running) {
      return this.snapshot();
    }

    this.#running = true;
    this.#events.publish("mission.loop.started", {
      pollIntervalMs: this.#pollIntervalMs,
    });

    this.#schedule(0);

    return this.snapshot();
  }

  async stop(): Promise<MissionLoopSnapshot> {
    if (!this.#running) {
      return this.snapshot();
    }

    this.#running = false;

    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }

    this.#abortController?.abort();

    if (this.#activeExecution !== null) {
      await this.#activeExecution;
    }

    this.#events.publish("mission.loop.stopped");

    return this.snapshot();
  }

  wake(): void {
    if (!this.#running || this.#currentMissionId !== null) {
      return;
    }

    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }

    this.#schedule(0);
  }

  #schedule(delayMs: number): void {
    if (!this.#running) {
      return;
    }

    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#tick();
    }, delayMs);
  }

  async #tick(): Promise<void> {
    if (!this.#running || this.#currentMissionId !== null) {
      return;
    }

    const mission = await this.#engine.claimNext();

    if (mission === null) {
      this.#schedule(this.#pollIntervalMs);
      return;
    }

    this.#currentMissionId = mission.id;
    this.#abortController = new AbortController();
    this.#activeExecution = this.#execute(mission);

    await this.#activeExecution;

    this.#activeExecution = null;
    this.#abortController = null;
    this.#currentMissionId = null;

    if (this.#running) {
      this.#schedule(0);
    }
  }

  async #execute(mission: MissionRecord): Promise<void> {
    try {
      const output = await this.#engine.execute(
        mission,
        this.#abortController!.signal,
      );

      await this.#engine.complete(mission.id, output);
    } catch (error) {
      if (
        error instanceof MissionAbortError &&
        !this.#running
      ) {
        await this.#engine.requeueAfterGracefulStop(
          mission.id,
        );
        return;
      }

      await this.#engine.fail(mission.id, error);
    }
  }
}