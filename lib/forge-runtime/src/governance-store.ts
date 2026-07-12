import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  GOVERNANCE_POLICY_VERSION,
  type ApprovalRecord,
  type ApprovalStatus,
  type GovernanceAssessment,
  type GovernanceDecision,
  type GovernanceRiskLevel,
} from "./governance";
import type { MissionKind } from "./mission";

export const GOVERNANCE_STORE_VERSION = 1 as const;

export interface PersistedGovernanceState {
  readonly version: typeof GOVERNANCE_STORE_VERSION;
  readonly approvals: readonly ApprovalRecord[];
}

export interface GovernanceStateStore {
  load(): Promise<PersistedGovernanceState>;
  save(state: PersistedGovernanceState): Promise<void>;
}

const missionKinds = new Set<MissionKind>([
  "runtime.self-check",
  "runtime.stability-window",
  "operator.autonomous-cycle",
]);

const riskLevels = new Set<GovernanceRiskLevel>([
  "low",
  "medium",
  "high",
  "critical",
]);

const decisions = new Set<GovernanceDecision>([
  "allow",
  "require_approval",
  "deny",
]);

const approvalStatuses = new Set<ApprovalStatus>([
  "pending",
  "approved",
  "rejected",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function assertAssessment(
  value: unknown,
): asserts value is GovernanceAssessment {
  if (!isRecord(value)) {
    throw new Error("Persisted governance assessment must be an object");
  }

  if (value.policyVersion !== GOVERNANCE_POLICY_VERSION) {
    throw new Error("Unsupported governance policy version");
  }

  if (value.action !== "mission.execute") {
    throw new Error("Persisted governance action is invalid");
  }

  if (!missionKinds.has(value.missionKind as MissionKind)) {
    throw new Error("Persisted governance mission kind is invalid");
  }

  if (!riskLevels.has(value.riskLevel as GovernanceRiskLevel)) {
    throw new Error("Persisted governance risk level is invalid");
  }

  if (!decisions.has(value.decision as GovernanceDecision)) {
    throw new Error("Persisted governance decision is invalid");
  }

  if (
    typeof value.reason !== "string" ||
    value.reason.length === 0
  ) {
    throw new Error("Persisted governance reason is invalid");
  }

  if (typeof value.assessedAt !== "string") {
    throw new Error("Persisted governance assessedAt is invalid");
  }
}

function assertApprovalRecord(
  value: unknown,
): asserts value is ApprovalRecord {
  if (!isRecord(value)) {
    throw new Error("Persisted approval must be an object");
  }

  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new Error("Persisted approval id is invalid");
  }

  if (
    typeof value.missionId !== "string" ||
    value.missionId.length === 0
  ) {
    throw new Error("Persisted approval missionId is invalid");
  }

  if (!approvalStatuses.has(value.status as ApprovalStatus)) {
    throw new Error("Persisted approval status is invalid");
  }

  assertAssessment(value.assessment);

  for (const field of ["createdAt", "updatedAt"] as const) {
    if (typeof value[field] !== "string") {
      throw new Error(`Persisted approval ${field} is invalid`);
    }
  }

  if (!isNullableString(value.decidedAt)) {
    throw new Error("Persisted approval decidedAt is invalid");
  }

  if (!isNullableString(value.decidedBy)) {
    throw new Error("Persisted approval decidedBy is invalid");
  }

  if (!isNullableString(value.note)) {
    throw new Error("Persisted approval note is invalid");
  }
}

function assertPersistedGovernanceState(
  value: unknown,
): asserts value is PersistedGovernanceState {
  if (!isRecord(value)) {
    throw new Error("Persisted governance state must be an object");
  }

  if (value.version !== GOVERNANCE_STORE_VERSION) {
    throw new Error("Unsupported governance store version");
  }

  if (!Array.isArray(value.approvals)) {
    throw new Error("Persisted approvals must be an array");
  }

  for (const approval of value.approvals) {
    assertApprovalRecord(approval);
  }
}

export function createInitialGovernanceState(): PersistedGovernanceState {
  return Object.freeze({
    version: GOVERNANCE_STORE_VERSION,
    approvals: Object.freeze([]),
  });
}

export function resolveGovernanceStatePath(): string {
  const explicitPath =
    process.env.FORGE_GOVERNANCE_STATE_PATH?.trim();

  if (explicitPath) {
    return explicitPath;
  }

  const storageRoot =
    process.env.STORAGE_DIR?.trim() || path.resolve("storage");

  return path.join(
    storageRoot,
    "forge-runtime",
    "governance.json",
  );
}

export class FileGovernanceStateStore
  implements GovernanceStateStore
{
  readonly #filePath: string;

  constructor(filePath = resolveGovernanceStatePath()) {
    this.#filePath = filePath;
  }

  async load(): Promise<PersistedGovernanceState> {
    let raw: string;

    try {
      raw = await readFile(this.#filePath, "utf8");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return createInitialGovernanceState();
      }

      throw error;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        "Governance state file contains invalid JSON: " +
          this.#filePath,
      );
    }

    assertPersistedGovernanceState(parsed);

    return Object.freeze({
      version: parsed.version,
      approvals: Object.freeze(
        parsed.approvals.map((approval) =>
          Object.freeze({
            ...approval,
            assessment: Object.freeze({
              ...approval.assessment,
            }),
          }),
        ),
      ),
    });
  }

  async save(state: PersistedGovernanceState): Promise<void> {
    const directory = path.dirname(this.#filePath);

    await mkdir(directory, { recursive: true });

    const temporaryPath =
      this.#filePath +
      "." +
      process.pid +
      "." +
      Date.now() +
      ".tmp";

    await writeFile(
      temporaryPath,
      JSON.stringify(state, null, 2) + "\n",
      "utf8",
    );

    try {
      await rename(temporaryPath, this.#filePath);
    } catch {
      await rm(this.#filePath, { force: true });
      await rename(temporaryPath, this.#filePath);
    }
  }
}
