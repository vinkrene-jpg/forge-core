// Technical Debt Analyzer: detects debt signals in Forge's own source code.
// Read-only; findings can be turned into improvements by the Refactoring Engine.

import { scanSourceFiles, type ScannedFile } from "./codeScan";
import { audit } from "./audit";
import type { Finding, AnalysisReport } from "./qualityAnalyzer";

export function computeDebtFindings(files: ScannedFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const f of files) {
    const todos = (f.content.match(/\/\/\s*(TODO|FIXME|HACK|XXX)\b/g) ?? []).length;
    if (todos > 0) {
      findings.push({ code: "todo-markers", severity: todos > 3 ? "warning" : "info", file: f.file, message: `${todos} TODO/FIXME/HACK marker(s).` });
    }
    const skipped = (f.content.match(/\btest\.skip\(|\bit\.skip\(|\bdescribe\.skip\(/g) ?? []).length;
    if (skipped > 0) {
      findings.push({ code: "skipped-tests", severity: "warning", file: f.file, message: `${skipped} skipped test(s).` });
    }
    const deprecated = (f.content.match(/@deprecated\b/g) ?? []).length;
    if (deprecated > 0) {
      findings.push({ code: "deprecated-code", severity: "info", file: f.file, message: `${deprecated} @deprecated marker(s).` });
    }
    if (f.lines > 600) {
      findings.push({ code: "oversized-module", severity: "warning", file: f.file, message: `${f.lines} lines; oversized modules accumulate debt.` });
    }
  }

  // Duplicate route paths across the API server (same method+path registered twice).
  const routeRe = /router\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g;
  const seen = new Map<string, string>();
  for (const f of files.filter((x) => x.file.startsWith("artifacts/api-server/src/routes/"))) {
    for (const m of f.content.matchAll(routeRe)) {
      const key = `${m[1].toUpperCase()} ${m[2]}`;
      const prev = seen.get(key);
      if (prev) {
        findings.push({ code: "duplicate-route", severity: "critical", file: f.file, message: `Route '${key}' also registered in ${prev}.` });
      } else {
        seen.set(key, f.file);
      }
    }
  }
  return findings;
}

export async function analyzeTechnicalDebt(): Promise<AnalysisReport> {
  const files = scanSourceFiles();
  const findings = computeDebtFindings(files);
  const penalty = findings.reduce((s, f) => s + (f.severity === "critical" ? 10 : f.severity === "warning" ? 3 : 1), 0);
  const score = Math.max(0, 100 - penalty);
  const report: AnalysisReport = {
    generatedAt: new Date().toISOString(),
    analyzer: "technical-debt",
    filesScanned: files.length,
    score,
    findings,
    summary: `${files.length} files scanned; ${findings.length} debt signal(s); debt score ${score}/100 (higher is better).`,
  };
  await audit({
    actor: "debt-analyzer",
    action: "debt_analysis_completed",
    targetType: "analysis",
    details: report.summary,
  });
  return report;
}
