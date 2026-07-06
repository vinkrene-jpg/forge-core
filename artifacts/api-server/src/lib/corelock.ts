// Locked Core protection rules. Modules and sandboxes may never touch these.

export const CORE_COMPONENTS: { key: string; name: string; description: string }[] = [
  { key: "ai-gateway", name: "AI Gateway", description: "Central gateway for all AI provider calls" },
  { key: "planner", name: "Planner", description: "Plans work and produces execution plans" },
  { key: "task-manager", name: "Task Manager", description: "Manages projects, goals, backlog and tasks" },
  { key: "module-manager", name: "Module Manager", description: "Manages module lifecycle and manifests" },
  { key: "sandbox-manager", name: "Sandbox Manager", description: "Isolated workspaces for module development" },
  { key: "test-runner", name: "Test Runner", description: "Runs unit, integration, lint, build and security checks" },
  { key: "memory-engine", name: "Memory Engine", description: "Searchable long-term memory of lessons and outcomes" },
  { key: "security-engine", name: "Security Engine", description: "Security policies and reviews" },
  { key: "governance-engine", name: "Governance Engine", description: "Governor decision layer for installations" },
  { key: "approval-engine", name: "Approval Engine", description: "Approval workflow for risky changes" },
  { key: "rollback-engine", name: "Rollback Engine", description: "Snapshots and version restore" },
  { key: "audit-engine", name: "Audit Engine", description: "Immutable audit logging of all actions" },
  { key: "daily-report-engine", name: "Daily Report Engine", description: "Daily autonomous loop and reporting" },
];

const PROTECTED_PATH_PATTERNS: RegExp[] = [
  /^\/?core(\/|$)/i,
  /^\/?src\/core(\/|$)/i,
  /\.\./,
  /^\//,
  /^[a-zA-Z]:\\/,
];

export function isProtectedPath(filePath: string): boolean {
  const normalized = filePath.trim();
  if (PROTECTED_PATH_PATTERNS.some((re) => re.test(normalized))) return true;
  const lower = normalized.toLowerCase();
  return CORE_COMPONENTS.some(
    (c) => lower === `${c.key}.ts` || lower.startsWith(`${c.key}/`),
  );
}

export function coreAdminOverrideEnabled(): boolean {
  return process.env.CORE_ADMIN_OVERRIDE === "true";
}

export interface ManifestValidation {
  valid: boolean;
  errors: string[];
  touchesCore: boolean;
}

export function validateManifest(manifestRaw: string | null | undefined): ManifestValidation {
  if (manifestRaw == null || manifestRaw.trim() === "") {
    return { valid: false, errors: ["Manifest is required"], touchesCore: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestRaw);
  } catch {
    return { valid: false, errors: ["Manifest is not valid JSON"], touchesCore: false };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { valid: false, errors: ["Manifest must be a JSON object"], touchesCore: false };
  }
  const m = parsed as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof m.name !== "string" || m.name.length === 0) errors.push("Manifest must declare a 'name' (string)");
  if (typeof m.version !== "string" || m.version.length === 0) errors.push("Manifest must declare a 'version' (string)");
  if (m.entrypoint !== undefined && typeof m.entrypoint !== "string") errors.push("'entrypoint' must be a string");
  let touchesCore = false;
  if (m.paths !== undefined) {
    if (!Array.isArray(m.paths) || m.paths.some((p) => typeof p !== "string")) {
      errors.push("'paths' must be an array of strings");
    } else {
      touchesCore = (m.paths as string[]).some((p) => isProtectedPath(p));
    }
  }
  return { valid: errors.length === 0, errors, touchesCore };
}
