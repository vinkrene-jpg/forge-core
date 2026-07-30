import type { MissionRecord } from "@workspace/forge-runtime";
import { Badge } from "@/components/ui/badge";

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function EvidenceSection({
  title,
  value,
}: {
  readonly title: string;
  readonly value: unknown;
}) {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title} ({value.length})
      </div>
      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-border/50 bg-background p-3 text-xs text-muted-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export function MissionDetails({
  mission,
  linkedExecutionMission = null,
  workspaceExecutionApprovalId = null,
}: {
  readonly mission: MissionRecord;
  readonly linkedExecutionMission?: MissionRecord | null;
  readonly workspaceExecutionApprovalId?: string | null;
}) {
  const output = record(mission.output);
  const input = record(mission.input);
  const linkedOutput = record(linkedExecutionMission?.output);
  const workspaceExecutionMissionId =
    text(output?.workspaceExecutionMissionId) ??
    linkedExecutionMission?.id ??
    (mission.kind === "operator.workspace-change" ? mission.id : null);
  const approvalId =
    text(output?.workspaceExecutionApprovalId) ??
    workspaceExecutionApprovalId;
  const sourceAutonomousMissionId =
    text(input?.sourceAutonomousMissionId) ??
    text(output?.sourceAutonomousMissionId);
  const executionOutput = linkedOutput ?? output;
  const executionEvidence = record(executionOutput?.executionEvidence);
  const evaluation = record(executionOutput?.evaluation);
  const executionStatus = linkedExecutionMission?.status ??
    (mission.kind === "operator.workspace-change" ? mission.status : null);
  const waitingForExecutionApproval =
    workspaceExecutionMissionId !== null &&
    executionStatus === "awaiting_approval";

  return (
    <div className="space-y-5 text-sm">
      {waitingForExecutionApproval ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 font-medium text-amber-700 dark:text-amber-300">
          Plan voltooid — uitvoering wacht op approval.
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-border/50 p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Missie
          </div>
          <div className="mt-1 font-medium">{mission.title}</div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">
            {mission.id}
          </div>
        </div>
        <div className="rounded-md border border-border/50 p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Type en status
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline">{mission.kind}</Badge>
            <Badge variant="secondary">{mission.status}</Badge>
          </div>
        </div>
        {workspaceExecutionMissionId ? (
          <div className="rounded-md border border-border/50 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Workspace execution mission
            </div>
            <div className="mt-1 font-mono text-xs">
              {workspaceExecutionMissionId}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              Status: {executionStatus ?? "onbekend"}
            </div>
          </div>
        ) : null}
        {approvalId ? (
          <div className="rounded-md border border-border/50 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Workspace execution approval
            </div>
            <div className="mt-1 font-mono text-xs">{approvalId}</div>
          </div>
        ) : null}
        {sourceAutonomousMissionId ? (
          <div className="rounded-md border border-border/50 p-3 md:col-span-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Gekoppelde planningsmissie
            </div>
            <div className="mt-1 font-mono text-xs">
              {sourceAutonomousMissionId}
            </div>
          </div>
        ) : null}
      </div>

      {executionEvidence ? (
        <div className="space-y-4 rounded-md border border-border/60 p-4">
          <div className="font-semibold">Execution evidence</div>
          <EvidenceSection title="Receipts" value={executionEvidence.receipts} />
          <EvidenceSection title="File effects" value={executionEvidence.fileEffects} />
          <EvidenceSection title="Verification runs" value={executionEvidence.verificationRuns} />
          <EvidenceSection title="Artifacts" value={executionEvidence.artifacts} />
        </div>
      ) : null}

      {evaluation ? (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Evaluation
          </div>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border/50 bg-background p-3 text-xs text-muted-foreground">
            {JSON.stringify(evaluation, null, 2)}
          </pre>
        </div>
      ) : null}

      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Persisted mission output
        </div>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border/50 bg-background p-3 text-xs text-muted-foreground">
          {JSON.stringify(mission.output ?? {}, null, 2)}
        </pre>
      </div>
    </div>
  );
}
