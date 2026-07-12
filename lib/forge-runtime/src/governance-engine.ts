import { randomUUID } from "node:crypto";
import type { RuntimeEventBus } from "./event-bus";
import {
  assessMissionRequest,
  GOVERNANCE_POLICY_VERSION,
  type ApprovalRecord,
  type ApprovalStatus,
  type GovernanceAssessment,
  type GovernanceSummary,
} from "./governance";
import {
  FileGovernanceStateStore,
  GOVERNANCE_STORE_VERSION,
  type GovernanceStateStore,
  type PersistedGovernanceState,
} from "./governance-store";
import type { CreateMissionRequest } from "./mission";

export interface GovernanceEngineOptions {
  readonly events: RuntimeEventBus;
  readonly stateStore?: GovernanceStateStore;
}

function cloneApproval(
  approval: ApprovalRecord,
): ApprovalRecord {
  return Object.freeze({
    ...approval,
    assessment: Object.freeze({
      ...approval.assessment,
    }),
  });
}

function requiredText(
  value: string,
  field: string,
): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${field} is required`);
  }

  return normalized;
}

export class GovernanceEngine {
  readonly #events: RuntimeEventBus;
  readonly #stateStore: GovernanceStateStore;
  #state: PersistedGovernanceState = Object.freeze({
    version: GOVERNANCE_STORE_VERSION,
    approvals: Object.freeze([]),
  });
  #initialized = false;
  #mutation = Promise.resolve();

  constructor(options: GovernanceEngineOptions) {
    this.#events = options.events;
    this.#stateStore =
      options.stateStore ?? new FileGovernanceStateStore();
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
      throw new Error("GovernanceEngine is not initialized");
    }
  }

  async initialize(): Promise<void> {
    await this.#mutate(async () => {
      if (this.#initialized) {
        return;
      }

      this.#state = await this.#stateStore.load();
      this.#initialized = true;

      this.#events.publish("governance.state.loaded", {
        policyVersion: GOVERNANCE_POLICY_VERSION,
        approvalCount: this.#state.approvals.length,
      });
    });
  }

  assess(
    request: CreateMissionRequest,
  ): GovernanceAssessment {
    this.#ensureInitialized();

    const assessment = assessMissionRequest(request);

    this.#events.publish("governance.assessed", {
      missionKind: assessment.missionKind,
      riskLevel: assessment.riskLevel,
      decision: assessment.decision,
      policyVersion: assessment.policyVersion,
    });

    return assessment;
  }

  listApprovals(
    status?: ApprovalStatus,
  ): readonly ApprovalRecord[] {
    this.#ensureInitialized();

    return this.#state.approvals
      .filter(
        (approval) =>
          status === undefined || approval.status === status,
      )
      .map(cloneApproval);
  }

  getApproval(
    approvalId: string,
  ): ApprovalRecord | null {
    this.#ensureInitialized();

    const approval = this.#state.approvals.find(
      (candidate) => candidate.id === approvalId,
    );

    return approval ? cloneApproval(approval) : null;
  }

  findByMissionId(
    missionId: string,
  ): ApprovalRecord | null {
    this.#ensureInitialized();

    const approval = [...this.#state.approvals]
      .reverse()
      .find((candidate) => candidate.missionId === missionId);

    return approval ? cloneApproval(approval) : null;
  }

  summary(): GovernanceSummary {
    this.#ensureInitialized();

    let pending = 0;
    let approved = 0;
    let rejected = 0;

    for (const approval of this.#state.approvals) {
      if (approval.status === "pending") {
        pending += 1;
      } else if (approval.status === "approved") {
        approved += 1;
      } else {
        rejected += 1;
      }
    }

    return Object.freeze({
      policyVersion: GOVERNANCE_POLICY_VERSION,
      total: this.#state.approvals.length,
      pending,
      approved,
      rejected,
    });
  }

  async requestApproval(
    missionId: string,
    assessment: GovernanceAssessment,
  ): Promise<ApprovalRecord> {
    this.#ensureInitialized();

    if (assessment.decision !== "require_approval") {
      throw new Error(
        "Approval can only be requested for require_approval decisions",
      );
    }

    const existing = this.findByMissionId(missionId);

    if (existing !== null) {
      return existing;
    }

    return this.#mutate(async () => {
      const now = new Date().toISOString();

      const approval = cloneApproval({
        id: randomUUID(),
        missionId,
        status: "pending",
        assessment,
        createdAt: now,
        updatedAt: now,
        decidedAt: null,
        decidedBy: null,
        note: null,
      });

      this.#state = Object.freeze({
        version: GOVERNANCE_STORE_VERSION,
        approvals: Object.freeze([
          ...this.#state.approvals,
          approval,
        ]),
      });

      await this.#stateStore.save(this.#state);

      this.#events.publish("governance.approval.requested", {
        approvalId: approval.id,
        missionId,
        riskLevel: assessment.riskLevel,
      });

      return cloneApproval(approval);
    });
  }

  approve(
    approvalId: string,
    actor: string,
    note?: string,
  ): Promise<ApprovalRecord> {
    return this.#decide(
      approvalId,
      "approved",
      actor,
      note,
    );
  }

  reject(
    approvalId: string,
    actor: string,
    note?: string,
  ): Promise<ApprovalRecord> {
    return this.#decide(
      approvalId,
      "rejected",
      actor,
      note,
    );
  }

  async #decide(
    approvalId: string,
    status: "approved" | "rejected",
    actor: string,
    note?: string,
  ): Promise<ApprovalRecord> {
    this.#ensureInitialized();

    return this.#mutate(async () => {
      const index = this.#state.approvals.findIndex(
        (approval) => approval.id === approvalId,
      );

      if (index < 0) {
        throw new Error(`Approval not found: ${approvalId}`);
      }

      const current = this.#state.approvals[index];

      if (current.status !== "pending") {
        if (current.status === status) {
          return cloneApproval(current);
        }

        throw new Error(
          `Approval ${approvalId} is already ${current.status}`,
        );
      }

      const now = new Date().toISOString();

      const approval = cloneApproval({
        ...current,
        status,
        updatedAt: now,
        decidedAt: now,
        decidedBy: requiredText(actor, "actor"),
        note:
          note === undefined || note.trim().length === 0
            ? null
            : note.trim(),
      });

      const approvals = [...this.#state.approvals];
      approvals[index] = approval;

      this.#state = Object.freeze({
        version: GOVERNANCE_STORE_VERSION,
        approvals: Object.freeze(approvals),
      });

      await this.#stateStore.save(this.#state);

      this.#events.publish(
        status === "approved"
          ? "governance.approval.approved"
          : "governance.approval.rejected",
        {
          approvalId,
          missionId: approval.missionId,
          actor: approval.decidedBy,
        },
      );

      return cloneApproval(approval);
    });
  }
}