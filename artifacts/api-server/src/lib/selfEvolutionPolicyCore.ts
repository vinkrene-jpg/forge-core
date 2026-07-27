import { CORE_COMPONENTS, isProtectedPath } from "./corelock";

export type AuthorityLevel = "sandbox-only" | "isolated-module-root" | "bounded-extension-root";

export const REQUIRED_AUTONOMOUS_GATES = [
  "typecheck",
  "build",
  "unit",
  "scope-integrity",
] as const;

export const ABSOLUTE_STOP_ACTIONS = [
  "production-deploy",
  "database-drop",
  "database-delete",
  "security-change",
  "auth-change",
  "irreversible-action",
] as const;

export const MACHINE_CORE_RULES = {
  lockedComponents: CORE_COMPONENTS.map((component) => component.key),
  alwaysForbiddenActions: [...ABSOLUTE_STOP_ACTIONS],
  authority: {
    "sandbox-only": {
      allowedScope: "sandbox-only",
      allowedRoot: "Forge sandbox directory only",
    },
    "isolated-module-root": {
      allowedScope: "isolated-module-root",
      allowedRoot: "extensions/isolated/",
    },
    "bounded-extension-root": {
      allowedScope: "bounded-extension-root",
      allowedRoot: "extensions/",
    },
  },
  successCriteria: [...REQUIRED_AUTONOMOUS_GATES],
} as const;

export interface EvolutionManifest {
  name: string;
  version: string;
  paths: string[];
  scope: "sandbox-only" | "isolated-module-root" | "bounded-extension-root";
  actions: string[];
  acceptance: string[];
}

export interface PolicyTrackRecord {
  successfulReleases: number;
  scopeViolations: number;
}

export function deriveAuthorityLevel(record: PolicyTrackRecord): AuthorityLevel {
  if (record.scopeViolations > 0) return "sandbox-only";
  if (record.successfulReleases >= 10) return "bounded-extension-root";
  if (record.successfulReleases >= 3) return "isolated-module-root";
  return "sandbox-only";
}

export function parseEvolutionManifest(raw: string | null | undefined): {
  manifest: EvolutionManifest | null;
  errors: string[];
} {
  if (!raw) return { manifest: null, errors: ["Manifest ontbreekt."] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { manifest: null, errors: ["Manifest is geen geldige JSON."] };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { manifest: null, errors: ["Manifest moet een object zijn."] };
  }

  const value = parsed as Record<string, unknown>;
  const errors: string[] = [];
  const validScopes = ["sandbox-only", "isolated-module-root", "bounded-extension-root"];

  if (typeof value.name !== "string" || value.name.length === 0) errors.push("Manifestnaam ontbreekt.");
  if (typeof value.version !== "string" || value.version.length === 0) errors.push("Manifestversie ontbreekt.");
  if (!Array.isArray(value.paths) || value.paths.some((item) => typeof item !== "string")) {
    errors.push("Manifest paths moet een lijst met strings zijn.");
  }
  if (typeof value.scope !== "string" || !validScopes.includes(value.scope)) {
    errors.push("Manifest scope is ongeldig.");
  }
  if (!Array.isArray(value.actions) || value.actions.some((item) => typeof item !== "string")) {
    errors.push("Manifest actions moet een lijst met strings zijn.");
  }
  if (!Array.isArray(value.acceptance) || value.acceptance.some((item) => typeof item !== "string")) {
    errors.push("Manifest acceptance moet een lijst met strings zijn.");
  }

  if (errors.length > 0) return { manifest: null, errors };

  return {
    manifest: {
      name: value.name as string,
      version: value.version as string,
      paths: value.paths as string[],
      scope: value.scope as EvolutionManifest["scope"],
      actions: value.actions as string[],
      acceptance: value.acceptance as string[],
    },
    errors: [],
  };
}

export function isAbsoluteStopAction(action: string): boolean {
  const normalized = action.trim().toLowerCase();
  return ABSOLUTE_STOP_ACTIONS.some(
    (blocked) => normalized === blocked || normalized.startsWith(`${blocked}:`),
  );
}

export function pathAllowedForAuthority(
  filePath: string,
  scope: EvolutionManifest["scope"],
  authority: AuthorityLevel,
): boolean {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\/+/, "");

  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) return false;
  if (normalized.split("/").includes("..")) return false;
  if (isProtectedPath(normalized)) return false;

  if (scope === "sandbox-only") return true;
  if (scope === "isolated-module-root") {
    return authority !== "sandbox-only" && normalized.startsWith("extensions/isolated/");
  }
  return authority === "bounded-extension-root" && normalized.startsWith("extensions/");
}

const CONTENT_STOP_PATTERNS: { label: string; expression: RegExp }[] = [
  { label: "productie-deploy", expression: /\b(kubectl\s+apply|docker\s+push|npm\s+publish|production\s+deploy)\b/i },
  { label: "database verwijderen", expression: /\b(drop\s+database|drop\s+table|truncate\s+table)\b/i },
  { label: "security/auth wijzigen", expression: /\b(disable\s+auth|bypass\s+auth|replace\s+authentication|security\s+override)\b/i },
  { label: "onomkeerbare verwijdering", expression: /\b(rm\s+-rf|remove-item\s+.+-recurse.+-force|format-volume)\b/i },
];

export function detectAbsoluteStopReasons(
  manifest: EvolutionManifest,
  files: { path: string; content: string }[],
): string[] {
  const reasons = manifest.actions
    .filter(isAbsoluteStopAction)
    .map((action) => `Absolute stopactie gedeclareerd: ${action}`);

  for (const file of files) {
    const normalizedPath = file.path.replace(/\\/g, "/").toLowerCase();
    if (/(^|\/)(auth|authentication|security)(\/|\.|$)/.test(normalizedPath)) {
      reasons.push(`Security/auth-pad vereist menselijke bevestiging: ${file.path}`);
    }
    if (/(^|\/)(deploy|production|migrations?|database)(\/|\.|$)/.test(normalizedPath)) {
      reasons.push(`Productie/database-pad vereist menselijke bevestiging: ${file.path}`);
    }
    for (const pattern of CONTENT_STOP_PATTERNS) {
      if (pattern.expression.test(file.content)) {
        reasons.push(`${pattern.label} gedetecteerd in ${file.path}`);
      }
    }
  }

  return [...new Set(reasons)];
}