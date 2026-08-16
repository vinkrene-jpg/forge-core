import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { RuntimeEventBus } from "./event-bus";
import { HARD_PROTECTED_FORGE_FILES } from "./goal-mandate";

export type WorkspaceVerificationStep = "typecheck" | "test" | "build";
export type WorkspaceVerificationScope = "runtime" | "api" | "frontend" | "full";

export interface WorkspaceFileChange {
  readonly path: string;
  readonly expectedSha256: string | null;
  readonly content: string;
}

export interface WorkspaceCommitRequest {
  readonly message: string;
  readonly push: boolean;
}

export interface WorkspaceChangeRequest {
  readonly changes: readonly WorkspaceFileChange[];
  readonly verification: readonly WorkspaceVerificationStep[];
  readonly commit: WorkspaceCommitRequest | null;
}

export interface WorkspaceCommandResult {
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly image?: string;
  readonly containerId?: string;
}

export interface WorkspaceVerificationEvidence {
  readonly command: string;
  readonly exitCode: number;
  readonly image?: string | null;
  readonly containerId?: string | null;
  readonly stdoutChars: number;
  readonly stderrChars: number;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
  readonly durationMs: number;
}

export interface WorkspaceVerificationRunner {
  run(
    step: WorkspaceVerificationStep,
    rootPath: string,
    signal: AbortSignal,
    scope: WorkspaceVerificationScope,
  ): Promise<WorkspaceCommandResult>;
}

export interface WorkspaceExecutionResult {
  readonly id: string;
  readonly missionId: string;
  readonly status:
    | "verified"
    | "committed"
    | "pushed"
    | "rolled_back"
    | "push_failed";
  readonly branch: string;
  readonly changedFiles: readonly {
    readonly path: string;
    readonly beforeSha256: string | null;
    readonly afterSha256: string;
  }[];
  readonly verification: readonly WorkspaceVerificationEvidence[];
  readonly rollbackPerformed: boolean;
  readonly commitSha: string | null;
  readonly error: string | null;
  readonly startedAt: string;
  readonly completedAt: string;
}

export class WorkspaceExecutionError extends Error {
  readonly result: WorkspaceExecutionResult;

  constructor(message: string, result: WorkspaceExecutionResult) {
    super(message);
    this.name = "WorkspaceExecutionError";
    this.result = result;
  }
}

const protectedSegments = new Set([
  ".git",
  "node_modules",
  ".pnpm-store",
  "storage",
  "dist",
]);

const protectedNames = new Set([
  ".env",
  ".npmrc",
  ".pnpmfile.cjs",
  "id_rsa",
  "id_ed25519",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "yarn.lock",
]);

const immutableForgePaths: ReadonlySet<string> = new Set(HARD_PROTECTED_FORGE_FILES);
const allowedMutationRoots = new Set(["sandbox", "lib", "artifacts"]);

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "Unknown error");
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function normalizedRelativePath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  const segments = normalized.split("/").filter(Boolean);
  const name = segments.at(-1) ?? "";

  if (
    normalized.length === 0 ||
    normalized === "." ||
    path.isAbsolute(value) ||
    segments.some((segment) => segment === "..")
  ) {
    throw new Error(`Unsafe workspace path: ${value}`);
  }

  if (
    segments.some((segment) => protectedSegments.has(segment)) ||
    protectedNames.has(name) ||
    (name.startsWith(".env.") && name !== ".env.example") ||
    name.endsWith(".pem") ||
    name.endsWith(".key") ||
    normalized === "GOVERNANCE/CONSTITUTION.md"
    || normalized.startsWith("GOVERNANCE/")
    || immutableForgePaths.has(normalized)
  ) {
    throw new Error(`Protected workspace path: ${normalized}`);
  }

  if (segments.length < 2 || !allowedMutationRoots.has(segments[0].toLowerCase())) {
    throw new Error(`Workspace path must remain inside sandbox/, lib/, or artifacts/: ${normalized}`);
  }

  return normalized;
}

function requiredText(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }

  if (value.length > maxLength) {
    throw new Error(`${field} exceeds ${maxLength} characters`);
  }

  return value;
}

function parseExpectedHash(value: unknown): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("expectedSha256 must be a lowercase SHA-256 or null");
  }

  return value;
}

export function parseWorkspaceChangeRequest(
  value: Readonly<Record<string, unknown>>,
): WorkspaceChangeRequest {
  if (!Array.isArray(value.changes) || value.changes.length === 0) {
    throw new Error("At least one workspace change is required");
  }

  if (value.changes.length > 20) {
    throw new Error("A workspace mission may change at most 20 files");
  }

  const seen = new Set<string>();
  let totalChars = 0;
  const changes = value.changes.map((raw, index) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error(`changes[${index}] must be an object`);
    }

    const candidate = raw as Readonly<Record<string, unknown>>;
    const relativePath = normalizedRelativePath(
      requiredText(candidate.path, `changes[${index}].path`, 500),
    );
    const content = requiredText(
      candidate.content,
      `changes[${index}].content`,
      250_000,
    );

    if (seen.has(relativePath)) {
      throw new Error(`Duplicate workspace path: ${relativePath}`);
    }

    seen.add(relativePath);
    totalChars += content.length;

    return Object.freeze({
      path: relativePath,
      expectedSha256: parseExpectedHash(candidate.expectedSha256),
      content,
    });
  });

  if (totalChars > 500_000) {
    throw new Error("Workspace change content exceeds 500000 characters");
  }

  if (!Array.isArray(value.verification) || value.verification.length === 0) {
    throw new Error("At least one verification step is required");
  }

  const verification = value.verification.map((step) => {
    if (step !== "typecheck" && step !== "test" && step !== "build") {
      throw new Error(`Unsupported verification step: ${String(step)}`);
    }

    return step;
  });

  if (
    changes.some((change) => !change.path.startsWith("sandbox/")) &&
    !(["typecheck", "test", "build"] as const).every((step) => verification.includes(step))
  ) {
    throw new Error(
      "Workspace changes outside sandbox/ require typecheck, test, and build verification",
    );
  }

  const commitValue = value.commit;
  let commit: WorkspaceCommitRequest | null = null;

  if (commitValue !== null && commitValue !== undefined) {
    if (typeof commitValue !== "object" || Array.isArray(commitValue)) {
      throw new Error("commit must be an object or null");
    }

    const candidate = commitValue as Readonly<Record<string, unknown>>;

    if (typeof candidate.push !== "boolean") {
      throw new Error("commit.push must be a boolean");
    }

    commit = Object.freeze({
      message: requiredText(candidate.message, "commit.message", 200).trim(),
      push: candidate.push,
    });
  }

  return Object.freeze({
    changes: Object.freeze(changes),
    verification: Object.freeze(verification),
    commit,
  });
}

async function runProcess(
  executable: string,
  args: readonly string[],
  cwd: string,
  signal?: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WorkspaceCommandResult> {
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      signal,
      env,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString("utf8")).slice(-20_000);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-20_000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve(
        Object.freeze({
          command: [executable, ...args].join(" "),
          exitCode: code ?? 1,
          stdout,
          stderr,
          durationMs: Date.now() - started,
        }),
      );
    });
  });
}

export class NodeWorkspaceVerificationRunner implements WorkspaceVerificationRunner {
  async run(
    step: WorkspaceVerificationStep,
    rootPath: string,
    signal: AbortSignal,
    scope: WorkspaceVerificationScope,
  ): Promise<WorkspaceCommandResult> {
    void step;
    void rootPath;
    void signal;
    void scope;
    throw new Error(
      "Host verification is disabled: Forge-written code requires a network-isolated executor with package installation disabled. Windows host processes cannot provide this boundary without an active sandbox backend.",
    );
  }
}

export class DockerWorkspaceVerificationRunner implements WorkspaceVerificationRunner {
  readonly #image: string;
  readonly #timeoutMs: number;
  readonly #memory: string;
  readonly #pidsLimit: number;

  constructor(options: {
    readonly image?: string;
    readonly timeoutMs?: number;
    readonly memory?: string;
    readonly pidsLimit?: number;
  } = {}) {
    this.#image = options.image
      ?? (process.env.FORGE_VERIFICATION_IMAGE?.trim() || "forge-verification:latest");
    this.#timeoutMs = options.timeoutMs ?? 15 * 60_000;
    this.#memory = options.memory ?? "2g";
    this.#pidsLimit = options.pidsLimit ?? 256;
  }

  async run(
    step: WorkspaceVerificationStep,
    rootPath: string,
    signal: AbortSignal,
    scope: WorkspaceVerificationScope,
  ): Promise<WorkspaceCommandResult> {
    const started = Date.now();
    const snapshotRoot = await mkdtemp(path.join(os.tmpdir(), "forge-verification-"));
    const copySnapshot = async (relativeRoot: string): Promise<void> => {
      const source = path.join(rootPath, relativeRoot);
      const destination = path.join(snapshotRoot, relativeRoot);
      await mkdir(destination, { recursive: true });
      const entries = await readdir(source, { withFileTypes: true });
      for (const entry of entries) {
        if (protectedNames.has(entry.name) || protectedSegments.has(entry.name)
          || entry.name.startsWith(".env.") || entry.name.endsWith(".key")
          || entry.name.endsWith(".pem") || entry.name.endsWith(".tsbuildinfo")) {
          continue;
        }
        const sourceEntry = path.join(source, entry.name);
        const relativeEntry = path.join(relativeRoot, entry.name);
        if (entry.isDirectory()) await copySnapshot(relativeEntry);
        else if (entry.isFile()) {
          await mkdir(path.dirname(path.join(snapshotRoot, relativeEntry)), { recursive: true });
          await writeFile(path.join(snapshotRoot, relativeEntry), await readFile(sourceEntry));
        }
      }
    };
    await Promise.all(["sandbox", "lib", "artifacts"].map(copySnapshot));

    const inspectImage = await runProcess(
      "docker",
      ["image", "inspect", "--format", "{{.Id}}", this.#image],
      rootPath,
      signal,
      {},
    );
    const resolvedImage = inspectImage.stdout.trim();
    if (inspectImage.exitCode !== 0 || !/^sha256:[a-f0-9]{64}$/.test(resolvedImage)) {
      await rm(snapshotRoot, { recursive: true, force: true });
      throw new Error(`Docker verification image is unavailable or invalid: ${this.#image}`);
    }

    const head = await runProcess("git", ["rev-parse", "HEAD"], rootPath, signal, {});
    const sourceSha = head.stdout.trim().toLowerCase();
    if (head.exitCode !== 0 || !/^[a-f0-9]{40}$/.test(sourceSha)) {
      await rm(snapshotRoot, { recursive: true, force: true });
      throw new Error("Docker verification requires a valid source Git SHA");
    }

    const create = await runProcess("docker", [
      "create",
      "--network", "none",
      "--read-only",
      "--memory", this.#memory,
      "--pids-limit", String(this.#pidsLimit),
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges:true",
      "--env", `FORGE_RUNTIME_BUILD_SHA=${sourceSha}`,
      "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=1g,uid=1000,gid=1000",
      "--tmpfs", "/forge/sandbox:rw,nosuid,nodev,exec,size=256m,uid=1000,gid=1000",
      "--tmpfs", "/forge/lib:rw,nosuid,nodev,exec,size=1g,uid=1000,gid=1000",
      "--tmpfs", "/forge/artifacts:rw,nosuid,nodev,exec,size=1g,uid=1000,gid=1000",
      "--mount", `type=bind,source=${snapshotRoot},target=/candidate,readonly`,
      resolvedImage,
      step,
      scope,
    ], rootPath, signal, {});

    if (create.exitCode !== 0 || create.stdout.trim().length === 0) {
      await rm(snapshotRoot, { recursive: true, force: true });
      throw new Error(`Docker verification container creation failed: ${create.stderr.trim()}`);
    }

    const containerId = create.stdout.trim();
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const executionSignal = AbortSignal.any([signal, timeout]);
    let output: WorkspaceCommandResult;
    try {
      output = await runProcess("docker", ["start", "--attach", containerId], rootPath, executionSignal, {});
      const inspect = await runProcess(
        "docker",
        ["inspect", "--format", "{{.State.ExitCode}}", containerId],
        rootPath,
        signal,
        {},
      );
      const exitCode = Number.parseInt(inspect.stdout.trim(), 10);
      return Object.freeze({
        command: `docker run ${resolvedImage} ${step} ${scope}`,
        exitCode: Number.isInteger(exitCode) ? exitCode : output.exitCode,
        stdout: output.stdout,
        stderr: output.stderr,
        durationMs: Date.now() - started,
        image: resolvedImage,
        containerId,
      });
    } catch (error) {
      if (timeout.aborted) {
        throw new Error(`Docker verification timed out after ${this.#timeoutMs}ms`);
      }
      throw error;
    } finally {
      await runProcess("docker", ["rm", "--force", "--volumes", containerId], rootPath, undefined, {});
      await rm(snapshotRoot, { recursive: true, force: true });
    }
  }
}

export function assertHostPackageExecutionDenied(packageManifestPresent: boolean): void {
  if (packageManifestPresent) {
    throw new Error(
      "Host package execution is disabled: dependency installation, lifecycle scripts, and package scripts require a network-isolated sandbox backend.",
    );
  }
}

export function verificationScopeForPaths(
  changedPaths: readonly string[],
): WorkspaceVerificationScope {
  if (changedPaths.every((changedPath) =>
    changedPath.startsWith("sandbox/") || changedPath.startsWith("lib/forge-runtime/")
  )) return "runtime";
  if (changedPaths.every((changedPath) => changedPath.startsWith("artifacts/api-server/"))) {
    return "api";
  }
  if (changedPaths.every((changedPath) => changedPath.startsWith("artifacts/forge-core/"))) {
    return "frontend";
  }
  return "full";
}

interface Snapshot {
  readonly path: string;
  readonly absolutePath: string;
  readonly existed: boolean;
  readonly content: Buffer | null;
  readonly beforeSha256: string | null;
  readonly afterSha256: string;
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function assertContainedPath(root: string, candidate: string, requestedPath: string): void {
  const relative = path.relative(root, candidate);

  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Workspace path escapes repository: ${requestedPath}`);
  }
}

async function assertNoExternalLinkTraversal(
  root: string,
  absolutePath: string,
  requestedPath: string,
): Promise<void> {
  let existingAncestor = absolutePath;

  while (!(await exists(existingAncestor))) {
    const parent = path.dirname(existingAncestor);

    if (parent === existingAncestor) {
      throw new Error(`Workspace path has no repository ancestor: ${requestedPath}`);
    }

    existingAncestor = parent;
  }

  assertContainedPath(root, await realpath(existingAncestor), requestedPath);
}

export class WorkspaceExecutor {
  readonly #events: RuntimeEventBus;
  readonly #verificationRunner: WorkspaceVerificationRunner;

  constructor(options: {
    readonly events: RuntimeEventBus;
    readonly verificationRunner?: WorkspaceVerificationRunner;
  }) {
    this.#events = options.events;
    this.#verificationRunner =
      options.verificationRunner ?? new NodeWorkspaceVerificationRunner();
  }

  async execute(
    rootPath: string,
    missionId: string,
    request: WorkspaceChangeRequest,
    signal: AbortSignal,
  ): Promise<WorkspaceExecutionResult> {
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    const root = await realpath(rootPath);
    const verifications: WorkspaceCommandResult[] = [];
    const snapshots: Snapshot[] = [];
    let branch = "unknown";
    let commitSha: string | null = null;
    let commitCreated = false;

    const result = (
      status: WorkspaceExecutionResult["status"],
      error: string | null,
      rollbackPerformed: boolean,
    ): WorkspaceExecutionResult =>
      Object.freeze({
        id,
        missionId,
        status,
        branch,
        changedFiles: Object.freeze(
          snapshots.map((snapshot) =>
            Object.freeze({
              path: snapshot.path,
              beforeSha256: snapshot.beforeSha256,
              afterSha256: snapshot.afterSha256,
            }),
          ),
        ),
        verification: Object.freeze(
          verifications.map((verification) =>
            Object.freeze({
              command: verification.command,
              exitCode: verification.exitCode,
              image: verification.image ?? null,
              containerId: verification.containerId ?? null,
              stdoutChars: verification.stdout.length,
              stderrChars: verification.stderr.length,
              stdoutSha256: sha256(verification.stdout),
              stderrSha256: sha256(verification.stderr),
              durationMs: verification.durationMs,
            }),
          ),
        ),
        rollbackPerformed,
        commitSha,
        error,
        startedAt,
        completedAt: new Date().toISOString(),
      });

    const git = (args: readonly string[], abortSignal?: AbortSignal) =>
      runProcess("git", args, root, abortSignal);

    const rollback = async (): Promise<void> => {
      if (commitCreated) {
        return;
      }

      for (const snapshot of [...snapshots].reverse()) {
        if (snapshot.existed) {
          await writeFile(snapshot.absolutePath, snapshot.content!);
        } else {
          await rm(snapshot.absolutePath, { force: true });
        }
      }

      if (snapshots.length > 0) {
        await git(["reset", "--quiet"]);
      }
    };

    try {
      const topLevel = await git(["rev-parse", "--show-toplevel"], signal);

      if (
        topLevel.exitCode !== 0 ||
        path.resolve(topLevel.stdout.trim()) !== root
      ) {
        throw new Error("Workspace root must be the Git repository root");
      }

      const branchResult = await git(["branch", "--show-current"], signal);
      branch = branchResult.stdout.trim();

      if (
        branchResult.exitCode !== 0 ||
        branch.length === 0 ||
        branch === "main" ||
        branch === "master"
      ) {
        throw new Error("Workspace execution requires a named non-main branch");
      }

      const status = await git(
        ["status", "--porcelain", "--untracked-files=all"],
        signal,
      );

      if (status.exitCode !== 0 || status.stdout.trim().length > 0) {
        throw new Error("Workspace execution requires a clean Git worktree");
      }

      for (const change of request.changes) {
        const absolutePath = path.resolve(root, change.path);

        if (!absolutePath.startsWith(root + path.sep)) {
          throw new Error(`Workspace path escapes repository: ${change.path}`);
        }

        await assertNoExternalLinkTraversal(root, absolutePath, change.path);
        const existed = await exists(absolutePath);
        const content = existed ? await readFile(absolutePath) : null;
        const beforeSha256 = content === null ? null : sha256(content);

        if (beforeSha256 !== change.expectedSha256) {
          throw new Error(`Stale workspace precondition for ${change.path}`);
        }

        snapshots.push(
          Object.freeze({
            path: change.path,
            absolutePath,
            existed,
            content,
            beforeSha256,
            afterSha256: sha256(change.content),
          }),
        );
      }

      this.#events.publish("workspace.execution.started", {
        executionId: id,
        missionId,
        branch,
        files: snapshots.length,
      });

      for (let index = 0; index < request.changes.length; index += 1) {
        const change = request.changes[index];
        const snapshot = snapshots[index];
        await mkdir(path.dirname(snapshot.absolutePath), { recursive: true });
        const temporary = `${snapshot.absolutePath}.forge-${id}.tmp`;
        await writeFile(temporary, change.content, {
          encoding: "utf8",
          flag: "wx",
        });
        await rename(temporary, snapshot.absolutePath);
      }

      const diffCheck = await git(["diff", "--check"], signal);
      verifications.push(diffCheck);

      if (diffCheck.exitCode !== 0) {
        throw new Error("git diff --check failed");
      }

      const verificationScope = verificationScopeForPaths(
        request.changes.map((change) => change.path),
      );
      for (const step of request.verification) {
        const verification = await this.#verificationRunner.run(
          step,
          root,
          signal,
          verificationScope,
        );
        verifications.push(verification);

        if (verification.exitCode !== 0) {
          throw new Error(`Verification failed: ${step}`);
        }
      }

      if (request.commit === null) {
        const completed = result("verified", null, false);
        this.#events.publish("workspace.execution.verified", {
          executionId: id,
          missionId,
          files: snapshots.length,
        });
        return completed;
      }

      const add = await git(
        ["add", "--", ...snapshots.map((item) => item.path)],
        signal,
      );

      if (add.exitCode !== 0) {
        throw new Error("Git staging failed");
      }

      const stagedCheck = await git(["diff", "--cached", "--check"], signal);
      verifications.push(stagedCheck);

      if (stagedCheck.exitCode !== 0) {
        throw new Error("Staged Git diff check failed");
      }

      if (request.commit.push && verificationScope !== "full") {
        for (const step of request.verification) {
          const verification = await this.#verificationRunner.run(
            step,
            root,
            signal,
            "full",
          );
          verifications.push(verification);
          if (verification.exitCode !== 0) {
            throw new Error(`Full pre-push verification failed: ${step}`);
          }
        }
      }

      const commit = await git(
        ["commit", "-m", request.commit.message],
        signal,
      );

      if (commit.exitCode !== 0) {
        throw new Error("Git commit failed");
      }

      commitCreated = true;
      const head = await git(["rev-parse", "HEAD"], signal);
      commitSha = head.stdout.trim() || null;

      if (!request.commit.push) {
        const completed = result("committed", null, false);
        this.#events.publish("workspace.execution.committed", {
          executionId: id,
          missionId,
          commitSha,
        });
        return completed;
      }

      const push = await git(["push"], signal);
      verifications.push(push);

      if (push.exitCode !== 0) {
        const failed = result("push_failed", "Git push failed", false);
        throw new WorkspaceExecutionError(
          "Git push failed after verified commit",
          failed,
        );
      }

      const completed = result("pushed", null, false);
      this.#events.publish("workspace.execution.pushed", {
        executionId: id,
        missionId,
        commitSha,
      });
      return completed;
    } catch (error) {
      if (error instanceof WorkspaceExecutionError) {
        throw error;
      }

      await rollback();
      const failed = result(
        "rolled_back",
        message(error),
        snapshots.length > 0,
      );
      this.#events.publish("workspace.execution.rolled_back", {
        executionId: id,
        missionId,
        error: failed.error,
      });
      throw new WorkspaceExecutionError(
        `Workspace execution ${id} failed: ${failed.error}`,
        failed,
      );
    }
  }
}
