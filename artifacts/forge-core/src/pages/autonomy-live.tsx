import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  useAutonomyQuery,
  useResumeAutonomy,
  useStartAutonomy,
  useStopAutonomy,
} from "@/hooks/use-forge-live";

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

export default function AutonomyLive() {
  const autonomy = useAutonomyQuery();
  const start = useStartAutonomy();
  const resume = useResumeAutonomy();
  const stop = useStopAutonomy();

  if (autonomy.isLoading || !autonomy.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Autonomy runtime</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Loading autonomy state...
        </CardContent>
      </Card>
    );
  }

  const data = autonomy.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Autonomous Loop</h1>
          <p className="text-sm text-muted-foreground">
            {"Analyse -> choose -> plan -> execute -> test -> learn -> repeat."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={data.enabled ? "default" : "secondary"}>
            {data.enabled ? "ENABLED" : "DISABLED"}
          </Badge>
          <Badge variant={data.loopPaused ? "destructive" : "outline"}>
            {data.loopPaused ? "PAUSED" : "RUNNING"}
          </Badge>
          <Badge variant={data.blockedByHardGovernance ? "destructive" : "outline"}>
            {data.blockedByHardGovernance ? "HARD GOVERNANCE BLOCK" : "UNBLOCKED"}
          </Badge>
          <Button
            onClick={() => void start.mutateAsync()}
            disabled={data.enabled || start.isPending}
          >
            Start
          </Button>
          <Button
            variant="outline"
            onClick={() => void resume.mutateAsync()}
            disabled={!data.loopPaused || resume.isPending}
          >
            Resume
          </Button>
          <Button
            variant="outline"
            onClick={() => void stop.mutateAsync()}
            disabled={!data.enabled || stop.isPending}
          >
            Stop
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Loop</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>Status: {data.loopStatus}</div>
            <div>Ticks: {data.totalTicks}</div>
            <div>Cycles scheduled: {data.cyclesScheduled}</div>
            <div>Last tick: {data.lastTickAt ?? "-"}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Governance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>Pending approvals: {data.pendingApprovals}</div>
            <div>Hard boundaries: {data.pendingHardApprovals}</div>
            <div>Auto approvals: {data.lowRiskApprovalsAutoGranted}</div>
            <div>Blocking risk: {data.blockingRiskLevel ?? "-"}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Pause</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>Requires resume: {data.pauseRequiresResume ? "yes" : "no"}</div>
            <div>Reason: {data.pauseReason ?? "-"}</div>
            <div>Details: {data.pauseDetails ?? "-"}</div>
            <div>Until: {data.pauseUntil ?? "-"}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Missions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>Queued: {data.queuedMissions}</div>
            <div>Running: {data.runningMissions}</div>
            <div>Awaiting approval: {data.awaitingApprovalMissions}</div>
            <div>Latest mission: {data.latestMissionId ?? "-"}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Budget</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>Budget: {formatUsd(data.costBudgetUsd)}</div>
            <div>Spent: {formatUsd(data.costSpentUsd)}</div>
            <div>Remaining: {formatUsd(data.costRemainingUsd)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Backlog</CardTitle>
        </CardHeader>
        <CardContent>
          {data.backlog.length === 0 ? (
            <div className="text-sm text-muted-foreground">No backlog items yet.</div>
          ) : (
            <div className="space-y-2">
              {data.backlog
                .slice()
                .sort((left, right) => right.priority - left.priority)
                .slice(0, 20)
                .map((item) => (
                  <div key={item.id} className="rounded border border-border/70 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <strong>{item.objective}</strong>
                      <Badge variant="outline">{item.status}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      priority {item.priority} · source {item.source} · mission {item.missionId ?? "-"}
                    </div>
                    <div className="mt-2 text-xs">
                      <div>Reason: {item.selectionReason}</div>
                      <div>
                        Expected evidence: {item.expectedNewEvidence.join("; ")}
                      </div>
                    </div>
                    {item.lastError ? (
                      <div className="mt-2 text-xs text-destructive">{item.lastError}</div>
                    ) : null}
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
