export type KernelStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "failed";

export interface KernelStateSnapshot {
  readonly status: KernelStatus;
  readonly revision: number;
  readonly startedAt: string | null;
  readonly updatedAt: string;
  readonly lastError: string | null;
}

const allowedTransitions: Readonly<
  Record<KernelStatus, readonly KernelStatus[]>
> = {
  stopped: ["starting"],
  starting: ["running", "failed"],
  running: ["stopping", "failed"],
  stopping: ["stopped", "failed"],
  failed: ["starting", "stopped"],
};

export class KernelRuntimeState {
  #status: KernelStatus = "stopped";
  #revision = 0;
  #startedAt: string | null = null;
  #updatedAt = new Date().toISOString();
  #lastError: string | null = null;

  transition(next: KernelStatus, error?: unknown): KernelStateSnapshot {
    if (!allowedTransitions[this.#status].includes(next)) {
      throw new Error(
        `Invalid kernel transition: ${this.#status} -> ${next}`,
      );
    }

    const now = new Date().toISOString();

    this.#status = next;
    this.#revision += 1;
    this.#updatedAt = now;

    if (next === "running") {
      this.#startedAt = now;
      this.#lastError = null;
    }

    if (next === "stopped") {
      this.#startedAt = null;
      this.#lastError = null;
    }

    if (next === "failed") {
      this.#lastError =
        error instanceof Error ? error.message : String(error ?? "Unknown error");
    }

    return this.snapshot();
  }

  snapshot(): KernelStateSnapshot {
    return Object.freeze({
      status: this.#status,
      revision: this.#revision,
      startedAt: this.#startedAt,
      updatedAt: this.#updatedAt,
      lastError: this.#lastError,
    });
  }
}
