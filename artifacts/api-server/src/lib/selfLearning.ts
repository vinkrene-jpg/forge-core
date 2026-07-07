// Self Learning: derive lessons from an evolution iteration and store them in
// the Memory Engine so future planning and proposals can use them (the AI
// Gateway injects memory context into every prompt).

import { db, memoryItemsTable } from "@workspace/db";
import { audit } from "./audit";

export interface IterationOutcome {
  runId: number;
  capabilityKey?: string;
  planCreated: boolean;
  planSource?: string;
  proposalGenerated: boolean;
  blockedFiles: string[];
  testStatus?: string;
  guardianVerdict?: string;
  governorDecision?: string;
  errorMessage?: string;
}

export function deriveLessons(outcome: IterationOutcome): { category: string; title: string; content: string }[] {
  const lessons: { category: string; title: string; content: string }[] = [];
  const cap = outcome.capabilityKey ?? "unknown capability";

  if (outcome.proposalGenerated && outcome.testStatus === "passed" && outcome.governorDecision === "install_allowed") {
    lessons.push({
      category: "successful_module",
      title: `Evolution run #${outcome.runId}: full pipeline green for ${cap}`,
      content: `Plan (${outcome.planSource ?? "?"}) -> proposal -> tests passed -> Guardian ${outcome.guardianVerdict ?? "?"} -> Governor ${outcome.governorDecision}. This pattern works; reuse the same plan structure and test strategy.`,
    });
  }
  if (outcome.testStatus === "failed") {
    lessons.push({
      category: "test_result",
      title: `Evolution run #${outcome.runId}: generated tests failed for ${cap}`,
      content: `The generated code did not pass its own tests. Future proposals for ${cap} need simpler, smaller steps and stricter self-contained tests. Failed tests correctly blocked installation.`,
    });
  }
  if (outcome.blockedFiles.length > 0) {
    lessons.push({
      category: "recurring_blockade",
      title: `Evolution run #${outcome.runId}: ${outcome.blockedFiles.length} file path(s) blocked`,
      content: `The AI proposed unsafe or protected paths: ${outcome.blockedFiles.slice(0, 10).join(", ")}. Prompts must keep forbidding absolute paths, '..' and locked-core paths.`,
    });
  }
  if (outcome.errorMessage) {
    lessons.push({
      category: "error",
      title: `Evolution run #${outcome.runId}: iteration stopped early`,
      content: `Stopped at ${cap}: ${outcome.errorMessage.slice(0, 500)}. Resolve this blocker before the next iteration; the loop stayed safe (nothing installed).`,
    });
  }
  if (outcome.governorDecision && outcome.governorDecision !== "install_allowed") {
    lessons.push({
      category: "lesson_learned",
      title: `Evolution run #${outcome.runId}: Governor decided ${outcome.governorDecision}`,
      content: `Governance intervened for ${cap}. Review the Guardian findings and test results before re-proposing; do not weaken the pipeline.`,
    });
  }
  if (lessons.length === 0) {
    lessons.push({
      category: "lesson_learned",
      title: `Evolution run #${outcome.runId}: iteration completed without incidents`,
      content: `No failures for ${cap}. Continue with the next-ranked gap in the next iteration.`,
    });
  }
  return lessons;
}

export async function storeLessons(outcome: IterationOutcome): Promise<string[]> {
  const lessons = deriveLessons(outcome);
  for (const l of lessons) {
    await db.insert(memoryItemsTable).values({
      category: l.category,
      title: l.title,
      content: l.content,
      tags: ["evolution", outcome.capabilityKey ?? "general"],
    });
  }
  await audit({
    actor: "self-learning",
    action: "lessons_stored",
    targetType: "evolution-run",
    targetId: outcome.runId,
    details: `${lessons.length} lesson(s) stored in memory: ${lessons.map((l) => l.title).join(" | ")}`,
  });
  return lessons.map((l) => l.title);
}
