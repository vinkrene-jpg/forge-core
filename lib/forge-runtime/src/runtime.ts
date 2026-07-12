import {
  RuntimeEventBus,
  type RuntimeEvent,
  type RuntimeEventListener,
} from "./event-bus";
import {
  ForgeKernel,
  type RuntimeHealthSnapshot,
} from "./kernel";
import type { KernelStateSnapshot } from "./runtime-state";

export interface ForgeRuntimeSnapshot {
  readonly kernel: KernelStateSnapshot;
  readonly health: RuntimeHealthSnapshot;
  readonly events: readonly RuntimeEvent[];
}

export class ForgeRuntime {
  readonly #events = new RuntimeEventBus();
  readonly #kernel = new ForgeKernel(this.#events);

  start(): Promise<KernelStateSnapshot> {
    return this.#kernel.start();
  }

  stop(): Promise<KernelStateSnapshot> {
    return this.#kernel.stop();
  }

  subscribe(listener: RuntimeEventListener): () => void {
    return this.#events.subscribe(listener);
  }

  snapshot(): ForgeRuntimeSnapshot {
    return Object.freeze({
      kernel: this.#kernel.stateSnapshot(),
      health: this.#kernel.healthSnapshot(),
      events: this.#events.snapshot(),
    });
  }
}

export const forgeRuntime = new ForgeRuntime();
