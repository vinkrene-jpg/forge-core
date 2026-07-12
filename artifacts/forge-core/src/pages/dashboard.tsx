import { Link } from "wouter";
import {
  Activity,
  Boxes,
  Clock3,
  ListChecks,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import {
  useApprovalsQuery,
  useMissionsQuery,
  useRuntimeQuery,
} from "@/hooks/use-forge-live";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function badgeVariant(
  status: string,
): "default" | "secondary" | "outline" | "destructive" {
  if (
    status === "ok" ||
    status === "running" ||
    status === "succeeded" ||
    status === "operational" ||
    status === "completed" ||
    status === "approved"
  ) {
    return "default";
  }

  if (
    status === "failed" ||
    status === "cancelled" ||
    status === "rejected" ||
    status === "degraded"
  ) {
    return "destructive";
  }

  if (
    status === "pending" ||
    status === "queued" ||
    status === "awaiting_approval" ||
    status === "proposed"
  ) {
    return "secondary";
  }

  return "outline";
}

export default function Dashboard() {
  const runtime = useRuntimeQuery();
  const missions = useMissionsQuery();
  const approvals = useApprovalsQuery();

  if (runtime.isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">
          Forge Runtime
        </h1>
        <div className="grid gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  if (runtime.isError || !runtime.data) {
    return (
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Forge Runtime unavailable</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {runtime.error instanceof Error
            ? runtime.error.message
            : "The live runtime endpoint could not be reached."}
        </CardContent>
      </Card>
    );
  }

  const snapshot = runtime.data;
  const missionList = [...(missions.data?.missions ?? [])]
    .sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )
    .slice(0, 6);
  const pendingApprovals =
    approvals.data?.approvals.filter(
      (approval) => approval.status === "pending",
    ) ?? [];
  const recentEvents = [...snapshot.events]
    .reverse()
    .slice(0, 10);

  const cards = [
    {
      label: "Kernel",
      value: snapshot.kernel.status,
      detail: `Uptime ${formatDuration(snapshot.health.uptimeMs)}`,
      icon: Activity,
    },
    {
      label: "MissionLoop",
      value: snapshot.missionLoop.status,
      detail:
        snapshot.missionLoop.currentMissionId === null
          ? "Idle â€” waiting for work"
          : `Mission ${snapshot.missionLoop.currentMissionId.slice(0, 8)}`,
      icon: ListChecks,
    },
    {
      label: "Pending approvals",
      value: String(snapshot.governance.pending),
      detail: `${snapshot.governance.approved} approved Â· ${snapshot.governance.rejected} rejected`,
      icon: ShieldCheck,
    },
    {
      label: "Capabilities",
      value: String(snapshot.capabilities.operational),
      detail: `${snapshot.capabilities.experimental} experimental Â· ${snapshot.capabilities.total} total`,
      icon: Boxes,
    },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Live Runtime
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Forge Mission Control
          </h1>
          <p className="mt-1 text-muted-foreground">
            One authoritative view of the running Forge Core.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={badgeVariant(snapshot.health.status)}>
            {snapshot.health.status.toUpperCase()}
          </Badge>
          <Badge variant="outline">
            Session {snapshot.persistence.sessionId?.slice(0, 8)}
          </Badge>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((item) => (
          <Card key={item.label} className="bg-card/70">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm font-medium text-muted-foreground">
                {item.label}
                <item.icon className="h-4 w-4 text-primary" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold capitalize">
                {item.value}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {item.detail}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-lg">
              Recent missions
              <Link
                href="/missions"
                className="text-sm font-normal text-primary hover:underline"
              >
                Open queue
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {missionList.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No missions recorded.
                </div>
              ) : (
                missionList.map((mission) => (
                  <div
                    key={mission.id}
                    className="flex items-center justify-between gap-4 rounded-md border border-border/60 bg-background/50 p-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {mission.title}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {mission.kind} Â· attempts {mission.attempts} Â·
                        interruptions {mission.interruptedCount}
                      </div>
                    </div>
                    <Badge variant={badgeVariant(mission.status)}>
                      {mission.status}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card className={pendingApprovals.length > 0 ? "border-amber-500/40" : ""}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-lg">
              Governance
              <Link
                href="/approvals"
                className="text-sm font-normal text-primary hover:underline"
              >
                Review
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pendingApprovals.length === 0 ? (
              <div className="flex min-h-40 flex-col items-center justify-center text-center">
                <ShieldCheck className="mb-3 h-8 w-8 text-emerald-500" />
                <div className="font-medium">No pending decisions</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Governance queue is clear.
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingApprovals.map((approval) => (
                  <div
                    key={approval.id}
                    className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">
                        {approval.assessment.missionKind}
                      </span>
                      <Badge variant="secondary">
                        {approval.assessment.riskLevel}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {approval.assessment.reason}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.65fr_1.35fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Evolution state
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div className="rounded-md border border-border/60 p-3">
              <div className="text-xs text-muted-foreground">
                Proposed
              </div>
              <div className="mt-1 text-2xl font-bold">
                {snapshot.evolution.proposed}
              </div>
            </div>
            <div className="rounded-md border border-border/60 p-3">
              <div className="text-xs text-muted-foreground">
                Completed
              </div>
              <div className="mt-1 text-2xl font-bold text-emerald-500">
                {snapshot.evolution.completed}
              </div>
            </div>
            <div className="rounded-md border border-border/60 p-3">
              <div className="text-xs text-muted-foreground">
                Executing
              </div>
              <div className="mt-1 text-2xl font-bold">
                {snapshot.evolution.executing}
              </div>
            </div>
            <div className="rounded-md border border-border/60 p-3">
              <div className="text-xs text-muted-foreground">
                Safely cancelled
              </div>
              <div className="mt-1 text-2xl font-bold text-amber-500">
                {snapshot.evolution.cancelled}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-lg">
              Runtime events
              <Link
                href="/events"
                className="text-sm font-normal text-primary hover:underline"
              >
                Full stream
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 font-mono text-xs">
              {recentEvents.map((event) => (
                <div
                  key={event.sequence}
                  className="grid grid-cols-[56px_155px_1fr] gap-3 border-b border-border/30 py-2 last:border-0"
                >
                  <span className="text-muted-foreground">
                    #{event.sequence}
                  </span>
                  <span className="text-primary">
                    {event.type}
                  </span>
                  <span className="truncate text-muted-foreground">
                    {JSON.stringify(event.payload)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock3 className="h-3.5 w-3.5" />
        Last runtime check{" "}
        {new Date(snapshot.health.checkedAt).toLocaleTimeString()}
      </div>
    </div>
  );
}