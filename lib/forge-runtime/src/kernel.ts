import { RuntimeEventBus } from "./event-bus";
import {
  KernelRuntimeState,
  type KernelStateSnapshot,
} from "./runtime-state";

export interface RuntimeHealthSnapshot {
  readonly status: "ok" | "degraded";
  readonly kernelStatus: KernelStateSnapshot["status"];
  readonly checkedAt: string;
  readonly startedAt: string | null;
  readonly uptimeMs: number;
  readonly eventCount: number;
}

export class ForgeKernel {
  readonly #events: RuntimeEventBus;
  readonly #state = new KernelRuntimeState();

  constructor(events: RuntimeEventBus) {
    this.#events = events;
  }

  async start(): Promise<KernelStateSnapshot> {
    const current = this.#state.snapshot();

    if (current.status === "running") {
      return current;
    }

    this.#state.transition("starting");
    this.#events.publish("kernel.starting");

    try {
      const running = this.#state.transition("running");

      this.#events.publish("kernel.started", {
        startedAt: running.startedAt,
      });

      return running;
    } catch (error) {
      const failed = this.#state.transition("failed", error);

      this.#events.publish("kernel.failed", {
        error: failed.lastError,
      });

      throw error;
    }
  }

  async stop(): Promise<KernelStateSnapshot> {
    const current = this.#state.snapshot();

    if (current.status === "stopped") {
      return current;
    }

    if (current.status === "failed") {
      const stopped = this.#state.transition("stopped");
      this.#events.publish("kernel.stopped");
      return stopped;
    }

    this.#state.transition("stopping");
    this.#events.publish("kernel.stopping");

    try {
      const stopped = this.#state.transition("stopped");
      this.#events.publish("kernel.stopped");
      return stopped;
    } catch (error) {
      const failed = this.#state.transition("failed", error);

      this.#events.publish("kernel.failed", {
        error: failed.lastError,
      });

      throw error;
    }
  }

  stateSnapshot(): KernelStateSnapshot {
    return this.#state.snapshot();
  }

  healthSnapshot(): RuntimeHealthSnapshot {
    const state = this.#state.snapshot();
    const now = Date.now();
    const startedAtMs =
      state.startedAt === null ? null : Date.parse(state.startedAt);

    return Object.freeze({
      status: state.status === "running" ? "ok" : "degraded",
      kernelStatus: state.status,
      checkedAt: new Date(now).toISOString(),
      startedAt: state.startedAt,
      uptimeMs:
        startedAtMs === null || Number.isNaN(startedAtMs)
          ? 0
          : Math.max(0, now - startedAtMs),
      eventCount: this.#events.count,
    });
  }
}
