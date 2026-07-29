import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { RuntimeEventBus } from "./event-bus";
import type { MissionRecord } from "./mission";

export type MemoryBridgeKind =
  | "decision"
  | "capability"
  | "lesson"
  | "knowledge"
  | "context";

export interface MemoryBridgeEntry {
  readonly id: string;
  readonly kind: MemoryBridgeKind;
  readonly title: string;
  readonly content: string;
  readonly tags: readonly string[];
  readonly sourceMissionId: string | null;
  readonly createdAt: string;
}

export interface MemoryBridgeContext {
  readonly id: string;
  readonly summary: string;
  readonly priorities: readonly string[];
  readonly blockers: readonly string[];
  readonly activeMissionIds: readonly string[];
  readonly updatedAt: string;
}

export interface SearchMemoryBridgeRequest {
  readonly query: string;
  readonly kinds?: readonly MemoryBridgeKind[];
  readonly limit?: number;
}

export interface SearchMemoryBridgeResult {
  readonly entry: MemoryBridgeEntry;
  readonly score: number;
}

export interface RelevantContextRequest {
  readonly query: string;
  readonly limit?: number;
}

export interface RelevantContextResult {
  readonly currentContext: MemoryBridgeContext;
  readonly relevant: readonly SearchMemoryBridgeResult[];
}

export interface RecordDecisionRequest {
  readonly title: string;
  readonly content: string;
  readonly tags?: readonly string[];
  readonly sourceMissionId?: string | null;
}

export interface RecordLearningRequest {
  readonly title: string;
  readonly content: string;
  readonly tags?: readonly string[];
  readonly sourceMissionId?: string | null;
}

export interface RecordCapabilityRequest {
  readonly title: string;
  readonly content: string;
  readonly tags?: readonly string[];
  readonly sourceMissionId?: string | null;
}

export interface UpsertContextRequest {
  readonly summary: string;
  readonly priorities?: readonly string[];
  readonly blockers?: readonly string[];
  readonly activeMissionIds?: readonly string[];
}

export interface MemoryBridgeSummary {
  readonly rootPath: string;
  readonly entries: number;
  readonly decisions: number;
  readonly capabilities: number;
  readonly lessons: number;
  readonly knowledge: number;
  readonly lastUpdatedAt: string | null;
}

export interface MemoryBridgeOptions {
  readonly events: RuntimeEventBus;
  readonly rootPath?: string;
}

function now(): string {
  return new Date().toISOString();
}

function memoryRootPath(): string {
  const explicit = process.env.FORGE_MEMORY_BRIDGE_ROOT?.trim();

  if (explicit) {
    return path.resolve(explicit);
  }

  return path.resolve("storage", "memory-bridge");
}

function requiredText(value: string, field: string, maxLength = 8_000): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${field} is required`);
  }

  if (normalized.length > maxLength) {
    throw new Error(`${field} exceeds ${maxLength} characters`);
  }

  return normalized;
}

function normalizedTags(tags?: readonly string[]): readonly string[] {
  return Object.freeze(
    (tags ?? [])
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 20),
  );
}

function tokenize(value: string): readonly string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2)
    .slice(0, 100);
}

function scoreEntry(entry: MemoryBridgeEntry, queryTokens: readonly string[]): number {
  if (queryTokens.length === 0) {
    return 0;
  }

  const haystack = [
    entry.title,
    entry.content,
    entry.tags.join(" "),
    entry.kind,
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;

  for (const token of queryTokens) {
    if (haystack.includes(token)) {
      score += 1;
    }
  }

  return score;
}

function cloneEntry(entry: MemoryBridgeEntry): MemoryBridgeEntry {
  return Object.freeze({
    ...entry,
    tags: Object.freeze([...entry.tags]),
    sourceMissionId: entry.sourceMissionId ?? null,
  });
}

function cloneContext(context: MemoryBridgeContext): MemoryBridgeContext {
  return Object.freeze({
    ...context,
    priorities: Object.freeze([...context.priorities]),
    blockers: Object.freeze([...context.blockers]),
    activeMissionIds: Object.freeze([...context.activeMissionIds]),
  });
}

function entryFiles(rootPath: string): Readonly<Record<MemoryBridgeKind, string>> {
  return Object.freeze({
    decision: path.join(rootPath, "decisions.jsonl"),
    capability: path.join(rootPath, "capabilities.jsonl"),
    lesson: path.join(rootPath, "lessons.jsonl"),
    knowledge: path.join(rootPath, "knowledge.jsonl"),
    context: path.join(rootPath, "context-history.jsonl"),
  });
}

function contextFile(rootPath: string): string {
  return path.join(rootPath, "current-context.json");
}

export class FileMemoryBridge {
  readonly #events: RuntimeEventBus;
  readonly #rootPath: string;
  readonly #files: Readonly<Record<MemoryBridgeKind, string>>;
  readonly #contextFile: string;
  #entries: MemoryBridgeEntry[] = [];
  #context: MemoryBridgeContext = Object.freeze({
    id: randomUUID(),
    summary: "No current context captured yet.",
    priorities: Object.freeze([]),
    blockers: Object.freeze([]),
    activeMissionIds: Object.freeze([]),
    updatedAt: now(),
  });
  #initialized = false;
  #mutation = Promise.resolve();

  constructor(options: MemoryBridgeOptions) {
    this.#events = options.events;
    this.#rootPath = path.resolve(options.rootPath ?? memoryRootPath());
    this.#files = entryFiles(this.#rootPath);
    this.#contextFile = contextFile(this.#rootPath);
  }

  get rootPath(): string {
    return this.#rootPath;
  }

  async #mutate<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;

    const next = new Promise<void>((resolve) => {
      release = resolve;
    });

    const previous = this.#mutation;
    this.#mutation = next;

    await previous;

    try {
      return await operation();
    } finally {
      release();
    }
  }

  async initialize(): Promise<void> {
    await this.#mutate(async () => {
      if (this.#initialized) {
        return;
      }

      await mkdir(this.#rootPath, { recursive: true });
      this.#entries = await this.#loadEntries();
      this.#context = await this.#loadContext();
      this.#initialized = true;

      this.#events.publish("operator.memory.added", {
        projectId: "forge-core",
        memoryId: this.#context.id,
        kind: "note",
      });
    });
  }

  summary(): MemoryBridgeSummary {
    this.#ensureInitialized();

    let decisions = 0;
    let capabilities = 0;
    let lessons = 0;
    let knowledge = 0;

    for (const entry of this.#entries) {
      if (entry.kind === "decision") {
        decisions += 1;
      } else if (entry.kind === "capability") {
        capabilities += 1;
      } else if (entry.kind === "lesson") {
        lessons += 1;
      } else if (entry.kind === "knowledge") {
        knowledge += 1;
      }
    }

    return Object.freeze({
      rootPath: this.#rootPath,
      entries: this.#entries.length,
      decisions,
      capabilities,
      lessons,
      knowledge,
      lastUpdatedAt: this.#entries.at(-1)?.createdAt ?? null,
    });
  }

  currentContext(): MemoryBridgeContext {
    this.#ensureInitialized();
    return cloneContext(this.#context);
  }

  async addKnowledge(request: RecordDecisionRequest): Promise<MemoryBridgeEntry> {
    return this.#record("knowledge", request);
  }

  async recordDecision(request: RecordDecisionRequest): Promise<MemoryBridgeEntry> {
    return this.#record("decision", request);
  }

  async recordLearning(request: RecordLearningRequest): Promise<MemoryBridgeEntry> {
    return this.#record("lesson", request);
  }

  async recordCapability(request: RecordCapabilityRequest): Promise<MemoryBridgeEntry> {
    return this.#record("capability", request);
  }

  async upsertCurrentContext(request: UpsertContextRequest): Promise<MemoryBridgeContext> {
    this.#ensureInitialized();

    return this.#mutate(async () => {
      const next: MemoryBridgeContext = Object.freeze({
        id: randomUUID(),
        summary: requiredText(request.summary, "summary", 20_000),
        priorities: Object.freeze((request.priorities ?? []).map((value) => value.trim()).filter(Boolean).slice(0, 20)),
        blockers: Object.freeze((request.blockers ?? []).map((value) => value.trim()).filter(Boolean).slice(0, 20)),
        activeMissionIds: Object.freeze((request.activeMissionIds ?? []).map((value) => value.trim()).filter(Boolean).slice(0, 20)),
        updatedAt: now(),
      });

      this.#context = next;
      await this.#append("context", {
        id: next.id,
        kind: "context",
        title: "Current context updated",
        content: next.summary,
        tags: ["current-context"],
        sourceMissionId: null,
        createdAt: next.updatedAt,
      });
      await writeFile(this.#contextFile, JSON.stringify(next, null, 2) + "\n", "utf8");

      return cloneContext(next);
    });
  }

  search(request: SearchMemoryBridgeRequest): readonly SearchMemoryBridgeResult[] {
    this.#ensureInitialized();

    const query = request.query.trim();

    if (query.length === 0) {
      return Object.freeze([]);
    }

    const kinds = new Set(request.kinds ?? []);
    const queryTokens = tokenize(query);
    const limit = Math.max(1, Math.min(50, request.limit ?? 10));

    const scored = this.#entries
      .filter((entry) => kinds.size === 0 || kinds.has(entry.kind))
      .map((entry) =>
        Object.freeze({
          entry: cloneEntry(entry),
          score: scoreEntry(entry, queryTokens),
        }),
      )
      .filter((result) => result.score > 0)
      .sort((left, right) =>
        right.score - left.score ||
        right.entry.createdAt.localeCompare(left.entry.createdAt),
      )
      .slice(0, limit);

    return Object.freeze(scored);
  }

  relevantContext(request: RelevantContextRequest): RelevantContextResult {
    this.#ensureInitialized();

    const relevant = this.search({
      query: request.query,
      kinds: ["decision", "capability", "lesson", "knowledge"],
      limit: request.limit ?? 8,
    });

    return Object.freeze({
      currentContext: cloneContext(this.#context),
      relevant,
    });
  }

  async captureMissionKnowledge(mission: MissionRecord): Promise<void> {
    this.#ensureInitialized();

    const output = mission.output;
    const outputSummary = output === null
      ? "No mission output was produced."
      : JSON.stringify(output, null, 2).slice(0, 4_000);
    const baseTitle = `${mission.kind} ${mission.status}`;
    const tags = [
      mission.kind,
      mission.status,
      "mission-capture",
    ];

    if (mission.status === "succeeded") {
      await this.recordLearning({
        title: `Lesson learned: ${baseTitle}`,
        content: [
          `Mission ${mission.id} succeeded.`,
          `Title: ${mission.title}`,
          "Durable evidence:",
          outputSummary,
        ].join("\n"),
        tags,
        sourceMissionId: mission.id,
      });
    } else if (mission.status === "failed" || mission.status === "cancelled") {
      await this.recordLearning({
        title: `Failure lesson: ${baseTitle}`,
        content: [
          `Mission ${mission.id} ended as ${mission.status}.`,
          `Title: ${mission.title}`,
          `Error: ${mission.lastError ?? "(none)"}`,
          "Observed output:",
          outputSummary,
        ].join("\n"),
        tags,
        sourceMissionId: mission.id,
      });
    }

    const current = this.currentContext();
    const nextSummary = [
      `Last mission: ${mission.title}`,
      `Status: ${mission.status}`,
      `Updated at: ${now()}`,
    ].join(" | ");

    await this.upsertCurrentContext({
      summary: nextSummary,
      priorities: current.priorities,
      blockers: current.blockers,
      activeMissionIds: [mission.id],
    });
  }

  #ensureInitialized(): void {
    if (!this.#initialized) {
      throw new Error("MemoryBridge is not initialized");
    }
  }

  async #record(
    kind: Extract<MemoryBridgeKind, "decision" | "capability" | "lesson" | "knowledge">,
    request:
      | RecordDecisionRequest
      | RecordLearningRequest
      | RecordCapabilityRequest,
  ): Promise<MemoryBridgeEntry> {
    this.#ensureInitialized();

    return this.#mutate(async () => {
      const entry: MemoryBridgeEntry = Object.freeze({
        id: randomUUID(),
        kind,
        title: requiredText(request.title, "title", 500),
        content: requiredText(request.content, "content", 20_000),
        tags: normalizedTags(request.tags),
        sourceMissionId: request.sourceMissionId?.trim() || null,
        createdAt: now(),
      });

      await this.#append(kind, entry);
      this.#entries = [...this.#entries, entry].slice(-10_000);

      return cloneEntry(entry);
    });
  }

  async #append(kind: MemoryBridgeKind, entry: MemoryBridgeEntry): Promise<void> {
    const filePath = this.#files[kind];
    await appendFile(filePath, JSON.stringify(entry) + "\n", "utf8");
  }

  async #loadEntries(): Promise<MemoryBridgeEntry[]> {
    const results: MemoryBridgeEntry[] = [];

    for (const filePath of Object.values(this.#files)) {
      let raw = "";

      try {
        raw = await readFile(filePath, "utf8");
      } catch (error) {
        const code =
          typeof error === "object" &&
          error !== null &&
          "code" in error
            ? String((error as { code?: unknown }).code)
            : "";

        if (code === "ENOENT") {
          continue;
        }

        throw error;
      }

      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();

        if (trimmed.length === 0) {
          continue;
        }

        let parsed: unknown;

        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }

        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          continue;
        }

        const candidate = parsed as Record<string, unknown>;

        if (
          typeof candidate.id !== "string" ||
          typeof candidate.kind !== "string" ||
          typeof candidate.title !== "string" ||
          typeof candidate.content !== "string" ||
          !Array.isArray(candidate.tags) ||
          typeof candidate.createdAt !== "string"
        ) {
          continue;
        }

        results.push(
          Object.freeze({
            id: candidate.id,
            kind: candidate.kind as MemoryBridgeKind,
            title: candidate.title,
            content: candidate.content,
            tags: Object.freeze(
              candidate.tags
                .filter((tag): tag is string => typeof tag === "string")
                .slice(0, 20),
            ),
            sourceMissionId:
              typeof candidate.sourceMissionId === "string"
                ? candidate.sourceMissionId
                : null,
            createdAt: candidate.createdAt,
          }),
        );
      }
    }

    return results.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async #loadContext(): Promise<MemoryBridgeContext> {
    try {
      const raw = await readFile(this.#contextFile, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      if (
        typeof parsed.id === "string" &&
        typeof parsed.summary === "string" &&
        Array.isArray(parsed.priorities) &&
        Array.isArray(parsed.blockers) &&
        Array.isArray(parsed.activeMissionIds) &&
        typeof parsed.updatedAt === "string"
      ) {
        return Object.freeze({
          id: parsed.id,
          summary: parsed.summary,
          priorities: Object.freeze(
            parsed.priorities.filter((value): value is string => typeof value === "string"),
          ),
          blockers: Object.freeze(
            parsed.blockers.filter((value): value is string => typeof value === "string"),
          ),
          activeMissionIds: Object.freeze(
            parsed.activeMissionIds.filter((value): value is string => typeof value === "string"),
          ),
          updatedAt: parsed.updatedAt,
        });
      }
    } catch {
      // fall through
    }

    const initial = cloneContext(this.#context);
    await writeFile(this.#contextFile, JSON.stringify(initial, null, 2) + "\n", "utf8");
    return initial;
  }
}
