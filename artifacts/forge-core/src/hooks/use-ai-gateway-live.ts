import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { aiGatewayApi } from "@/lib/ai-gateway-api";

const keys = {
  status: ["ai-gateway", "status"] as const,
  executions: [
    "ai-gateway",
    "executions",
  ] as const,
};

export function useAiGatewayStatus() {
  return useQuery({
    queryKey: keys.status,
    queryFn: aiGatewayApi.status,
    refetchInterval: 5_000,
  });
}

export function useAiExecutions() {
  return useQuery({
    queryKey: keys.executions,
    queryFn: aiGatewayApi.executions,
    refetchInterval: 4_000,
  });
}

export function useExecuteComposition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (compositionId: string) =>
      aiGatewayApi.execute(
        compositionId,
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: keys.status,
        }),
        queryClient.invalidateQueries({
          queryKey: keys.executions,
        }),
      ]);
    },
  });
}