import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import type { RuntimeEventBus } from "./event-bus";
import { ModelRouter } from "./model-router";
import {
  createInitialOperatorState,
  FileOperatorStateStore,
  OPERATOR_STORE_VERSION,
  type OperatorStateStore,
  type PersistedOperatorState,
} from "./operator-store";
import type {
  CreateProjectMemoryRequest,
  ModelRouteDecision,
  ModelRouteRequest,
  OperatorCoreSummary,
  ProjectMemoryEntry,
  ProjectMemoryKind,
  ProjectRecord,
  RegisterProjectRequest,
  PromptComposeRequest,
  PromptComposition,
  WorkspaceFileContent,
  WorkspaceFileSummary,
} from "./operator";
import { WorkspaceConnector } from "./workspace-connector";

export interface OperatorCoreOptions {
  readonly events: RuntimeEventBus;
  readonly stateStore?: OperatorStateStore;
  readonly workspaceConnector?: WorkspaceConnector;
  readonly modelRouter?: ModelRouter;
  readonly defaultWorkspaceRoot?: string;
}

const memoryKinds = new Set<ProjectMemoryKind>([
  "decision",
  "architecture",
  "requirement",
  "task",
  "evidence",
  "note",
]);

function requiredText(
  value: string,
  field: string,
): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${field} is required`);
  }

  return normalized;
}

function cloneProject(
  project: ProjectRecord,
): ProjectRecord {
  return Object.freeze({
    ...project,
    startCommand: Object.freeze([...(project.startCommand ?? [])]),
    verificationCommand: Object.freeze([...(project.verificationCommand ?? [])]),
    origin: project.origin ?? "introduced",
    goal: project.goal ?? project.description,
    sourceMissionId: project.sourceMissionId ?? null,
  });
}

function productsRoot(workspaceRoot: string): string {
  const configured = process.env.FORGE_PRODUCTS_ROOT?.trim();
  if (configured) return path.resolve(configured);
  const candidates = [path.dirname(workspaceRoot)];
  if (process.platform === "win32") {
    for (let code = "A".charCodeAt(0); code <= "Z".charCodeAt(0); code += 1) {
      candidates.push(path.join(String.fromCharCode(code) + ":" + path.sep, "Forge"));
    }
  }
  return candidates.find((candidate) => existsSync(path.join(candidate, "assumption-engine")))
    ?? path.dirname(workspaceRoot);
}

function productSeeds(workspaceRoot: string): readonly RegisterProjectRequest[] {
  const externalRoot = productsRoot(workspaceRoot);
  return Object.freeze([
    Object.freeze({
      id: "forge-core",
      name: "Forge Core",
      rootPath: workspaceRoot,
      startCommand: Object.freeze(["pnpm.cmd", "forge:start"]),
      verificationCommand: Object.freeze(["pnpm.cmd", "validate"]),
      origin: "forge-built" as const,
      goal: "Operate and evolve the local-first autonomous AI Software Engineering Platform.",
      description: "Authoritative local Forge Core repository and runtime workspace.",
      sourceMissionId: null,
    }),
    Object.freeze({
      id: "assumption-engine",
      name: "Assumption Engine",
      rootPath: process.env.FORGE_ASSUMPTION_ENGINE_ROOT?.trim() || path.join(externalRoot, "assumption-engine"),
      startCommand: Object.freeze(["pnpm.cmd", "--filter", "@workspace/assumption-engine", "dev"]),
      verificationCommand: Object.freeze(["pnpm.cmd", "build"]),
      origin: "introduced" as const,
      goal: "Make assumptions explicit, inspectable and testable in software design work.",
      description: "Existing assumption-analysis product introduced into Forge maintenance.",
      sourceMissionId: null,
    }),
    Object.freeze({
      id: "forge-cad-engine",
      name: "Forge CAD Engine",
      rootPath: process.env.FORGE_CAD_ENGINE_ROOT?.trim() || path.join(externalRoot, "forge-cad-engine"),
      startCommand: Object.freeze([]),
      verificationCommand: Object.freeze([]),
      origin: "forge-built" as const,
      goal: "Build a 3D game engine with a full AutoCAD-class builder for desktop and web, including drawing import, precise authoring and fast rendering.",
      description: "Long-running exercise product defined by the Forge final assignment.",
      sourceMissionId: null,
    }),
  ]);
}

function normalizedProject(
  request: RegisterProjectRequest,
  existing?: ProjectRecord,
): ProjectRecord {
  const timestamp = new Date().toISOString();
  return cloneProject({
    id: requiredText(request.id, "id"),
    name: requiredText(request.name, "name"),
    rootPath: path.resolve(requiredText(request.rootPath, "rootPath")),
    description: request.description?.trim() || request.goal.trim(),
    startCommand: Object.freeze(request.startCommand.map((part) => requiredText(part, "startCommand"))),
    verificationCommand: Object.freeze(request.verificationCommand.map((part) => requiredText(part, "verificationCommand"))),
    origin: request.origin,
    goal: requiredText(request.goal, "goal"),
    sourceMissionId: request.sourceMissionId?.trim() || null,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  });
}

function cloneMemory(
  memory: ProjectMemoryEntry,
): ProjectMemoryEntry {
  return Object.freeze({
    ...memory,
    tags: Object.freeze([...memory.tags]),
  });
}

function cloneComposition(
  composition: PromptComposition,
): PromptComposition {
  return Object.freeze({
    ...composition,
    route: Object.freeze({
      ...composition.route,
      selectedProfile: Object.freeze({
        ...composition.route.selectedProfile,
      }),
      request: Object.freeze({
        ...composition.route.request,
      }),
      candidates: Object.freeze(
        composition.route.candidates.map(
          (candidate) =>
            Object.freeze({
              ...candidate,
              reasons: Object.freeze([
                ...candidate.reasons,
              ]),
            }),
        ),
      ),
    }),
    memoryIds: Object.freeze([
      ...composition.memoryIds,
    ]),
    sourceFiles: Object.freeze([
      ...composition.sourceFiles,
    ]),
  });
}

export class OperatorCore {
  readonly #events: RuntimeEventBus;
  readonly #stateStore: OperatorStateStore;
  readonly #workspace: WorkspaceConnector;
  readonly #router: ModelRouter;
  readonly #defaultWorkspaceRoot: string;
  #state = createInitialOperatorState();
  #initialized = false;
  #mutation = Promise.resolve();

  constructor(options: OperatorCoreOptions) {
    this.#events = options.events;
    this.#stateStore =
      options.stateStore ??
      new FileOperatorStateStore();
    this.#workspace =
      options.workspaceConnector ??
      new WorkspaceConnector();
    this.#router =
      options.modelRouter ?? new ModelRouter();
    this.#defaultWorkspaceRoot =
      options.defaultWorkspaceRoot ??
      process.env.FORGE_WORKSPACE_ROOT?.trim() ??
      process.cwd();
  }

  async #mutate<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
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

  #ensureInitialized(): void {
    if (!this.#initialized) {
      throw new Error("OperatorCore is not initialized");
    }
  }

  async #save(
    state: PersistedOperatorState,
  ): Promise<void> {
    this.#state = Object.freeze({
      version: OPERATOR_STORE_VERSION,
      projects: Object.freeze(
        state.projects.map(cloneProject),
      ),
      memories: Object.freeze(
        state.memories.map(cloneMemory),
      ),
      compositions: Object.freeze(
        state.compositions
          .slice(-50)
          .map(cloneComposition),
      ),
    });

    await this.#stateStore.save(this.#state);
  }

  async initialize(): Promise<void> {
    await this.#mutate(async () => {
      if (this.#initialized) {
        return;
      }

      const loaded = await this.#stateStore.load();
      const configuredRoot = path.resolve(this.#defaultWorkspaceRoot);
      let projects = [...loaded.projects];

      for (const seed of productSeeds(configuredRoot)) {
        const existing = projects.find((project) => project.id === seed.id);
        const seeded = normalizedProject(seed, existing);
        projects = existing
          ? projects.map((project) => project.id === seed.id ? seeded : project)
          : [...projects, seeded];
        if (!existing) {
          this.#events.publish("operator.project.registered", {
            projectId: seeded.id,
            rootPath: seeded.rootPath,
          });
        }
      }

      await this.#save({
        ...loaded,
        projects,
      });

      this.#initialized = true;

      this.#events.publish("operator.state.loaded", {
        projects: this.#state.projects.length,
        memories: this.#state.memories.length,
        compositions:
          this.#state.compositions.length,
      });
    });
  }

  summary(): OperatorCoreSummary {
    this.#ensureInitialized();

    const last =
      this.#state.compositions.at(-1) ?? null;

    return Object.freeze({
      projects: this.#state.projects.length,
      memories: this.#state.memories.length,
      compositions:
        this.#state.compositions.length,
      lastCompositionAt:
        last?.createdAt ?? null,
      modelProfiles:
        this.#router.listProfiles().length,
      workspaceConnector: "read-only",
    });
  }

  listProjects(): readonly ProjectRecord[] {
    this.#ensureInitialized();

    return this.#state.projects.map(cloneProject);
  }

  getProject(
    projectId: string,
  ): ProjectRecord | null {
    this.#ensureInitialized();

    const project = this.#state.projects.find(
      (candidate) => candidate.id === projectId,
    );

    return project ? cloneProject(project) : null;
  }

  async registerProject(request: RegisterProjectRequest): Promise<ProjectRecord> {
    this.#ensureInitialized();
    return this.#mutate(async () => {
      const resolvedRoot = path.resolve(requiredText(request.rootPath, "rootPath"));
      const existing = this.#state.projects.find((project) =>
        project.id === request.id || path.resolve(project.rootPath) === resolvedRoot,
      );
      const project = normalizedProject(request, existing);
      await this.#save({
        ...this.#state,
        projects: existing
          ? this.#state.projects.map((candidate) => candidate.id === existing.id ? project : candidate)
          : [...this.#state.projects, project],
      });
      this.#events.publish("operator.project.registered", {
        projectId: project.id,
        rootPath: project.rootPath,
        sourceMissionId: project.sourceMissionId,
      });
      return project;
    });
  }

  listMemories(
    projectId: string,
    kind?: ProjectMemoryKind,
  ): readonly ProjectMemoryEntry[] {
    this.#ensureInitialized();
    this.#requireProject(projectId);

    return this.#state.memories
      .filter(
        (memory) =>
          memory.projectId === projectId &&
          (kind === undefined ||
            memory.kind === kind),
      )
      .map(cloneMemory);
  }

  async addMemory(
    projectId: string,
    request: CreateProjectMemoryRequest,
  ): Promise<ProjectMemoryEntry> {
    this.#ensureInitialized();
    this.#requireProject(projectId);

    if (!memoryKinds.has(request.kind)) {
      throw new Error("Unsupported memory kind");
    }

    return this.#mutate(async () => {
      const memory = cloneMemory({
        id: randomUUID(),
        projectId,
        kind: request.kind,
        content: requiredText(
          request.content,
          "content",
        ),
        tags: Object.freeze(
          (request.tags ?? [])
            .map((tag) => tag.trim())
            .filter(Boolean)
            .slice(0, 20),
        ),
        source:
          request.source?.trim() ||
          "forge-desktop",
        createdAt: new Date().toISOString(),
      });

      await this.#save({
        ...this.#state,
        memories: [
          ...this.#state.memories,
          memory,
        ],
      });

      this.#events.publish("operator.memory.added", {
        projectId,
        memoryId: memory.id,
        kind: memory.kind,
      });

      return memory;
    });
  }

  inspectWorkspace(
    projectId: string,
    relativePath = ".",
    depth = 2,
  ): Promise<readonly WorkspaceFileSummary[]> {
    const project = this.#requireProject(projectId);

    this.#events.publish(
      "operator.workspace.inspected",
      {
        projectId,
        relativePath,
        depth,
      },
    );

    return this.#workspace.inspect(
      project.rootPath,
      relativePath,
      depth,
    );
  }

  readWorkspaceFile(
    projectId: string,
    relativePath: string,
    maxChars?: number,
  ): Promise<WorkspaceFileContent> {
    const project = this.#requireProject(projectId);

    return this.#workspace.readText(
      project.rootPath,
      relativePath,
      maxChars,
    );
  }

  routeModel(
    request: ModelRouteRequest,
  ): ModelRouteDecision {
    this.#ensureInitialized();

    const decision = this.#router.route(request);

    this.#events.publish("operator.model.routed", {
      profileId:
        decision.selectedProfile.id,
      taskType: request.taskType,
      privacy: request.privacy,
      executionMode:
        decision.selectedProfile.executionMode,
    });

    return decision;
  }

  listCompositions(
    projectId?: string,
  ): readonly PromptComposition[] {
    this.#ensureInitialized();

    return this.#state.compositions
      .filter(
        (composition) =>
          projectId === undefined ||
          composition.projectId === projectId,
      )
      .map(cloneComposition);
  }

  getComposition(
    compositionId: string,
  ): PromptComposition | null {
    this.#ensureInitialized();

    const composition =
      this.#state.compositions.find(
        (candidate) =>
          candidate.id === compositionId,
      );

    return composition
      ? cloneComposition(composition)
      : null;
  }

  async composePrompt(
    request: PromptComposeRequest,
  ): Promise<PromptComposition> {
    this.#ensureInitialized();

    const project = this.#requireProject(
      request.projectId,
    );
    const objective = requiredText(
      request.objective,
      "objective",
    );
    const selectedKinds =
      request.memoryKinds === undefined
        ? null
        : new Set(request.memoryKinds);

    const memories = this.#state.memories
      .filter(
        (memory) =>
          memory.projectId === project.id &&
          (
            selectedKinds === null ||
            selectedKinds.has(memory.kind)
          ),
      )
      .slice(-20);

    const sourceFiles: WorkspaceFileContent[] = [];

    for (const file of (request.files ?? []).slice(0, 8)) {
      sourceFiles.push(
        await this.#workspace.readText(
          project.rootPath,
          file,
          40_000,
        ),
      );
    }

    const memoryText =
      memories.length === 0
        ? "No persistent project memory selected."
        : memories
            .map(
              (memory) =>
                `- [${memory.kind}] ${memory.content}`,
            )
            .join("\n");

    const fileText =
      sourceFiles.length === 0
        ? "No source files selected."
        : sourceFiles
            .map(
              (file) =>
                `## File: ${file.path}\n\n` +
                "```text\n" +
                file.content +
                "\n```",
            )
            .join("\n\n");

    const preliminaryContext =
      objective.length +
      memoryText.length +
      fileText.length;

    const route = this.routeModel({
      taskType: request.taskType,
      privacy: request.privacy,
      budget: request.budget,
      contextChars: preliminaryContext,
      requiresTools:
        sourceFiles.length > 0,
    });

    const content = [
      "# Objective",
      objective,
      "",
      "# Project",
      `Name: ${project.name}`,
      `Project ID: ${project.id}`,
      "",
      "# Persistent Memory",
      memoryText,
      "",
      "# Source Files",
      fileText,
      "",
      "# Model Route",
      `Profile: ${route.selectedProfile.id}`,
      `Execution mode: ${route.selectedProfile.executionMode}`,
      "Provider binding: resolved by the AI Gateway at execution time",
      `Rationale: ${route.rationale}`,
      "",
      "# Execution Contract",
      "- Use only the supplied project memory and source files as factual project context.",
      "- Do not invent repository state, test results or implementation evidence.",
      "- Respect governance, workspace boundaries and approval requirements.",
      "- Return explicit assumptions and verification steps.",
    ].join("\n");

    return this.#mutate(async () => {
      const composition = cloneComposition({
        id: randomUUID(),
        projectId: project.id,
        objective,
        route,
        memoryIds: Object.freeze(
          memories.map((memory) => memory.id),
        ),
        sourceFiles: Object.freeze(
          sourceFiles.map((file) => file.path),
        ),
        content,
        createdAt:
          new Date().toISOString(),
      });

      await this.#save({
        ...this.#state,
        compositions: [
          ...this.#state.compositions,
          composition,
        ],
      });

      this.#events.publish(
        "operator.prompt.composed",
        {
          compositionId: composition.id,
          projectId: project.id,
          memoryCount:
            composition.memoryIds.length,
          fileCount:
            composition.sourceFiles.length,
          profileId:
            composition.route.selectedProfile.id,
        },
      );

      return composition;
    });
  }

  #requireProject(
    projectId: string,
  ): ProjectRecord {
    const project = this.getProject(projectId);

    if (!project) {
      throw new Error(
        `Project not found: ${projectId}`,
      );
    }

    return project;
  }
}
