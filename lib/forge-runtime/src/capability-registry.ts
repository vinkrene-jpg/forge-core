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

function clonePlan(
  plan: EvolutionPlanRecord,
): EvolutionPlanRecord {
  return Object.freeze({
    ...plan,
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

      this.#state = Object.freeze({
        version: CAPABILITY_STORE_VERSION,
        capabilities: Object.freeze([
          ...loaded.capabilities.map(cloneCapability),
          ...additions,
        ]),
        analyses: Object.freeze(
          loaded.analyses.map(cloneAnalysis),
        ),
        plans: Object.freeze(
          loaded.plans.map(clonePlan),
        ),
      });

      if (additions.length > 0) {
        await this.#stateStore.save(this.#state);
      }

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

      this.#state = Object.freeze({
        ...this.#state,
        capabilities: Object.freeze(capabilities),
      });

      await this.#stateStore.save(this.#state);

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

      this.#state = Object.freeze({
        ...this.#state,
        analyses: Object.freeze([
          ...this.#state.analyses,
          stored,
        ]),
      });

      await this.#stateStore.save(this.#state);

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

      this.#state = Object.freeze({
        ...this.#state,
        plans: Object.freeze([
          ...this.#state.plans,
          stored,
        ]),
      });

      await this.#stateStore.save(this.#state);

      this.#events.publish("evolution.plan.created", {
        planId: stored.id,
        analysisId: stored.analysisId,
        roiScore: stored.roiScore,
        stepCount: stored.steps.length,
      });

      return clonePlan(stored);
    });
  }
}