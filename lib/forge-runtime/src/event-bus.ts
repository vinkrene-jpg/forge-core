export type RuntimeEventType =
  | "runtime.state.initialized"
  | "runtime.state.loaded"
  | "runtime.recovery.detected"
  | "kernel.starting"
  | "kernel.started"
  | "kernel.stopping"
  | "kernel.stopped"
  | "kernel.failed"
  | "mission.enqueued"
  | "mission.awaiting_approval"
  | "mission.approved"
  | "mission.rejected"
  | "mission.started"
  | "mission.succeeded"
  | "mission.failed"
  | "mission.requeued"
  | "mission.recovered"
  | "mission.loop.started"
  | "mission.loop.stopped"
  | "governance.state.loaded"
  | "governance.assessed"
  | "governance.approval.requested"
  | "governance.approval.approved"
  | "governance.approval.rejected"
  | "capability.registry.loaded"
  | "capability.registered"
  | "capability.updated"
  | "capability.analysis.completed"
  | "evolution.plan.created"
  | "evolution.plan.approved"
  | "evolution.plan.started"
  | "evolution.step.verified"
  | "evolution.plan.completed"
  | "evolution.plan.failed"
  | "operator.state.loaded"
  | "operator.project.registered"
  | "operator.memory.added"
  | "operator.workspace.inspected"
  | "workspace.execution.started"
  | "workspace.execution.verified"
  | "workspace.execution.committed"
  | "workspace.execution.pushed"
  | "workspace.execution.rolled_back"
  | "workspace.bridge.requested"
  | "workspace.bridge.responded"
  | "workspace.bridge.rejected"
  | "workspace.plan.validated"
  | "workspace.plan.scheduled"
  | "operator.model.routed"
  | "operator.prompt.composed"
  | "ai.gateway.loaded"
  | "ai.execution.started"
  | "ai.execution.succeeded"
  | "ai.execution.failed"
  | "ai.execution.unavailable"
  | "autonomous.cycle.evaluated"
  | "autonomous.cycle.continuation.scheduled"
  | "autonomous.cycle.continuation.failed"
  | "learning.state.loaded"
  | "learning.evidence.collected"
  | "learning.observation.recorded"
  | "learning.proposal.created"
  | "learning.proposal.scheduled"
  | "learning.proposal.completed"
  | "learning.proposal.failed";

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

  constructor(historyLimit = 500) {
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
