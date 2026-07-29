import { Bot, Play, ShieldAlert } from "lucide-react";
import {
  useCreateMission,
  useMissionsQuery,
  useScheduleWorkspacePlan,
} from "@/hooks/use-forge-live";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function variant(
  status: string,
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "succeeded" || status === "running") {
    return "default";
  }

  if (status === "failed" || status === "cancelled") {
    return "destructive";
  }

  return "secondary";
}

export default function Missions() {
  const missions = useMissionsQuery();
  const createMission = useCreateMission();
  const scheduleWorkspacePlan = useScheduleWorkspacePlan();

  const records = [...(missions.data?.missions ?? [])].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
  );

  const error =
    (createMission.error ?? scheduleWorkspacePlan.error) instanceof Error
      ? (createMission.error ?? scheduleWorkspacePlan.error as Error).message
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Mission Engine
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Persistent Mission Queue
          </h1>
          <p className="mt-1 text-muted-foreground">
            Create governed work and follow execution from queue to evidence.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={createMission.isPending}
            onClick={() =>
              createMission.mutate({
                kind: "runtime.self-check",
                title: "Desktop runtime self-check",
                input: {},
              })
            }
          >
            <Play className="mr-2 h-4 w-4" />
            Run self-check
          </Button>
          <Button
            variant="outline"
            disabled={createMission.isPending}
            onClick={() =>
              createMission.mutate({
                kind: "operator.autonomous-cycle",
                title: "Autonomous provider loop 1/2",
                input: {
                  projectId: "forge-core",
                  objective:
                    "Review the current Forge Core architecture and identify the next evidence-backed implementation step toward the verified end architecture.",
                  cycleIndex: 1,
                  maxCycles: 2,
                  files: [
                    "GOVERNANCE/ROADMAP.md",
                    "reconstruction/CURRENT_STATE.md",
                    "reconstruction/NEXT_MISSION.md",
                  ],
                },
              })
            }
          >
            <Bot className="mr-2 h-4 w-4" />
            Start autonomous loop
          </Button>
          <Button
            variant="outline"
            disabled={createMission.isPending}
            onClick={() =>
              createMission.mutate({
                kind: "runtime.stability-window",
                title: "Desktop stability window",
                input: {
                  durationMs: 10_000,
                  sampleIntervalMs: 500,
                },
              })
            }
          >
            <ShieldAlert className="mr-2 h-4 w-4" />
            Request stability mission
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Missions ({records.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-3">Mission</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Attempts</th>
                  <th className="px-3 py-3">Interrupted</th>
                  <th className="px-3 py-3">Updated</th>
                </tr>
              </thead>
              <tbody>
                {records.map((mission) => {
                  const rawPlan = mission.output?.plan;
                  const plan =
                    typeof rawPlan === "object" &&
                    rawPlan !== null &&
                    "request" in rawPlan &&
                    typeof rawPlan.request === "object" &&
                    rawPlan.request !== null
                      ? rawPlan as {
                          summary?: unknown;
                          providerOutputSha256?: unknown;
                          request: {
                            changes?: unknown;
                            verification?: unknown;
                          };
                        }
                      : null;
                  const changes = Array.isArray(plan?.request.changes)
                    ? plan.request.changes
                    : [];
                  const alreadyScheduled = records.some(
                    (candidate) =>
                      candidate.kind === "operator.workspace-change" &&
                      candidate.input.sourcePlanningMissionId === mission.id,
                  );

                  return (
                  <tr
                    key={mission.id}
                    className="border-b border-border/40 last:border-0"
                  >
                    <td className="px-3 py-4">
                      <div className="font-medium">
                        {mission.title}
                      </div>
                      <div className="mt-1 font-mono text-xs text-muted-foreground">
                        {mission.kind} Â· {mission.id.slice(0, 8)}
                      </div>
                      {mission.lastError ? (
                        <div className="mt-2 text-xs text-destructive">
                          {mission.lastError}
                        </div>
                      ) : null}
                      {mission.output?.evaluation &&
                      typeof mission.output.evaluation === "object" ? (
                        <div className="mt-2 text-xs text-muted-foreground">
                          Evaluated and persisted · next mission{" "}
                          {typeof mission.output.nextMissionId === "string"
                            ? mission.output.nextMissionId.slice(0, 8)
                            : "none"}
                        </div>
                      ) : null}
                      {plan ? (
                        <div className="mt-3 rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
                          <div className="font-medium text-foreground">
                            {typeof plan.summary === "string"
                              ? plan.summary
                              : "Validated provider plan"}
                          </div>
                          <div className="mt-2 space-y-1 font-mono text-muted-foreground">
                            {changes.map((change, index) => {
                              const item = change as Record<string, unknown>;
                              return (
                                <div key={`${String(item.path)}-${index}`}>
                                  {String(item.path)} · source {String(item.expectedSha256).slice(0, 12)}
                                </div>
                              );
                            })}
                          </div>
                          <div className="mt-2 text-muted-foreground">
                            Checks: {Array.isArray(plan.request.verification)
                              ? plan.request.verification.join(", ")
                              : "unknown"}
                          </div>
                          {!alreadyScheduled ? (
                            <Button
                              className="mt-3"
                              size="sm"
                              variant="outline"
                              disabled={scheduleWorkspacePlan.isPending}
                              onClick={() => scheduleWorkspacePlan.mutate(mission.id)}
                            >
                              Request execution approval
                            </Button>
                          ) : (
                            <div className="mt-2 text-primary">
                              Execution approval requested
                            </div>
                          )}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-4">
                      <Badge variant={variant(mission.status)}>
                        {mission.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-4 font-mono">
                      {mission.attempts}
                    </td>
                    <td className="px-3 py-4 font-mono">
                      {mission.interruptedCount}
                    </td>
                    <td className="px-3 py-4 text-muted-foreground">
                      {new Date(mission.updatedAt).toLocaleString()}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!missions.isLoading && records.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No missions recorded.
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
