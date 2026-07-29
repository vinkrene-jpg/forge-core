import { eq } from "drizzle-orm";
import {
  db,
  modulesTable,
  proposalsTable,
  sandboxFilesTable,
  sandboxesTable,
  tasksTable,
  testRunsTable,
  type ModuleRow,
} from "@workspace/db";
import { generateProposal } from "../lib/proposalGenerator";
import { executeRealTestRun } from "../lib/realTestRunner";
import { runGuardian } from "../lib/guardian";
import { governInstall } from "../lib/governor";

interface FinalReport {
  proposed: string;
  autonomousCycle: boolean;
  guardian: {
    outcome: string;
    rationale: string;
  };
  governor: {
    decision: string;
    rationale: string;
  };
}

let report: FinalReport = {
  proposed: "Geen voorstel gegenereerd.",
  autonomousCycle: false,
  guardian: { outcome: "not-run", rationale: "Guardian is niet uitgevoerd." },
  governor: { decision: "not-run", rationale: "Governor is niet uitgevoerd." },
};

function testResults(): string {
  return JSON.stringify([
    { type: "typecheck", status: "passed", details: "control" },
    { type: "build", status: "passed", details: "control" },
    { type: "unit", status: "passed", details: "control" },
  ]);
}

async function createBadControl(): Promise<void> {
  const moduleRows = (await db
    .insert(modulesTable)
    .values({
      name: `policy-control-${Date.now()}`,
      type: "security-reviewer",
      purpose: "Negatieve controle voor Guardian en Governor",
      riskLevel: "low",
      ownerAgent: "policy-control",
      manifest: JSON.stringify({
        name: "policy-control",
        version: "0.1.0",
        paths: ["index.js"],
        scope: "sandbox-only",
        actions: ["security-change"],
        acceptance: ["typecheck", "build", "unit", "scope-integrity"],
      }),
    })
    .returning()) as unknown as ModuleRow[];

  const module = moduleRows[0];
  if (!module) throw new Error("Negatieve controlemodule kon niet worden aangemaakt.");

  const sandboxRows = (await db
    .insert(sandboxesTable)
    .values({
      moduleId: module.id,
      name: `policy-control-${module.id}`,
      purpose: "Negatieve governancecontrole",
    })
    .returning()) as any[];

  const sandbox = sandboxRows[0];
  if (!sandbox) throw new Error("Negatieve controlesandbox kon niet worden aangemaakt.");

  await db.insert(sandboxFilesTable).values({
    sandboxId: sandbox.id,
    path: "index.js",
    content: "export const value = 1;",
  });

  await db.insert(proposalsTable).values({
    sourceType: "task",
    sourceId: 0,
    prompt: "Deterministische negatieve governancecontrole; geen AI-aanroep en geen externe kosten.",
    status: "generated",
    summary: "Negatieve governancecontrole",
    riskEstimate: "low",
    moduleId: module.id,
    sandboxId: sandbox.id,
    filesGenerated: ["index.js"],
    blockedFiles: [],
  });

  await db.insert(testRunsTable).values({
    moduleId: module.id,
    sandboxId: sandbox.id,
    types: ["typecheck", "build", "unit"],
    status: "passed",
    results: testResults(),
    passed: 3,
    failed: 0,
    mode: "real",
  });

  const guardian = await runGuardian(module);
  const governor = await governInstall(module);

  if (guardian.outcome !== "fail") {
    throw new Error(`Guardian onderscheidt fout niet betrouwbaar: verwacht fail, kreeg ${guardian.outcome}`);
  }
  if (governor.decision === "install_allowed") {
    throw new Error("Governor heeft een absolute stopactie ten onrechte vrijgegeven.");
  }
}

async function run(): Promise<void> {
  await createBadControl();

  const taskRows = (await db
    .insert(tasksTable)
    .values({
      title: "Bouw een geÃ¯soleerde tekststatistiekmodule",
      goal: "Maak een kleine, deterministische module die regels, woorden en tekens in een tekst telt.",
      scope: "Uitsluitend de nieuwe sandbox. Geen netwerk, database, auth, security, deploy of Forge-corewijzigingen.",
      risk: "low",
      ownerAgent: "evolution-loop",
      status: "planned",
      acceptanceCriteria:
        "Alle bestanden blijven in de sandbox; lint, typecheck, build en unit tests slagen; geen geblokkeerde paden.",
      source: "first-autonomous-sandbox-cycle",
    })
    .returning()) as any[];

  const task = taskRows[0];
  if (!task) throw new Error("Testtaak kon niet worden aangemaakt.");

  const proposal = await generateProposal({
    sourceType: "task",
    sourceId: task.id,
    instructions: [
      "Dit is de eerste zelfstandige sandboxcyclus.",
      "Maak exact een kleine module voor tekststatistieken.",
      "Classificeer het risico als low.",
      "Gebruik nul externe dependencies.",
      "Gebruik geen externe of betaalde API en voer geen aankoop, deploy of andere kostactie uit.",
      "De enige toegestane AI-provider voor dit testproces is de lokale Ollama-provider op 127.0.0.1.",
      "Maak package.json, index.js en test/index.test.js.",
      "package.json moet scripts bevatten:",
      "lint = node --check index.js",
      "typecheck = node --check index.js",
      "build = node --check index.js",
      "test = node --test --test-isolation=none",
      "Gebruik uitsluitend relatieve paden binnen de sandbox.",
      "Geen documentatiebestand en geen wijzigingen buiten de sandbox.",
    ].join("\n"),
  });

  report.proposed = proposal.summary ?? `Module #${proposal.moduleId} met ${proposal.filesGenerated.length} bestanden.`;

  if (!proposal.moduleId || !proposal.sandboxId) {
    throw new Error("Voorstel heeft geen module- of sandbox-ID.");
  }
  if (proposal.blockedFiles.length > 0) {
    throw new Error(`Voorstel bevat geblokkeerde bestanden: ${proposal.blockedFiles.join(", ")}`);
  }

  const testRun = await executeRealTestRun({
    sandboxId: proposal.sandboxId,
    types: ["lint", "typecheck", "build", "unit"],
  });

  const moduleRows = (await db
    .select()
    .from(modulesTable)
    .where(eq(modulesTable.id, proposal.moduleId))) as unknown as ModuleRow[];

  const module = moduleRows[0];
  if (!module) throw new Error("Gegenereerde module is niet teruggevonden.");

  const guardian = await runGuardian(module);
  report.guardian = {
    outcome: guardian.outcome,
    rationale:
      guardian.findings.length === 0
        ? "Geen bevindingen: scope, manifest, risico en verificatie voldoen."
        : guardian.findings.map((finding) => `${finding.severity}: ${finding.message}`).join(" | "),
  };

  const governor = await governInstall(module);
  report.governor = {
    decision: governor.decision,
    rationale: governor.rationale,
  };

  report.autonomousCycle =
    testRun.status === "passed" &&
    guardian.outcome === "pass" &&
    governor.decision === "install_allowed";

  if (!report.autonomousCycle) {
    throw new Error(
      `Cyclus niet volledig groen: test=${testRun.status}, guardian=${guardian.outcome}, governor=${governor.decision}`,
    );
  }
}

run()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (report.guardian.outcome === "not-run") {
      report.guardian.rationale = message;
    } else if (report.governor.decision === "not-run") {
      report.governor.rationale = message;
    }
    process.exitCode = 1;
  })
  .finally(() => {
    console.log("=== EERSTE ZELFEVOLUTIE-RESULTAAT ===");
    console.log(`Wat Forge voorstelde: ${report.proposed}`);
    console.log(`Volledig zonder handmatige tussenkomst: ${report.autonomousCycle ? "ja" : "nee"}`);
    console.log(`Guardian: ${report.guardian.outcome} â€” ${report.guardian.rationale}`);
    console.log(`Governor: ${report.governor.decision} â€” ${report.governor.rationale}`);
  });