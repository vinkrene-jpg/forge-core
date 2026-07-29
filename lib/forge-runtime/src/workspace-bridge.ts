import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { RuntimeEventBus } from "./event-bus";
import {
  WorkspaceExecutionError,
  WorkspaceExecutor,
  parseWorkspaceChangeRequest,
  type WorkspaceChangeRequest,
  type WorkspaceExecutionResult,
  type WorkspaceVerificationRunner,
} from "./workspace-executor";

const BRIDGE_VERSION = 1 as const;

interface BridgeRequestPayload {
  readonly version: typeof BRIDGE_VERSION;
  readonly id: string;
  readonly missionId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly request: WorkspaceChangeRequest;
}

interface BridgeRequestEnvelope extends BridgeRequestPayload {
  readonly signature: string;
}

interface BridgeResponsePayload {
  readonly version: typeof BRIDGE_VERSION;
  readonly id: string;
  readonly missionId: string;
  readonly completedAt: string;
  readonly ok: boolean;
  readonly result: WorkspaceExecutionResult | null;
  readonly error: string | null;
}

interface BridgeResponseEnvelope extends BridgeResponsePayload {
  readonly signature: string;
}

export interface WorkspaceChangeExecutor {
  execute(
    rootPath: string,
    missionId: string,
    request: WorkspaceChangeRequest,
    signal: AbortSignal,
  ): Promise<WorkspaceExecutionResult>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "Unknown error");
}

function requireToken(token: string): string {
  const normalized = token.trim();

  if (normalized.length < 32) {
    throw new Error("Workspace bridge token must contain at least 32 characters");
  }

  return normalized;
}

function signature(token: string, payload: unknown): string {
  return createHmac("sha256", token)
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
}

function signaturesMatch(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) {
    return false;
  }

  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function requestPayload(envelope: BridgeRequestEnvelope): BridgeRequestPayload {
  return {
    version: envelope.version,
    id: envelope.id,
    missionId: envelope.missionId,
    createdAt: envelope.createdAt,
    expiresAt: envelope.expiresAt,
    request: envelope.request,
  };
}

function responsePayload(envelope: BridgeResponseEnvelope): BridgeResponsePayload {
  return {
    version: envelope.version,
    id: envelope.id,
    missionId: envelope.missionId,
    completedAt: envelope.completedAt,
    ok: envelope.ok,
    result: envelope.result,
    error: envelope.error,
  };
}

async function atomicJson(target: string, value: unknown): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await rm(target, { force: true });
  await rename(temporary, target);
}

async function readJson<T>(target: string): Promise<T> {
  return JSON.parse(await readFile(target, "utf8")) as T;
}

async function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Workspace bridge request aborted"));
      return;
    }

    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Workspace bridge request aborted"));
      },
      { once: true },
    );
  });
}

export class FileWorkspaceBridgeClient implements WorkspaceChangeExecutor {
  readonly #directory: string;
  readonly #token: string;
  readonly #events: RuntimeEventBus;
  readonly #timeoutMs: number;

  constructor(options: {
    readonly directory: string;
    readonly token: string;
    readonly events: RuntimeEventBus;
    readonly timeoutMs?: number;
  }) {
    this.#directory = path.resolve(options.directory);
    this.#token = requireToken(options.token);
    this.#events = options.events;
    this.#timeoutMs = options.timeoutMs ?? 300_000;
  }

  async execute(
    _rootPath: string,
    missionId: string,
    request: WorkspaceChangeRequest,
    signal: AbortSignal,
  ): Promise<WorkspaceExecutionResult> {
    const id = randomUUID();
    const requests = path.join(this.#directory, "requests");
    const responses = path.join(this.#directory, "responses");
    await mkdir(requests, { recursive: true });
    await mkdir(responses, { recursive: true });

    const createdAt = new Date();
    const payload: BridgeRequestPayload = {
      version: BRIDGE_VERSION,
      id,
      missionId,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + this.#timeoutMs).toISOString(),
      request,
    };
    const envelope: BridgeRequestEnvelope = {
      ...payload,
      signature: signature(this.#token, payload),
    };
    const requestPath = path.join(requests, `${id}.json`);
    const responsePath = path.join(responses, `${id}.json`);

    await atomicJson(requestPath, envelope);
    this.#events.publish("workspace.bridge.requested", {
      bridgeRequestId: id,
      missionId,
    });

    const startedAt = Date.now();

    try {
      while (Date.now() - startedAt <= this.#timeoutMs) {
        try {
          const response = await readJson<BridgeResponseEnvelope>(responsePath);
          const payload = responsePayload(response);
          const expected = signature(this.#token, payload);

          if (
            response.version !== BRIDGE_VERSION ||
            response.id !== id ||
            response.missionId !== missionId ||
            !signaturesMatch(response.signature, expected)
          ) {
            throw new Error("Workspace bridge response failed authentication");
          }

          this.#events.publish("workspace.bridge.responded", {
            bridgeRequestId: id,
            missionId,
            ok: response.ok,
          });

          if (!response.ok || !response.result) {
            if (response.result) {
              throw new WorkspaceExecutionError(
                response.error ?? "Host workspace execution failed",
                response.result,
              );
            }

            throw new Error(response.error ?? "Host workspace execution failed");
          }

          return response.result;
        } catch (error) {
          const code =
            typeof error === "object" && error !== null && "code" in error
              ? String((error as { code?: unknown }).code)
              : null;

          if (code !== "ENOENT") {
            throw error;
          }
        }

        await wait(200, signal);
      }

      throw new Error(`Workspace bridge timed out after ${this.#timeoutMs} ms`);
    } finally {
      await rm(requestPath, { force: true });
      await rm(responsePath, { force: true });
    }
  }
}

export class WorkspaceBridgeHost {
  readonly #directory: string;
  readonly #rootPath: string;
  readonly #token: string;
  readonly #events: RuntimeEventBus;
  readonly #executor: WorkspaceExecutor;
  readonly #pollIntervalMs: number;
  readonly #processed = new Set<string>();
  #running = false;
  #loop: Promise<void> | null = null;

  constructor(options: {
    readonly directory: string;
    readonly rootPath: string;
    readonly token: string;
    readonly events: RuntimeEventBus;
    readonly verificationRunner?: WorkspaceVerificationRunner;
    readonly pollIntervalMs?: number;
  }) {
    this.#directory = path.resolve(options.directory);
    this.#rootPath = path.resolve(options.rootPath);
    this.#token = requireToken(options.token);
    this.#events = options.events;
    this.#executor = new WorkspaceExecutor({
      events: options.events,
      verificationRunner: options.verificationRunner,
    });
    this.#pollIntervalMs = options.pollIntervalMs ?? 200;
  }

  async start(): Promise<void> {
    if (this.#running) {
      return;
    }

    await mkdir(path.join(this.#directory, "requests"), { recursive: true });
    await mkdir(path.join(this.#directory, "responses"), { recursive: true });
    this.#running = true;
    await this.#writeHealth("running");
    this.#loop = this.#run();
  }

  async stop(): Promise<void> {
    this.#running = false;
    await this.#loop;
    this.#loop = null;
    await this.#writeHealth("stopped");
  }

  async #writeHealth(status: "running" | "stopped"): Promise<void> {
    await atomicJson(path.join(this.#directory, "host-health.json"), {
      version: BRIDGE_VERSION,
      status,
      processId: process.pid,
      rootPath: this.#rootPath,
      updatedAt: new Date().toISOString(),
    });
  }

  async #run(): Promise<void> {
    while (this.#running) {
      await this.#scan();
      await this.#writeHealth("running");
      await wait(this.#pollIntervalMs);
    }
  }

  async #scan(): Promise<void> {
    const requestDirectory = path.join(this.#directory, "requests");
    const names = (await readdir(requestDirectory))
      .filter((name) => /^[a-f0-9-]+\.json$/i.test(name))
      .sort();

    for (const name of names) {
      const requestPath = path.join(requestDirectory, name);

      try {
        const envelope = await readJson<BridgeRequestEnvelope>(requestPath);

        if (this.#processed.has(envelope.id)) {
          continue;
        }

        const payload = requestPayload(envelope);
        const expected = signature(this.#token, payload);

        if (
          envelope.version !== BRIDGE_VERSION ||
          !signaturesMatch(envelope.signature, expected) ||
          Date.parse(envelope.expiresAt) < Date.now()
        ) {
          await rm(requestPath, { force: true });
          continue;
        }

        this.#processed.add(envelope.id);
        await this.#execute(envelope);
      } catch (error) {
        this.#events.publish("workspace.bridge.rejected", {
          requestFile: name,
          error: errorMessage(error),
        });
        await rm(requestPath, { force: true });
      }
    }
  }

  async #execute(envelope: BridgeRequestEnvelope): Promise<void> {
    let result: WorkspaceExecutionResult | null = null;
    let error: string | null = null;

    try {
      const request = parseWorkspaceChangeRequest(
        envelope.request as unknown as Readonly<Record<string, unknown>>,
      );
      result = await this.#executor.execute(
        this.#rootPath,
        envelope.missionId,
        request,
        new AbortController().signal,
      );
    } catch (cause) {
      error = errorMessage(cause);

      if (cause instanceof WorkspaceExecutionError) {
        result = cause.result;
      }
    }

    const payload: BridgeResponsePayload = {
      version: BRIDGE_VERSION,
      id: envelope.id,
      missionId: envelope.missionId,
      completedAt: new Date().toISOString(),
      ok: error === null,
      result,
      error,
    };
    const response: BridgeResponseEnvelope = {
      ...payload,
      signature: signature(this.#token, payload),
    };

    await atomicJson(
      path.join(this.#directory, "responses", `${envelope.id}.json`),
      response,
    );
    await rm(path.join(this.#directory, "requests", `${envelope.id}.json`), {
      force: true,
    });
  }
}
