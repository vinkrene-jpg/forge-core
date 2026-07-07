// Quality Analyzer: static quality metrics over Forge's own source code.
// Read-only; findings can be turned into improvements by the Refactoring Engine.

import { scanSourceFiles, type ScannedFile } from "./codeScan";
import { audit } from "./audit";

export interface Finding {
  code: string;
  severity: "info" | "warning" | "critical";
  file: string | null;
  message: string;
}

export interface AnalysisReport {
  generatedAt: string;
  analyzer: string;
  filesScanned: number;
  score: number | null;
  findings: Finding[];
  summary: string;
}

export function computeQualityFindings(files: ScannedFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const f of files) {
    if (f.lines > 600) {
      findings.push({ code: "file-too-large", severity: "critical", file: f.file, message: `${f.lines} lines; split into smaller modules (>600).` });
    } else if (f.lines > 400) {
      findings.push({ code: "file-large", severity: "warning", file: f.file, message: `${f.lines} lines; consider splitting (>400).` });
    }
    const anyCount = (f.content.match(/\bas any\b|: any\b/g) ?? []).length;
    if (anyCount > 3) {
      findings.push({ code: "weak-typing", severity: "warning", file: f.file, message: `${anyCount} uses of 'any'; strengthen typing.` });
    }
    if (
      f.file.startsWith("artifacts/api-server/src/") &&
      !f.file.includes("/tests/") &&
      /console\.log\(/.test(f.content)
    ) {
      findings.push({ code: "console-log-in-server", severity: "warning", file: f.file, message: "console.log in server code; use the structured logger." });
    }
    const longLines = f.content.split("\n").filter((l) => l.length > 300).length;
    if (longLines > 0) {
      findings.push({ code: "long-lines", severity: "info", file: f.file, message: `${longLines} line(s) longer than 300 characters.` });
    }
  }
  return findings;
}

export async function analyzeQuality(): Promise<AnalysisReport> {
  const files = scanSourceFiles();
  const findings = computeQualityFindings(files);
  const penalty = findings.reduce((s, f) => s + (f.severity === "critical" ? 10 : f.severity === "warning" ? 3 : 1), 0);
  const score = Math.max(0, 100 - penalty);
  const report: AnalysisReport = {
    generatedAt: new Date().toISOString(),
    analyzer: "quality",
    filesScanned: files.length,
    score,
    findings,
    summary: `${files.length} files scanned; ${findings.length} finding(s); quality score ${score}/100.`,
  };
  await audit({
    actor: "quality-analyzer",
    action: "quality_analysis_completed",
    targetType: "analysis",
    details: report.summary,
  });
  return report;
}
