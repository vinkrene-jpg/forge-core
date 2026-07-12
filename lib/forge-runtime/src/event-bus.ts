export type RuntimeEventType =
  | "runtime.state.initialized"
  | "runtime.state.loaded"
  | "runtime.recovery.detected"
  | "kernel.starting"
  | "kernel.started"
  | "kernel.stopping"
  | "kernel.stopped"
  | "kernel.failed";

export interface RuntimeEvent {
  readonly sequence: number;
  readonly type: RuntimeEventType;
  readonly occurredAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type RuntimeEventListener = (event: RuntimeEvent) => void;

export class RuntimeEventBus {
  readonly #historyLimit: number;
  readonly #listeners = new Set<RuntimeEventListener>();
  readonly #history: RuntimeEvent[] = [];
  #sequence = 0;

  constructor(historyLimit = 100) {
    if (!Number.isInteger(historyLimit) || historyLimit < 1) {
      throw new Error("historyLimit must be a positive integer");
    }

    this.#historyLimit = historyLimit;
  }

  publish(
    type: RuntimeEventType,
    payload: Readonly<Record<string, unknown>> = {},
  ): RuntimeEvent {
    const event: RuntimeEvent = Object.freeze({
      sequence: ++this.#sequence,
      type,
      occurredAt: new Date().toISOString(),
      payload: Object.freeze({ ...payload }),
    });

    this.#history.push(event);

    if (this.#history.length > this.#historyLimit) {
      this.#history.shift();
    }

    for (const listener of this.#listeners) {
      listener(event);
    }

    return event;
  }

  subscribe(listener: RuntimeEventListener): () => void {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  get count(): number {
    return this.#sequence;
  }

  snapshot(): readonly RuntimeEvent[] {
    return [...this.#history];
  }
}