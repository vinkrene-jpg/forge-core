import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import {
  Play,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Sparkles,
} from "lucide-react";
import {
  useApproveApproval,
} from "@/hooks/use-forge-live";
import {
  useMissionIntakePreview,
  useMissionStatus,
  useRecordMissionResult,
  useStartMissionFromIntake,
} from "@/hooks/use-operator-core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { MissionDetails } from "@/components/mission-details";
import {
  handleMissionConsoleSubmit,
  type MissionConsoleRequestDiagnostic,
} from "@/pages/mission-console-submit";

export const MISSION_CONSOLE_BUILD_MARKER =
  "mission-console-mounted-submit-2026-07-30.1";

function progressForStatus(status: string): number {
  if (status === "awaiting_approval") {
    return 20;
  }
  if (status === "queued") {
    return 35;
  }
  if (status === "running") {
    return 70;
  }
  if (status === "succeeded" || status === "failed" || status === "cancelled") {
    return 100;
  }
  return 0;
}

export default function MissionConsolePage() {
  const [command, setCommand] = useState(
    "Analyseer de huidige Forge-status en voer autonoom de volgende evidence-backed missie uit.",
  );
  const [missionId, setMissionId] = useState<string | null>(null);
  const [recordedMissionIds, setRecordedMissionIds] = useState<string[]>([]);
  const [requestDiagnostic, setRequestDiagnostic] =
    useState<MissionConsoleRequestDiagnostic | null>(null);

  const preview = useMissionIntakePreview(command);
  const startMission = useStartMissionFromIntake();
  const mission = useMissionStatus(missionId);
  const approve = useApproveApproval();
  const recordResult = useRecordMissionResult();

  const activeMission = mission.data;
  const activeApprovalId = startMission.data?.approval?.id ?? null;
  const workspaceExecutionMissionId =
    typeof activeMission?.output?.workspaceExecutionMissionId === "string"
      ? activeMission.output.workspaceExecutionMissionId
      : null;
  const workspaceExecutionApprovalId =
    typeof activeMission?.output?.workspaceExecutionApprovalId === "string"
      ? activeMission.output.workspaceExecutionApprovalId
      : null;
  const workspaceExecutionMission = useMissionStatus(
    workspaceExecutionMissionId,
  );
  const activeProgress = activeMission
    ? progressForStatus(activeMission.status)
    : startMission.data?.progress ?? 0;

  useEffect(() => {
    if (!activeMission || !missionId) {
      return;
    }

    if (
      activeMission.status !== "succeeded" &&
      activeMission.status !== "failed" &&
      activeMission.status !== "cancelled"
    ) {
      return;
    }

    if (recordedMissionIds.includes(missionId) || recordResult.isPending) {
      return;
    }

    void recordResult.mutateAsync(missionId).then(() => {
      setRecordedMissionIds((current) => [...current, missionId]);
    }).catch(() => {
      // Surface via mutation error state below.
    });
  }, [activeMission, missionId, recordResult, recordedMissionIds]);

  const outcomeText = useMemo(() => {
    if (!activeMission) {
      return "Nog geen missie gestart.";
    }

    if (activeMission.status === "succeeded") {
      return JSON.stringify(activeMission.output ?? {}, null, 2);
    }

    if (activeMission.status === "failed") {
      if (activeMission.output) {
        return JSON.stringify(activeMission.output, null, 2);
      }
      return activeMission.lastError ?? "Missie mislukt zonder expliciete foutmelding.";
    }

    if (activeMission.status === "cancelled") {
      if (activeMission.output) {
        return JSON.stringify(activeMission.output, null, 2);
      }
      return "Missie geannuleerd.";
    }

    if (activeMission.status === "awaiting_approval") {
      return "Blokkade: governance-goedkeuring vereist voordat uitvoering start.";
    }

    return "Missie actief. Forge rapporteert voortgang automatisch.";
  }, [activeMission]);

  const error =
    preview.error instanceof Error
      ? preview.error.message
      : startMission.error instanceof Error
        ? startMission.error.message
        : approve.error instanceof Error
          ? approve.error.message
          : recordResult.error instanceof Error
            ? recordResult.error.message
            : null;

  const missionResult =
    activeMission?.output &&
    typeof activeMission.output.missionResult === "object" &&
    activeMission.output.missionResult !== null
      ? activeMission.output.missionResult as {
          status?: unknown;
          cause?: unknown;
          message?: unknown;
          producedAt?: unknown;
        }
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Mission Console
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Primaire Forge-opdrachtinterface
          </h1>
          <p className="mt-1 text-muted-foreground">
            Geef nieuwe opdrachten direct in Forge Desktop. Geen VS Code nodig voor standaard missie-invoer.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge variant="outline">Desktop primary interface</Badge>
          <Badge variant="secondary" data-testid="mission-console-build-marker">
            Build {MISSION_CONSOLE_BUILD_MARKER}
          </Badge>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-primary" />
            Nieuwe missie
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            className="min-h-24"
            placeholder="Beschrijf de missie die Forge moet uitvoeren"
          />

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-border/50 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Geinterpreteerde missie</div>
              <div className="mt-1 text-sm">{preview.data?.interpretedGoal ?? "Nog geen interpretatie"}</div>
            </div>

            <div className="rounded-md border border-border/50 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Missietype</div>
              <div className="mt-1 text-sm font-medium">{preview.data?.missionKind ?? "Nog niet bepaald"}</div>
            </div>

            <div className="rounded-md border border-border/50 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Governance en risico</div>
              <div className="mt-1 flex items-center gap-2 text-sm font-medium">
                {preview.data?.governance.status === "can_start" ? (
                  <ShieldCheck className="h-4 w-4 text-emerald-500" />
                ) : preview.data?.governance.status === "approval_required" ? (
                  <ShieldQuestion className="h-4 w-4 text-amber-500" />
                ) : (
                  <ShieldAlert className="h-4 w-4 text-destructive" />
                )}
                <span>
                  {preview.data
                    ? `${preview.data.governance.status} (${preview.data.governance.riskLevel})`
                    : "Nog niet bepaald"}
                </span>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">{preview.data?.governance.reason ?? ""}</div>
            </div>
          </div>

          <div className="rounded-md border border-border/50 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Verwachte capabilities</div>
            <div className="mt-2 space-y-2 text-xs">
              {(preview.data?.expectedCapabilities ?? []).map((capability) => (
                <div key={capability.capabilityId} className="rounded border border-border/50 p-2">
                  <div className="font-mono text-[11px]">{capability.capabilityId}</div>
                  <div className="mt-1 text-muted-foreground">
                    vereist: {capability.minimumStatus} · huidig: {capability.currentStatus}
                  </div>
                  <div className="mt-1 text-muted-foreground">{capability.reason}</div>
                </div>
              ))}
              {(preview.data?.expectedCapabilities ?? []).length === 0 ? (
                <div className="text-muted-foreground">Nog geen capability-preview beschikbaar.</div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={
                command.trim().length < 8 ||
                preview.isLoading ||
                startMission.isPending ||
                !preview.data
              }
              onClick={() => {
                if (!preview.data) {
                  return;
                }

                void handleMissionConsoleSubmit(
                  command,
                  (currentRawObjective, onRequest) =>
                    startMission.mutateAsync({
                      rawObjective: currentRawObjective,
                      onRequest,
                    }),
                  (diagnostic) => {
                    flushSync(() => {
                      setRequestDiagnostic(diagnostic);
                    });
                  },
                )
                  .then((result) => {
                    setMissionId(result.mission.id);
                  });
              }}
            >
              <Play className="mr-2 h-4 w-4" />
              Start missie
            </Button>

            {activeMission?.status === "awaiting_approval" && activeApprovalId ? (
              <Button
                variant="outline"
                disabled={approve.isPending}
                onClick={() => {
                  void approve.mutateAsync({
                    approvalId: activeApprovalId,
                    actor: "mission-console",
                    note: "Approved via Mission Console",
                  });
                }}
              >
                <ShieldCheck className="mr-2 h-4 w-4" />
                Goedkeuren en starten
              </Button>
            ) : null}
          </div>

          <div
            className="rounded-md border border-border/50 p-3"
            data-testid="mission-console-request-diagnostics"
          >
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Client request diagnostics
            </div>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-background p-3 text-xs text-muted-foreground">
              {requestDiagnostic
                ? JSON.stringify(requestDiagnostic, null, 2)
                : "Nog geen submitrequest verzonden."}
            </pre>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Live voortgang</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-border/50 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Missie-ID</div>
              <div className="mt-1 font-mono text-xs">{activeMission?.id ?? "Nog niet gestart"}</div>
            </div>
            <div className="rounded-md border border-border/50 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Status</div>
              <div className="mt-1 text-sm font-medium">{activeMission?.status ?? "idle"}</div>
            </div>
            <div className="rounded-md border border-border/50 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Voortgang</div>
              <div className="mt-2 space-y-2">
                <Progress value={activeProgress} />
                <div className="text-xs text-muted-foreground">{activeProgress}%</div>
              </div>
            </div>
          </div>

          {missionResult ? (
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-md border border-border/50 p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Result status</div>
                <div className="mt-1 text-sm font-medium">{String(missionResult.status ?? "unknown")}</div>
              </div>
              <div className="rounded-md border border-border/50 p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Cause</div>
                <div className="mt-1 text-sm font-medium">{String(missionResult.cause ?? "unknown")}</div>
              </div>
              <div className="rounded-md border border-border/50 p-3 md:col-span-2">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Message</div>
                <div className="mt-1 text-sm text-muted-foreground">{String(missionResult.message ?? "")}</div>
                <div className="mt-2 text-xs text-muted-foreground">{String(missionResult.producedAt ?? "")}</div>
              </div>
            </div>
          ) : null}

          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Eindresultaat / blokkade</div>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border/50 bg-background p-3 text-xs text-muted-foreground">
              {outcomeText}
            </pre>
          </div>
        </CardContent>
      </Card>

      {activeMission && workspaceExecutionMissionId ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Gekoppelde workspace-uitvoering</CardTitle>
          </CardHeader>
          <CardContent>
            <MissionDetails
              mission={activeMission}
              linkedExecutionMission={workspaceExecutionMission.data ?? null}
              workspaceExecutionApprovalId={workspaceExecutionApprovalId}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
