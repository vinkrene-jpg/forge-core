import { createHash, randomUUID } from "node:crypto";
import type { CapabilityRecord } from "./capability";
import type { RuntimeEvent } from "./event-bus";
import type {
  LearningCapabilityProfile,
  LearningObservation,
} from "./learning";
import type { LearningCapabilityMatrixEntry } from "./learning-matrix";

export interface LearningEvidenceBundle {
  readonly id: string;
  readonly proposalId: string;
  readonly missionId: string;
  readonly targetCapabilityId: string;
  readonly capability: CapabilityRecord | null;
  readonly profile: LearningCapabilityProfile | null;
  readonly matrixEntry: LearningCapabilityMatrixEntry | null;
  readonly priorObservationIds: readonly string[];
  readonly recentEvents: readonly {
    readonly sequence: number;
    readonly type: string;
    readonly occurredAt: string;
    readonly payloadKeys: readonly string[];
  }[];
  readonly accessMode: "read-only";
  readonly capturedAt: string;
  readonly sha256: string;
}

export interface LearningEvidenceToolOptions {
  readonly getCapability: (capabilityId: string) => CapabilityRecord | null;
  readonly getProfile: (
    capabilityId: string,
  ) => LearningCapabilityProfile | null;
  readonly getMatrixEntry: (
    capabilityId: string,
  ) => LearningCapabilityMatrixEntry | null;
  readonly getObservations: () => readonly LearningObservation[];
  readonly getEvents: () => readonly RuntimeEvent[];
}

export class LearningEvidenceTool {
  readonly #options: LearningEvidenceToolOptions;

  constructor(options: LearningEvidenceToolOptions) {
    this.#options = options;
  }

  collect(request: {
    readonly proposalId: string;
    readonly missionId: string;
    readonly targetCapabilityId: string;
  }): LearningEvidenceBundle {
    const capturedAt = new Date().toISOString();
    const evidence = {
      proposalId: request.proposalId,
      missionId: request.missionId,
      targetCapabilityId: request.targetCapabilityId,
      capability: this.#options.getCapability(request.targetCapabilityId),
      profile: this.#options.getProfile(request.targetCapabilityId),
      matrixEntry: this.#options.getMatrixEntry(request.targetCapabilityId),
      priorObservationIds: this.#options
        .getObservations()
        .filter(
          (observation) =>
            observation.targetCapabilityId === request.targetCapabilityId,
        )
        .map((observation) => observation.id)
        .slice(-10),
      recentEvents: this.#options
        .getEvents()
        .slice(-25)
        .map((event) => ({
          sequence: event.sequence,
          type: event.type,
          occurredAt: event.occurredAt,
          payloadKeys: Object.keys(event.payload).sort(),
        })),
      accessMode: "read-only" as const,
      capturedAt,
    };
    const sha256 = createHash("sha256")
      .update(JSON.stringify(evidence), "utf8")
      .digest("hex");

    return Object.freeze({
      id: randomUUID(),
      ...evidence,
      priorObservationIds: Object.freeze(evidence.priorObservationIds),
      recentEvents: Object.freeze(
        evidence.recentEvents.map((event) =>
          Object.freeze({
            ...event,
            payloadKeys: Object.freeze(event.payloadKeys),
          }),
        ),
      ),
      sha256,
    });
  }
}
