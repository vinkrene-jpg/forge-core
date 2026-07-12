import type { RuntimeEventBus } from "./event-bus";
import {
  CAPABILITY_STORE_VERSION,
  FileCapabilityStateStore,
  type CapabilityStateStore,
  type PersistedCapabilityState,
} from "./capability-store";
import type {
  CapabilityAnalysisRecord,
  CapabilityRecord,
  CapabilityStatus,
  CapabilitySummary,
  EvolutionPlanRecord,
  EvolutionPlanSummary,
  EvolutionVerificationEvidence,
  UpsertCapabilityRequest,
} from "./capability";

export interface CapabilityRegistryOptions {
  readonly events: RuntimeEventBus;
  readonly stateStore?: CapabilityStateStore;
}

const statuses = new Set<CapabilityStatus>([
  "unavailable",
  "experimental",
  "validated",
  "operational",
]);

function now(): string {
  return new Date().toISOString();
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

function confidence(value: number): number {
  if (
    typeof value !== "number" ||
    Number.isNaN(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new Error("confidence must be between 0 and 1");
  }

  return value;
}

function cloneCapability(
  capability: CapabilityRecord,
): CapabilityRecord {
  return Object.freeze({ ...capability });
}

function cloneAnalysis(
  analysis: CapabilityAnalysisRecord,
): CapabilityAnalysisRecord {
  return Object.freeze({
    ...analysis,
    requirements: Object.freeze(
      analysis.requirements.map((requirement) =>
        Object.freeze({ ...requirement }),
      ),
    ),
    gaps: Object.freeze(
      analysis.gaps.map((gap) =>
        Object.freeze({ ...gap }),
      ),
    ),
  });
}

function cloneEvidence(
  evidence: EvolutionVerificationEvidence,
): EvolutionVerificationEvidence {
  return Object.freeze({
    ...evidence,
    details: Object.freeze({ ...evidence.details }),
  });
}

function clonePlan(
  plan: EvolutionPlanRecord,
): EvolutionPlanRecord {
  return Object.freeze({
    ...plan,
    approvedAt: plan.approvedAt ?? null,
    approvedBy: plan.approvedBy ?? null,
    startedAt: plan.startedAt ?? null,
    completedAt: plan.completedAt ?? null,
    lastError: plan.lastError ?? null,
    evidence: Object.freeze(
      (plan.evidence ?? []).map(cloneEvidence),
    ),
    steps: Object.freeze(
      plan.steps.map((step) =>
        Object.freeze({
          ...step,
          acceptanceCriteria: Object.freeze([
            ...step.acceptanceCriteria,
          ]),
        }),
      ),
    ),
  });
}

function defaultCapabilities(): readonly CapabilityRecord[] {
  const createdAt = now();

  const defaults: Array<
    Omit<CapabilityRecord, "createdAt" | "updatedAt">
  > = [
    {
      id: "runtime.health.inspect",
      name: "Runtime Health Inspection",
      description:
        "Inspect kernel status, uptime, events and infrastructure health.",
      status: "operational",
      version: "1.0.0",
      confidence: 1,
      source: "verified-runtime",
    },
    {
      id: "runtime.stability.observe",
      name: "Runtime Stability Observation",
      description:
        "Observe runtime health continuously over a bounded time window.",
      status: "operational",
      version: "1.0.0",
      confidence: 1,
      source: "verified-mission-executor",
    },
    {
      id: "runtime.event.history.inspect",
      name: "Runtime Event History Inspection",
      description:
        "Inspect the bounded runtime event history and verify lifecycle evidence.",
      status: "experimental",
      version: "0.1.0",
      confidence: 0.5,
      source: "evolution-engine-candidate",
    },
    {
      id: "mission.queue.persist",
      name: "Persistent Mission Queue",
      description:
        "Persist queued and interrupted missions across runtime replacement.",
      status: "operational",
      version: "1.0.0",
      confidence: 1,
      source: "verified-mission-recovery",
    },
    {
      id: "mission.loop.execute",
      name: "MissionLoop Execution",
      description:
        "Execute one governed mission at a time and record the outcome.",
      status: "operational",
      version: "1.0.0",
      confidence: 1,
      source: "verified-mission-loop",
    },
    {
      id: "mission.recovery",
      name: "Mission Recovery",
      description:
        "Recover a running mission after unclean runtime shutdown.",
      status: "operational",
      version: "1.0.0",
      confidence: 1,
      source: "verified-sigkill-recovery",
    },
    {
      id: "governance.risk.assess",
      name: "Governance Risk Assessment",
      description:
        "Classify mission risk using a deterministic versioned policy.",
      status: "operational",
      version: "1.0.0",
      confidence: 1,
      source: "verified-governance-policy",
    },
    {
      id: "governance.approval.persist",
      name: "Persistent Approval Gate",
      description:
        "Persist approval decisions and block missions until authorized.",
      status: "operational",
      version: "1.0.0",
      confidence: 1,
      source: "verified-governance-engine",
    },
    {
      id: "capability.registry.read",
      name: "Capability Registry",
      description:
        "Maintain and query a persistent registry of Forge capabilities.",
      status: "operational",
      version: "1.0.0",
      confidence: 1,
      source: "capability-system-bootstrap",
    },
    {
      id: "capability.analysis.perform",
      name: "Capability Analysis",
      description:
        "Compare required capabilities with the current Forge capability state.",
      status: "operational",
      version: "1.0.0",
      confidence: 1,
      source: "capability-system-bootstrap",
    },
    {
      id: "evolution.plan.create",
      name: "Evolution Planning",
      description:
        "Create a deterministic improvement plan for capability gaps.",
      status: "operational",
      version: "1.0.0",
      confidence: 1,
      source: "capability-system-bootstrap",
    },
    {
      id: "evolution.plan.execute",
      name: "Controlled Evolution Execution",
      description:
        "Approve, verify and execute supported evolution plans without unverified promotion.",
      status: "operational",
      version: "1.0.0",
      confidence: 1,
      source: "evolution-engine-bootstrap",
    },
    {
      id: "project.memory.persist",
      name: "Persistent Project Memory",
      description:
        "Persist project decisions, architecture, requirements, tasks and evidence.",
      status: "operational",
      version: "1.0.0",
      confidence: 1,
      source: "operator-core-bootstrap",
    },
    {
      id: "prompt.context.compose",
      name: "Prompt Context Composition",
      description:
        "Compose grounded project prompts from persistent memory and approved source files.",
      status: "operational",
      version: "1.0.0",
      confidence: 1,
      source: "operator-core-bootstrap",
    },
    {
      id: "model.route.select",
      name: "AI Model Route Selection",
      description:
        "Select an abstract model profile using task, privacy, context, tools and budget constraints.",
      status: "operational",
      version: "1.0.0",
      confidence: 1,
      source: "operator-core-bootstrap",
    },
    {
      id: "tool.workspace.inspect",
      name: "Read-only Workspace Connector",
      description:
        "Inspect and read allowlisted project files with traversal, secret and size protections.",
      status: "operational",
      version: "1.0.0",
      confidence: 1,
      source: "operator-core-bootstrap",
    },
    {
      id: "ai.provider.execute",
      name: "Controlled AI Provider Execution",
      description:
        "Execute grounded compositions through the provider-independent AI Gateway.",
      status: "operational",
      version: "1.0.0",
      confidence: 1,
      source: "verified-ai-provider-execution",
    },
    {
      id: "evaluation.output.assess",
      name: "Deterministic Provider Output Evaluation",
      description:
        "Evaluate mission linkage, substance, verification guidance and secret safety before acceptance.",
      status: "operational",
      version: "1.0.0",
      confidence: 1,
      source: "autonomous-provider-loop",
    },
    {
      id: "mission.autonomous.continue",
      name: "Bounded Autonomous Mission Continuation",
      description:
        "Schedule the next evidence-backed mission within an explicitly approved cycle limit.",
      status: "operational",
      version: "1.0.0",
      confidence: 1,
      source: "autonomous-provider-loop",
    },
  ];

  return defaults.map((capability) =>
    Object.freeze({
      ...capability,
      createdAt,
      updatedAt: createdAt,
    }),
  );
}

export class CapabilityRegistry {
  readonly #events: RuntimeEventBus;
  readonly #stateStore: CapabilityStateStore;
  #state: PersistedCapabilityState = Object.freeze({
    version: CAPABILITY_STORE_VERSION,
    capabilities: Object.freeze([]),
    analyses: Object.freeze([]),
    plans: Object.freeze([]),
  });
  #initialized = false;
  #mutation = Promise.resolve();

  constructor(options: CapabilityRegistryOptions) {
    this.#events = options.events;
    this.#stateStore =
      options.stateStore ?? new FileCapabilityStateStore();
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
      throw new Error("CapabilityRegistry is not initialized");
    }
  }

  async #saveState(
    next: PersistedCapabilityState,
  ): Promise<void> {
    this.#state = Object.freeze({
      version: CAPABILITY_STORE_VERSION,
      capabilities: Object.freeze(
        next.capabilities.map(cloneCapability),
      ),
      analyses: Object.freeze(
        next.analyses.map(cloneAnalysis),
      ),
      plans: Object.freeze(
        next.plans.map(clonePlan),
      ),
    });

    await this.#stateStore.save(this.#state);
  }

  async initialize(): Promise<void> {
    await this.#mutate(async () => {
      if (this.#initialized) {
        return;
      }

      const loaded = await this.#stateStore.load();
      const existingIds = new Set(
        loaded.capabilities.map((capability) => capability.id),
      );
      const additions = defaultCapabilities().filter(
        (capability) => !existingIds.has(capability.id),
      );

      await this.#saveState({
        version: CAPABILITY_STORE_VERSION,
        capabilities: [
          ...loaded.capabilities,
          ...additions,
        ],
        analyses: loaded.analyses,
        plans: loaded.plans,
      });

      this.#initialized = true;

      this.#events.publish("capability.registry.loaded", {
        capabilityCount: this.#state.capabilities.length,
        analysisCount: this.#state.analyses.length,
        planCount: this.#state.plans.length,
      });
    });
  }

  listCapabilities(): readonly CapabilityRecord[] {
    this.#ensureInitialized();
    return this.#state.capabilities.map(cloneCapability);
  }

  getCapability(
    capabilityId: string,
  ): CapabilityRecord | null {
    this.#ensureInitialized();

    const capability = this.#state.capabilities.find(
      (candidate) => candidate.id === capabilityId,
    );

    return capability ? cloneCapability(capability) : null;
  }

  summary(): CapabilitySummary {
    this.#ensureInitialized();

    const counts = {
      unavailable: 0,
      experimental: 0,
      validated: 0,
      operational: 0,
    };

    for (const capability of this.#state.capabilities) {
      counts[capability.status] += 1;
    }

    return Object.freeze({
      total: this.#state.capabilities.length,
      ...counts,
      analyses: this.#state.analyses.length,
    });
  }

  evolutionSummary(): EvolutionPlanSummary {
    this.#ensureInitialized();

    const counts = {
      proposed: 0,
      approved: 0,
      executing: 0,
      completed: 0,
      cancelled: 0,
    };

    for (const plan of this.#state.plans) {
      counts[plan.status] += 1;
    }

    return Object.freeze({
      total: this.#state.plans.length,
      ...counts,
    });
  }

  async upsert(
    request: UpsertCapabilityRequest,
  ): Promise<CapabilityRecord> {
    this.#ensureInitialized();

    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(request.id)) {
      throw new Error("capability id has an invalid format");
    }

    if (!statuses.has(request.status)) {
      throw new Error("capability status is invalid");
    }

    return this.#mutate(async () => {
      const index = this.#state.capabilities.findIndex(
        (capability) => capability.id === request.id,
      );
      const timestamp = now();
      const existing =
        index < 0 ? null : this.#state.capabilities[index];

      const capability = cloneCapability({
        id: request.id,
        name: requiredText(request.name, "name"),
        description: requiredText(
          request.description,
          "description",
        ),
        status: request.status,
        version: requiredText(request.version, "version"),
        confidence: confidence(request.confidence),
        source: requiredText(request.source, "source"),
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      });

      const capabilities = [...this.#state.capabilities];

      if (index < 0) {
        capabilities.push(capability);
      } else {
        capabilities[index] = capability;
      }

      await this.#saveState({
        ...this.#state,
        capabilities,
      });

      this.#events.publish(
        existing === null
          ? "capability.registered"
          : "capability.updated",
        {
          capabilityId: capability.id,
          status: capability.status,
          confidence: capability.confidence,
        },
      );

      return cloneCapability(capability);
    });
  }

  async promoteCapability(
    capabilityId: string,
    targetStatus: CapabilityStatus,
    source: string,
  ): Promise<CapabilityRecord> {
    const current = this.getCapability(capabilityId);

    if (current === null) {
      throw new Error(`Capability not found: ${capabilityId}`);
    }

    return this.upsert({
      id: current.id,
      name: current.name,
      description: current.description,
      status: targetStatus,
      version: current.version,
      confidence: 1,
      source,
    });
  }

  listAnalyses(): readonly CapabilityAnalysisRecord[] {
    this.#ensureInitialized();
    return this.#state.analyses.map(cloneAnalysis);
  }

  getAnalysis(
    analysisId: string,
  ): CapabilityAnalysisRecord | null {
    this.#ensureInitialized();

    const analysis = this.#state.analyses.find(
      (candidate) => candidate.id === analysisId,
    );

    return analysis ? cloneAnalysis(analysis) : null;
  }

  async recordAnalysis(
    analysis: CapabilityAnalysisRecord,
  ): Promise<CapabilityAnalysisRecord> {
    this.#ensureInitialized();

    return this.#mutate(async () => {
      const stored = cloneAnalysis(analysis);

      await this.#saveState({
        ...this.#state,
        analyses: [
          ...this.#state.analyses,
          stored,
        ],
      });

      this.#events.publish(
        "capability.analysis.completed",
        {
          analysisId: stored.id,
          decision: stored.decision,
          gapCount: stored.gaps.length,
        },
      );

      return cloneAnalysis(stored);
    });
  }

  listPlans(): readonly EvolutionPlanRecord[] {
    this.#ensureInitialized();
    return this.#state.plans.map(clonePlan);
  }

  getPlan(
    planId: string,
  ): EvolutionPlanRecord | null {
    this.#ensureInitialized();

    const plan = this.#state.plans.find(
      (candidate) => candidate.id === planId,
    );

    return plan ? clonePlan(plan) : null;
  }

  async recordPlan(
    plan: EvolutionPlanRecord,
  ): Promise<EvolutionPlanRecord> {
    this.#ensureInitialized();

    return this.#mutate(async () => {
      const stored = clonePlan(plan);

      await this.#saveState({
        ...this.#state,
        plans: [
          ...this.#state.plans,
          stored,
        ],
      });

      this.#events.publish("evolution.plan.created", {
        planId: stored.id,
        analysisId: stored.analysisId,
        roiScore: stored.roiScore,
        stepCount: stored.steps.length,
      });

      return clonePlan(stored);
    });
  }

  approvePlan(
    planId: string,
    actor: string,
  ): Promise<EvolutionPlanRecord> {
    return this.#updatePlan(planId, (current) => {
      if (current.status === "approved") {
        return current;
      }

      if (current.status !== "proposed") {
        throw new Error(
          `Evolution plan ${planId} cannot be approved from ${current.status}`,
        );
      }

      const timestamp = now();

      return {
        ...current,
        status: "approved",
        approvedAt: timestamp,
        approvedBy: requiredText(actor, "actor"),
        updatedAt: timestamp,
        lastError: null,
      };
    }, "evolution.plan.approved");
  }

  beginPlanExecution(
    planId: string,
  ): Promise<EvolutionPlanRecord> {
    return this.#updatePlan(planId, (current) => {
      if (current.status !== "approved") {
        throw new Error(
          `Evolution plan ${planId} requires approval before execution`,
        );
      }

      const timestamp = now();

      return {
        ...current,
        status: "executing",
        startedAt: timestamp,
        completedAt: null,
        updatedAt: timestamp,
        lastError: null,
        evidence: [],
      };
    }, "evolution.plan.started");
  }

  completePlan(
    planId: string,
    evidence: readonly EvolutionVerificationEvidence[],
  ): Promise<EvolutionPlanRecord> {
    return this.#updatePlan(planId, (current) => {
      if (current.status !== "executing") {
        throw new Error(
          `Evolution plan ${planId} is not executing`,
        );
      }

      const timestamp = now();

      return {
        ...current,
        status: "completed",
        completedAt: timestamp,
        updatedAt: timestamp,
        lastError: null,
        evidence: evidence.map(cloneEvidence),
      };
    }, "evolution.plan.completed");
  }

  failPlan(
    planId: string,
    error: string,
  ): Promise<EvolutionPlanRecord> {
    return this.#updatePlan(planId, (current) => {
      const timestamp = now();

      return {
        ...current,
        status: "cancelled",
        completedAt: timestamp,
        updatedAt: timestamp,
        lastError: error,
      };
    }, "evolution.plan.failed");
  }

  async #updatePlan(
    planId: string,
    update: (
      current: EvolutionPlanRecord,
    ) => EvolutionPlanRecord,
    eventType:
      | "evolution.plan.approved"
      | "evolution.plan.started"
      | "evolution.plan.completed"
      | "evolution.plan.failed",
  ): Promise<EvolutionPlanRecord> {
    this.#ensureInitialized();

    return this.#mutate(async () => {
      const index = this.#state.plans.findIndex(
        (plan) => plan.id === planId,
      );

      if (index < 0) {
        throw new Error(`Evolution plan not found: ${planId}`);
      }

      const updated = clonePlan(
        update(clonePlan(this.#state.plans[index])),
      );
      const plans = [...this.#state.plans];
      plans[index] = updated;

      await this.#saveState({
        ...this.#state,
        plans,
      });

      this.#events.publish(eventType, {
        planId,
        status: updated.status,
        error: updated.lastError,
      });

      return clonePlan(updated);
    });
  }
}
