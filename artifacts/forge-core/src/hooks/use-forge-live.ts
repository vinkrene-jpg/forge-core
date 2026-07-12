import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  forgeApi,
  type CreateMissionRequest,
} from "@/lib/forge-api";

export const forgeKeys = {
  runtime: ["forge", "runtime"] as const,
  missions: ["forge", "missions"] as const,
  approvals: ["forge", "approvals"] as const,
  capabilities: ["forge", "capabilities"] as const,
  analyses: ["forge", "analyses"] as const,
  evolution: ["forge", "evolution"] as const,
  learning: ["forge", "learning"] as const,
};

export function useRuntimeQuery() {
  return useQuery({
    queryKey: forgeKeys.runtime,
    queryFn: forgeApi.runtime,
    refetchInterval: 2_000,
  });
}

export function useMissionsQuery() {
  return useQuery({
    queryKey: forgeKeys.missions,
    queryFn: forgeApi.missions,
    refetchInterval: 2_500,
  });
}

export function useApprovalsQuery() {
  return useQuery({
    queryKey: forgeKeys.approvals,
    queryFn: forgeApi.approvals,
    refetchInterval: 2_500,
  });
}

export function useCapabilitiesQuery() {
  return useQuery({
    queryKey: forgeKeys.capabilities,
    queryFn: forgeApi.capabilities,
    refetchInterval: 5_000,
  });
}

export function useAnalysesQuery() {
  return useQuery({
    queryKey: forgeKeys.analyses,
    queryFn: forgeApi.analyses,
    refetchInterval: 5_000,
  });
}

export function useEvolutionPlansQuery() {
  return useQuery({
    queryKey: forgeKeys.evolution,
    queryFn: forgeApi.evolutionPlans,
    refetchInterval: 4_000,
  });
}

export function useLearningQuery() {
  return useQuery({
    queryKey: forgeKeys.learning,
    queryFn: forgeApi.learning,
    refetchInterval: 4_000,
  });
}

function useRefreshForge() {
  const queryClient = useQueryClient();

  return async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: forgeKeys.runtime,
      }),
      queryClient.invalidateQueries({
        queryKey: forgeKeys.missions,
      }),
      queryClient.invalidateQueries({
        queryKey: forgeKeys.approvals,
      }),
      queryClient.invalidateQueries({
        queryKey: forgeKeys.capabilities,
      }),
      queryClient.invalidateQueries({
        queryKey: forgeKeys.analyses,
      }),
      queryClient.invalidateQueries({
        queryKey: forgeKeys.evolution,
      }),
      queryClient.invalidateQueries({
        queryKey: forgeKeys.learning,
      }),
    ]);
  };
}

export function useCreateMission() {
  const refresh = useRefreshForge();

  return useMutation({
    mutationFn: (request: CreateMissionRequest) =>
      forgeApi.createMission(request),
    onSuccess: refresh,
  });
}

export function useApproveApproval() {
  const refresh = useRefreshForge();

  return useMutation({
    mutationFn: (request: {
      approvalId: string;
      actor: string;
      note?: string;
    }) =>
      forgeApi.approveApproval(
        request.approvalId,
        request.actor,
        request.note,
      ),
    onSuccess: refresh,
  });
}

export function useRejectApproval() {
  const refresh = useRefreshForge();

  return useMutation({
    mutationFn: (request: {
      approvalId: string;
      actor: string;
      note?: string;
    }) =>
      forgeApi.rejectApproval(
        request.approvalId,
        request.actor,
        request.note,
      ),
    onSuccess: refresh,
  });
}

export function useApproveEvolutionPlan() {
  const refresh = useRefreshForge();

  return useMutation({
    mutationFn: (request: {
      planId: string;
      actor: string;
    }) =>
      forgeApi.approveEvolutionPlan(
        request.planId,
        request.actor,
      ),
    onSuccess: refresh,
  });
}

export function useExecuteEvolutionPlan() {
  const refresh = useRefreshForge();

  return useMutation({
    mutationFn: (planId: string) =>
      forgeApi.executeEvolutionPlan(planId),
    onSuccess: refresh,
  });
}

export function useScheduleLearningProposal() {
  const refresh = useRefreshForge();

  return useMutation({
    mutationFn: (proposalId: string) =>
      forgeApi.scheduleLearningProposal(proposalId),
    onSuccess: refresh,
  });
}
