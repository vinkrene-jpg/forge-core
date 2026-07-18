import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AutonomousActionReceipt,
  AutonomousExecutionEvidence,
  AutonomousFileEffect,
  AutonomousObjectiveProfile,
} from "./autonomous-cycle";

function nowIso(): string {
  return new Date().toISOString();
}

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function measureReceipt(
  action: AutonomousActionReceipt["action"],
  targetPath: string,
  operation: () => Promise<void>,
): Promise<AutonomousActionReceipt> {
  const startedAt = nowIso();
  const startedMs = Date.now();

  try {
    await operation();

    return Object.freeze({
      id: randomUUID(),
      action,
      targetPath,
      startedAt,
      completedAt: nowIso(),
      durationMs: Math.max(1, Date.now() - startedMs),
      ok: true,
      error: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "Unknown error");

    return Object.freeze({
      id: randomUUID(),
      action,
      targetPath,
      startedAt,
      completedAt: nowIso(),
      durationMs: Math.max(1, Date.now() - startedMs),
      ok: false,
      error: message,
    });
  }
}

export class AutonomousActionRunner {
  readonly #storageRoot: string;

  constructor(storageRoot = path.resolve("storage", "sandboxes")) {
    this.#storageRoot = storageRoot;
  }

  async runFileCreateReadHashProof(
    missionId: string,
    objectiveProfile: AutonomousObjectiveProfile,
  ): Promise<AutonomousExecutionEvidence> {
    if (objectiveProfile !== "file-create-read-hash") {
      return Object.freeze({
        objectiveProfile,
        receipts: Object.freeze([]),
        fileEffects: Object.freeze([]),
        verificationRuns: Object.freeze([]),
        artifacts: Object.freeze([]),
      });
    }

    const sandboxDir = path.join(this.#storageRoot, "autonomous-proof", missionId);
    const proofPath = path.join(sandboxDir, "forge-proof.txt");
    const proofText = `forge-proof mission=${missionId} ts=${nowIso()}`;
    const receipts: AutonomousActionReceipt[] = [];

    const existedBefore = await exists(proofPath);
    const beforeSha256 = existedBefore
      ? sha256(await readFile(proofPath))
      : null;

    await mkdir(sandboxDir, { recursive: true });

    receipts.push(
      await measureReceipt("write-file", proofPath, async () => {
        await writeFile(proofPath, proofText, "utf8");
      }),
    );

    let readBack = "";
    receipts.push(
      await measureReceipt("read-file", proofPath, async () => {
        readBack = await readFile(proofPath, "utf8");
      }),
    );

    let computedHash = "";
    receipts.push(
      await measureReceipt("compute-sha256", proofPath, async () => {
        computedHash = sha256(readBack);
      }),
    );

    receipts.push(
      await measureReceipt("verify-file-exists", proofPath, async () => {
        if (!(await exists(proofPath))) {
          throw new Error("Proof file does not exist after write");
        }
      }),
    );

    const existsAfter = await exists(proofPath);
    const afterSha256 = existsAfter
      ? sha256(await readFile(proofPath))
      : null;

    const fileEffect: AutonomousFileEffect = Object.freeze({
      path: proofPath,
      existedBefore,
      existsAfter,
      beforeSha256,
      afterSha256,
    });

    const allReceiptsOk = receipts.every((receipt) => receipt.ok);
    const artifacts =
      allReceiptsOk && existsAfter && afterSha256
        ? Object.freeze([
            Object.freeze({
              id: randomUUID(),
              kind: "file-hash-proof" as const,
              path: proofPath,
              content: readBack,
              sha256: computedHash,
            }),
          ])
        : Object.freeze([]);

    return Object.freeze({
      objectiveProfile,
      receipts: Object.freeze(receipts),
      fileEffects: Object.freeze([fileEffect]),
      verificationRuns: Object.freeze([]),
      artifacts,
    });
  }
}
