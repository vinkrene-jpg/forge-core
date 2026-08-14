import { randomUUID } from "node:crypto";
import type { CapabilityRecord } from "./capability";
import type { MissionRecord } from "./mission";
import {
  parseWorkspaceChangeRequest,
  type WorkspaceChangeRequest,
} from "./workspace-executor";

export interface GoalAcceptanceCriterion {
  readonly id: string;
  readonly statement: string;
  readonly evidence: string;
}

export interface GoalSpec {
  readonly objective: string;
  readonly desiredBehavior: readonly string[];
  readonly constraints: readonly string[];
  readonly acceptanceCriteria: readonly GoalAcceptanceCriterion[];
}

export interface BuildGraphComponentProposal {
  readonly id: string;
  readonly title: string;
  readonly dependsOn: readonly string[];
  readonly targets: readonly string[];
  readonly acceptanceCriteria: readonly GoalAcceptanceCriterion[];
  readonly requiredCapabilities: readonly string[];
  readonly workspaceChange: WorkspaceChangeRequest;
}

export interface BuildGraphProposal {
  readonly repositoryId: "forge-core";
  readonly components: readonly BuildGraphComponentProposal[];
}

export interface BuildGraphNode extends BuildGraphComponentProposal {
  readonly missionId: string;
}

export interface BuildGraph {
  readonly id: string;
  readonly repositoryId: "forge-core";
  readonly goalSpec: GoalSpec;
  readonly nodes: readonly BuildGraphNode[];
  readonly createdAt: string;
}

export interface BuildGraphIntegrationEvaluation {
  readonly graphId: string;
  readonly decision: "accepted" | "blocked" | "rejected";
  readonly nodeMissionIds: readonly string[];
  readonly learningEligible: boolean;
  readonly evaluatedAt: string;
}

function record(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }

  return value as Readonly<Record<string, unknown>>;
}

function text(value: unknown, field: string, maxLength = 2_000): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }

  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(`${field} exceeds ${maxLength} characters`);
  }

  return normalized;
}

function texts(value: unknown, field: string, maximum: number): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
    throw new Error(`${field} must contain between 1 and ${maximum} items`);
  }

  return Object.freeze(value.map((item, index) => text(item, `${field}[${index}]`, 500)));
}

function dependencies(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 1) {
    throw new Error(`${field} must contain at most one item`);
  }

  return Object.freeze(value.map((item, index) => text(item, `${field}[${index}]`, 100)));
}

function criteria(value: unknown, field: string): readonly GoalAcceptanceCriterion[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new Error(`${field} must contain between 1 and 20 criteria`);
  }

  const seen = new Set<string>();
  return Object.freeze(value.map((item, index) => {
    const candidate = record(item, `${field}[${index}]`);
    const id = text(candidate.id, `${field}[${index}].id`, 100);
    const statement = text(candidate.statement, `${field}[${index}].statement`, 500);
    const evidence = text(candidate.evidence, `${field}[${index}].evidence`, 500);

    if (statement.length < 12 || evidence.length < 8) {
      throw new Error(`${field}[${index}] must state a concrete outcome and evidence`);
    }
    if (seen.has(id)) {
      throw new Error(`${field} contains duplicate criterion id: ${id}`);
    }
    seen.add(id);
    return Object.freeze({ id, statement, evidence });
  }));
}

export function parseGoalSpec(value: unknown): GoalSpec {
  const candidate = record(value, "goalSpec");
  return Object.freeze({
    objective: text(candidate.objective, "goalSpec.objective", 2_000),
    desiredBehavior: texts(candidate.desiredBehavior, "goalSpec.desiredBehavior", 20),
    constraints: texts(candidate.constraints, "goalSpec.constraints", 20),
    acceptanceCriteria: criteria(candidate.acceptanceCriteria, "goalSpec.acceptanceCriteria"),
  });
}

export function parseBuildGraphProposal(
  value: unknown,
  capabilities: readonly CapabilityRecord[],
): BuildGraphProposal {
  const candidate = record(value, "buildGraph");
  if (candidate.repositoryId !== "forge-core") {
    throw new Error("buildGraph.repositoryId must equal forge-core");
  }
  if (!Array.isArray(candidate.components) || candidate.components.length < 1 || candidate.components.length > 2) {
    throw new Error("buildGraph.components must contain one or two components");
  }

  const availableCapabilities = new Set(
    capabilities
      .filter((capability) => capability.status === "operational")
      .map((capability) => capability.id),
  );
  const ids = new Set<string>();
  let dependencyCount = 0;

  const components = candidate.components.map((item, index) => {
    const component = record(item, `buildGraph.components[${index}]`);
    const id = text(component.id, `buildGraph.components[${index}].id`, 100);
    if (ids.has(id)) {
      throw new Error(`Duplicate component id: ${id}`);
    }
    ids.add(id);

    const dependsOn = component.dependsOn === undefined
      ? Object.freeze([])
      : dependencies(component.dependsOn, `buildGraph.components[${index}].dependsOn`);
    dependencyCount += dependsOn.length;
    const targets = texts(component.targets, `buildGraph.components[${index}].targets`, 20);
    const requiredCapabilities = texts(
      component.requiredCapabilities,
      `buildGraph.components[${index}].requiredCapabilities`,
      20,
    );
    const workspaceChange = parseWorkspaceChangeRequest(
      record(component.workspaceChange, `buildGraph.components[${index}].workspaceChange`),
    );
    const changeTargets = workspaceChange.changes.map((change) => change.path);

    if (new Set(targets).size !== targets.length || JSON.stringify(targets) !== JSON.stringify(changeTargets)) {
      throw new Error(`Component ${id} targets must exactly match workspace changes`);
    }
    for (const capabilityId of requiredCapabilities) {
      if (!availableCapabilities.has(capabilityId)) {
        throw new Error(`Component ${id} requires unavailable capability: ${capabilityId}`);
      }
    }
    for (const verification of ["typecheck", "test", "build"] as const) {
      if (!workspaceChange.verification.includes(verification)) {
        throw new Error(`Component ${id} must require ${verification} verification`);
      }
    }

    return Object.freeze({
      id,
      title: text(component.title, `buildGraph.components[${index}].title`, 200),
      dependsOn,
      targets,
      acceptanceCriteria: criteria(
        component.acceptanceCriteria,
        `buildGraph.components[${index}].acceptanceCriteria`,
      ),
      requiredCapabilities,
      workspaceChange,
    });
  });

  if (dependencyCount > 1) {
    throw new Error("Build graph may contain at most one dependency");
  }
  for (const component of components) {
    for (const dependencyId of component.dependsOn) {
      if (!ids.has(dependencyId)) {
        throw new Error(`Component ${component.id} has unknown dependency: ${dependencyId}`);
      }
      if (dependencyId === component.id) {
        throw new Error(`Component ${component.id} cannot depend on itself`);
      }
    }
  }

  return Object.freeze({ repositoryId: "forge-core", components: Object.freeze(components) });
}

export function createBuildGraph(
  goalSpec: GoalSpec,
  proposal: BuildGraphProposal,
  missionIds: ReadonlyMap<string, string>,
  missionExists: (missionId: string) => boolean,
  graphId = randomUUID(),
): BuildGraph {
  const coveredCriteria = new Set(
    proposal.components.flatMap((component) =>
      component.acceptanceCriteria.map((criterion) => criterion.id)
    ),
  );
  for (const criterion of goalSpec.acceptanceCriteria) {
    if (!coveredCriteria.has(criterion.id)) {
      throw new Error(`Goal acceptance criterion is not covered by a component: ${criterion.id}`);
    }
  }

  const seenMissionIds = new Set<string>();
  const nodes = proposal.components.map((component) => {
    const missionId = missionIds.get(component.id);
    if (!missionId || !missionExists(missionId)) {
      throw new Error(`Component ${component.id} has no existing missionId`);
    }
    if (seenMissionIds.has(missionId)) {
      throw new Error(`Build graph contains duplicate missionId: ${missionId}`);
    }
    seenMissionIds.add(missionId);
    return Object.freeze({ ...component, missionId });
  });

  return Object.freeze({
    id: graphId,
    repositoryId: proposal.repositoryId,
    goalSpec,
    nodes: Object.freeze(nodes),
    createdAt: new Date().toISOString(),
  });
}

export function evaluateBuildGraphIntegration(
  graph: BuildGraph,
  getMission: (missionId: string) => MissionRecord | null,
): BuildGraphIntegrationEvaluation {
  let decision: BuildGraphIntegrationEvaluation["decision"] = "accepted";

  for (const node of graph.nodes) {
    const mission = getMission(node.missionId);
    if (!mission || mission.kind !== "operator.workspace-change") {
      decision = "rejected";
      break;
    }
    if (mission.status === "failed" || mission.status === "cancelled") {
      decision = "rejected";
      break;
    }
    const rawEvaluation = mission.output?.evaluation;
    const evaluation = typeof rawEvaluation === "object" && rawEvaluation !== null && !Array.isArray(rawEvaluation)
      ? rawEvaluation as Readonly<Record<string, unknown>>
      : null;
    if (mission.status !== "succeeded" || evaluation?.decision !== "accepted") {
      decision = "blocked";
    }
  }

  return Object.freeze({
    graphId: graph.id,
    decision,
    nodeMissionIds: Object.freeze(graph.nodes.map((node) => node.missionId)),
    learningEligible: decision === "accepted",
    evaluatedAt: new Date().toISOString(),
  });
}