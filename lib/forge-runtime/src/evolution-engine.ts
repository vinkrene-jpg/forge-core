import type {
  EvolutionPlanRecord,
  EvolutionPlanStep,
  EvolutionVerificationEvidence,
} from "./capability";
import type { CapabilityRegistry } from "./capability-registry";
import type {
  RuntimeEvent,
  RuntimeEventBus,
} from "./event-bus";

export interface EvolutionEngineOptions {
  readonly registry: CapabilityRegistry;
  readonly events: RuntimeEventBus;
  readonly getEventHistory: () => readonly RuntimeEvent[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "Unknown error");
}

export class EvolutionEngine {
  readonly #registry: CapabilityRegistry;
  readonly #events: RuntimeEventBus;
  readonly #getEventHistory: () => readonly RuntimeEvent[];

  constructor(options: EvolutionEngineOptions) {
    this.#registry = options.registry;
    this.#events = options.events;
    this.#getEventHistory = options.getEventHistory;
  }

  approvePlan(
    planId: string,
    actor: string,
  ): Promise<EvolutionPlanRecord> {
    return this.#registry.approvePlan(planId, actor);
  }

  async executePlan(
    planId: string,
  ): Promise<EvolutionPlanRecord> {
    const approved = this.#registry.getPlan(planId);

    if (approved === null) {
      throw new Error(`Evolution plan not found: ${planId}`);
    }

    if (approved.status !== "approved") {
      throw new Error(
        `Evolution plan ${planId} requires approval before execution`,
      );
    }

    await this.#registry.beginPlanExecution(planId);

    const evidence: EvolutionVerificationEvidence[] = [];

    try {
      for (const step of approved.steps) {
        const result = this.#verify(step);

        if (!result.passed) {
          throw new Error(
            `Verification failed for ${step.capabilityId}`,
          );
        }

        evidence.push(result);

        await this.#registry.promoteCapability(
          step.capabilityId,
          step.toStatus,
          `evolution-engine:${planId}`,
        );

        this.#events.publish("evolution.step.verified", {
          planId,
          capabilityId: step.capabilityId,
          verifierId: result.verifierId,
          targetStatus: step.toStatus,
        });
      }

      return this.#registry.completePlan(
        planId,
        evidence,
      );
    } catch (error) {
      await this.#registry.failPlan(
        planId,
        errorMessage(error),
      );

      throw error;
    }
  }

  #verify(
    step: EvolutionPlanStep,
  ): EvolutionVerificationEvidence {
    if (
      step.capabilityId ===
      "runtime.event.history.inspect"
    ) {
      const history = this.#getEventHistory();
      const eventTypes = new Set(
        history.map((event) => event.type),
      );
      const passed =
        history.length > 0 &&
        eventTypes.has("kernel.started") &&
        eventTypes.has("capability.registry.loaded");

      return Object.freeze({
        capabilityId: step.capabilityId,
        verifierId:
          "runtime.event-history.lifecycle-evidence.v1",
        verifiedAt: new Date().toISOString(),
        passed,
        details: Object.freeze({
          eventCount: history.length,
          hasKernelStarted: eventTypes.has("kernel.started"),
          hasCapabilityRegistryLoaded: eventTypes.has(
            "capability.registry.loaded",
          ),
        }),
      });
    }

    throw new Error(
      `No verifier registered for capability ${step.capabilityId}`,
    );
  }
}