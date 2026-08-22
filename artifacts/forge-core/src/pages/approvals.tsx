import {
  Check,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  useApprovalsQuery,
  useApproveApproval,
  useMissionsQuery,
  useRejectApproval,
} from "@/hooks/use-forge-live";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Approvals() {
  const approvals = useApprovalsQuery();
  const missions = useMissionsQuery();
  const approve = useApproveApproval();
  const reject = useRejectApproval();

  const records = [...(approvals.data?.approvals ?? [])].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
  );

  const pending = records.filter(
    (approval) => approval.status === "pending",
  );

  const actionError =
    approve.error instanceof Error
      ? approve.error.message
      : reject.error instanceof Error
        ? reject.error.message
        : null;

  const busy = approve.isPending || reject.isPending;

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Governance Engine
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          Human Approval Queue
        </h1>
        <p className="mt-1 text-muted-foreground">
          Risk-bearing missions remain blocked until an explicit decision is persisted.
        </p>
      </div>

      {actionError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {actionError}
        </div>
      ) : null}

      <Card className={pending.length > 0 ? "border-amber-500/40" : ""}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Pending decisions ({pending.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Governance queue is clear.
            </div>
          ) : (
            <div className="space-y-4">
              {pending.map((approval) => {
                const mission = missions.data?.missions.find(
                  (candidate) => candidate.id === approval.missionId,
                );
                const sourcePlanningMissionId =
                  typeof mission?.input.sourceAutonomousMissionId === "string"
                    ? mission.input.sourceAutonomousMissionId
                    : typeof mission?.input.sourcePlanningMissionId === "string"
                      ? mission.input.sourcePlanningMissionId
                      : null;

                return (
                  <div
                    key={approval.id}
                    className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="font-medium">
                          {approval.assessment.missionKind === "operator.workspace-change"
                            ? "Workspace execution approval"
                            : approval.assessment.missionKind}
                        </div>
                        <div className="mt-1 font-mono text-xs text-muted-foreground">
                          Mission {approval.missionId}
                        </div>
                        <div className="mt-1 font-mono text-xs text-muted-foreground">
                          Approval {approval.id}
                        </div>
                        {sourcePlanningMissionId ? (
                          <div className="mt-1 font-mono text-xs text-muted-foreground">
                            Planning mission {sourcePlanningMissionId}
                          </div>
                        ) : null}
                      </div>
                      <Badge variant="secondary">
                        {approval.assessment.riskLevel} risk
                      </Badge>
                    </div>

                    <p className="mt-4 text-sm text-muted-foreground">
                      {approval.assessment.reason}
                    </p>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        disabled={busy}
                        onClick={() =>
                          approve.mutate({
                            approvalId: approval.id,
                            actor: "forge-desktop-owner",
                            note: "Approved from Forge Desktop.",
                          })
                        }
                      >
                        <Check className="mr-2 h-4 w-4" />
                        Approve and resume
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={busy}
                        onClick={() =>
                          reject.mutate({
                            approvalId: approval.id,
                            actor: "forge-desktop-owner",
                            note: "Rejected from Forge Desktop.",
                          })
                        }
                      >
                        <X className="mr-2 h-4 w-4" />
                        Reject
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Decision history
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {records.map((approval) => (
              <div
                key={approval.id}
                className="grid gap-3 rounded-md border border-border/50 p-3 md:grid-cols-[1fr_110px_180px]"
              >
                <div>
                  <div className="text-sm font-medium">
                    {approval.assessment.missionKind === "operator.workspace-change"
                      ? "Workspace execution approval"
                      : approval.assessment.missionKind}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {approval.note ?? approval.assessment.reason}
                  </div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">
                    Mission {approval.missionId} · Approval {approval.id}
                  </div>
                </div>
                <Badge
                  variant={
                    approval.status === "rejected"
                      ? "destructive"
                      : approval.status === "approved"
                        ? "default"
                        : "secondary"
                  }
                >
                  {approval.status}
                </Badge>
                <div className="text-xs text-muted-foreground">
                  {new Date(approval.updatedAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}