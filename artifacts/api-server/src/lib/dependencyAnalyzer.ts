// Dependency Analyzer: scans all workspace package.json files, maps every
// dependency to the packages using it and flags version mismatches.

import fs from "fs";
import path from "path";
import { workspaceRoot } from "./codeScan";
import { audit } from "./audit";
import type { Finding } from "./qualityAnalyzer";

export interface DependencyEntry {
  name: string;
  versions: string[];
  usedBy: string[];
}

export interface DependencyReport {
  generatedAt: string;
  packagesScanned: number;
  dependencies: DependencyEntry[];
  mismatches: string[];
  findings: Finding[];
}

function listPackageJsons(): string[] {
  const out: string[] = [];
  for (const group of ["artifacts", "lib"]) {
    const dir = path.join(workspaceRoot, group);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkg = path.join(group, entry.name, "package.json");
      if (fs.existsSync(path.join(workspaceRoot, pkg))) out.push(pkg);
    }
  }
  if (fs.existsSync(path.join(workspaceRoot, "scripts/package.json"))) out.push("scripts/package.json");
  return out;
}

export function computeDependencyReport(
  packages: { file: string; deps: Record<string, string> }[],
): { dependencies: DependencyEntry[]; mismatches: string[]; findings: Finding[] } {
  const map = new Map<string, { versions: Map<string, true>; usedBy: string[] }>();
  for (const pkg of packages) {
    for (const [name, version] of Object.entries(pkg.deps)) {
      const entry = map.get(name) ?? { versions: new Map<string, true>(), usedBy: [] as string[] };
      entry.versions.set(version, true);
      entry.usedBy.push(pkg.file);
      map.set(name, entry);
    }
  }
  const dependencies = [...map.entries()]
    .map(([name, e]) => ({ name, versions: [...e.versions.keys()].sort(), usedBy: e.usedBy.sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const mismatches: string[] = [];
  const findings: Finding[] = [];
  for (const d of dependencies) {
    // "catalog:" and "workspace:*" are pinned centrally and never mismatch.
    const real = d.versions.filter((v) => !v.startsWith("catalog") && !v.startsWith("workspace"));
    if (new Set(real).size > 1) {
      mismatches.push(`${d.name}: ${d.versions.join(", ")} (${d.usedBy.join(", ")})`);
      findings.push({
        code: "version-mismatch",
        severity: "warning",
        file: null,
        message: `Dependency '${d.name}' has diverging versions: ${d.versions.join(", ")}.`,
      });
    }
  }
  return { dependencies, mismatches, findings };
}

export async function analyzeDependencies(): Promise<DependencyReport> {
  const packages = listPackageJsons().map((file) => {
    let deps: Record<string, string> = {};
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(workspaceRoot, file), "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      deps = { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) };
    } catch {
      /* unparsable package.json: skipped */
    }
    return { file, deps };
  });
  const { dependencies, mismatches, findings } = computeDependencyReport(packages);
  const report: DependencyReport = {
    generatedAt: new Date().toISOString(),
    packagesScanned: packages.length,
    dependencies,
    mismatches,
    findings,
  };
  await audit({
    actor: "dependency-analyzer",
    action: "dependency_analysis_completed",
    targetType: "analysis",
    details: `${packages.length} package(s) scanned; ${dependencies.length} unique dependencies; ${mismatches.length} version mismatch(es).`,
  });
  return report;
}
