import type {
  ModelBudget,
  ModelPrivacy,
  ModelRouteDecision,
  ModelRouteRequest,
  ModelTaskType,
  OperatorCoreSummary,
  ProjectMemoryEntry,
  ProjectMemoryKind,
  ProjectRecord,
  PromptComposition,
  WorkspaceFileContent,
  WorkspaceFileSummary,
} from "@workspace/forge-runtime";

export type {
  ModelBudget,
  ModelPrivacy,
  ModelRouteDecision,
  ModelRouteRequest,
  ModelTaskType,
  OperatorCoreSummary,
  ProjectMemoryEntry,
  ProjectMemoryKind,
  ProjectRecord,
  PromptComposition,
  WorkspaceFileContent,
  WorkspaceFileSummary,
};

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);

  if (
    init.body !== undefined &&
    !headers.has("Content-Type")
  ) {
    headers.set(
      "Content-Type",
      "application/json",
    );
  }

  const response = await fetch(path, {
    ...init,
    headers,
  });
  const text = await response.text();
  let payload: unknown = null;

  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const errorMessage =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `Request failed: ${response.status}`;

    throw new Error(errorMessage);
  }

  return payload as T;
}

export const operatorApi = {
  summary(): Promise<OperatorCoreSummary> {
    return requestJson("/api/operator");
  },

  projects(): Promise<{
    readonly projects: readonly ProjectRecord[];
  }> {
    return requestJson("/api/operator/projects");
  },

  memories(
    projectId: string,
  ): Promise<{
    readonly memories:
      readonly ProjectMemoryEntry[];
  }> {
    return requestJson(
      `/api/operator/projects/${projectId}/memories`,
    );
  },

  addMemory(
    projectId: string,
    request: {
      readonly kind: ProjectMemoryKind;
      readonly content: string;
      readonly tags?: readonly string[];
      readonly source?: string;
    },
  ): Promise<ProjectMemoryEntry> {
    return requestJson(
      `/api/operator/projects/${projectId}/memories`,
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    );
  },

  inspect(
    projectId: string,
    path = ".",
    depth = 2,
  ): Promise<{
    readonly files:
      readonly WorkspaceFileSummary[];
  }> {
    const query = new URLSearchParams({
      path,
      depth: String(depth),
    });

    return requestJson(
      `/api/operator/projects/${projectId}/files?${query}`,
    );
  },

  readFile(
    projectId: string,
    path: string,
  ): Promise<WorkspaceFileContent> {
    return requestJson(
      `/api/operator/projects/${projectId}/read`,
      {
        method: "POST",
        body: JSON.stringify({ path }),
      },
    );
  },

  routeModel(
    request: ModelRouteRequest,
  ): Promise<ModelRouteDecision> {
    return requestJson(
      "/api/operator/model-route",
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    );
  },

  compositions(
    projectId?: string,
  ): Promise<{
    readonly compositions:
      readonly PromptComposition[];
  }> {
    const query =
      projectId === undefined
        ? ""
        : `?projectId=${encodeURIComponent(projectId)}`;

    return requestJson(
      `/api/operator/prompts${query}`,
    );
  },

  compose(request: {
    readonly projectId: string;
    readonly objective: string;
    readonly taskType: ModelTaskType;
    readonly privacy: ModelPrivacy;
    readonly budget: ModelBudget;
    readonly files?: readonly string[];
    readonly memoryKinds?: readonly ProjectMemoryKind[];
  }): Promise<PromptComposition> {
    return requestJson(
      "/api/operator/prompts",
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    );
  },
};