import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  operatorApi,
  type ModelBudget,
  type ModelPrivacy,
  type ModelTaskType,
  type ProjectMemoryKind,
} from "@/lib/operator-api";

const keys = {
  summary: ["operator", "summary"] as const,
  projects: ["operator", "projects"] as const,
  memories: (projectId: string) =>
    ["operator", "memories", projectId] as const,
  files: (
    projectId: string,
    path: string,
  ) =>
    ["operator", "files", projectId, path] as const,
  compositions: (projectId: string) =>
    ["operator", "compositions", projectId] as const,
};

export function useOperatorSummary() {
  return useQuery({
    queryKey: keys.summary,
    queryFn: operatorApi.summary,
    refetchInterval: 5_000,
  });
}

export function useOperatorProjects() {
  return useQuery({
    queryKey: keys.projects,
    queryFn: operatorApi.projects,
  });
}

export function useProjectMemories(
  projectId: string,
) {
  return useQuery({
    queryKey: keys.memories(projectId),
    queryFn: () =>
      operatorApi.memories(projectId),
    enabled: projectId.length > 0,
    refetchInterval: 5_000,
  });
}

export function useWorkspaceFiles(
  projectId: string,
  path = ".",
) {
  return useQuery({
    queryKey: keys.files(projectId, path),
    queryFn: () =>
      operatorApi.inspect(
        projectId,
        path,
        2,
      ),
    enabled: projectId.length > 0,
  });
}

export function usePromptCompositions(
  projectId: string,
) {
  return useQuery({
    queryKey: keys.compositions(projectId),
    queryFn: () =>
      operatorApi.compositions(projectId),
    enabled: projectId.length > 0,
  });
}

export function useAddMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: {
      projectId: string;
      kind: ProjectMemoryKind;
      content: string;
    }) =>
      operatorApi.addMemory(
        request.projectId,
        {
          kind: request.kind,
          content: request.content,
          source: "forge-desktop",
        },
      ),
    onSuccess: async (_memory, request) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey:
            keys.memories(request.projectId),
        }),
        queryClient.invalidateQueries({
          queryKey: keys.summary,
        }),
      ]);
    },
  });
}

export function useComposePrompt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: {
      projectId: string;
      objective: string;
      taskType: ModelTaskType;
      privacy: ModelPrivacy;
      budget: ModelBudget;
      files: readonly string[];
    }) =>
      operatorApi.compose(request),
    onSuccess: async (_composition, request) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey:
            keys.compositions(request.projectId),
        }),
        queryClient.invalidateQueries({
          queryKey: keys.summary,
        }),
      ]);
    },
  });
}