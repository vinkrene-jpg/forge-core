import { AlertTriangle, Boxes, Play, ShieldCheck, Target } from "lucide-react";
import {
  useCapabilityGoalRunsQuery,
  useCapabilityGapsQuery,
  useCapabilitiesQuery,
  useReleaseCapabilityGap,
  useRuntimeQuery,
  useStartCapabilityGoalRun,
} from "@/hooks/use-forge-live";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Capabilities() {
  const capabilities = useCapabilitiesQuery();
  const gaps = useCapabilityGapsQuery();
  const goalRuns = useCapabilityGoalRunsQuery();
  const releaseGap = useReleaseCapabilityGap();
  const startGoalRun = useStartCapabilityGoalRun();
  const runtime = useRuntimeQuery();

  const records = [...(capabilities.data?.capabilities ?? [])].sort(
    (left, right) =>
      left.name.localeCompare(right.name),
  );
  const candidates = gaps.data?.candidates ?? [];
  const runs = [...(goalRuns.data?.runs ?? [])].reverse();

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Capability System
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          Capability Registry
        </h1>
        <p className="mt-1 text-muted-foreground">
          Current, persistent evidence of what Forge can safely execute.
        </p>
      </div>

      <section className="border-y border-border/70 py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Autonome doelrun
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Eén approval, drie doelen, maximaal twee capability-reparaties en twee niveaus diep.
            </p>
          </div>
          <Button
            type="button"
            disabled={startGoalRun.isPending || candidates.length === 0}
            onClick={() => startGoalRun.mutate({
              allowedDirectories: ["lib/", "artifacts/"],
              maximumGoals: 3,
              maximumCapabilityImprovements: 2,
              maximumImprovementDepth: 2,
              maximumDurationMs: 3_600_000,
              maximumCostUsd: 5,
            })}
          >
            <Play className="h-4 w-4" />
            Run-mandaat aanvragen
          </Button>
        </div>

        {runs.length > 0 && (
          <div className="mt-4 divide-y divide-border/70 border-y border-border/70">
            {runs.slice(0, 5).map(({ mission, report }) => (
              <div key={mission.id} className="grid gap-3 py-4 lg:grid-cols-[12rem_1fr_auto] lg:items-start">
                <div>
                  <Badge variant={mission.status === "failed" ? "destructive" : "outline"}>
                    {mission.status}
                  </Badge>
                  <div className="mt-2 font-mono text-xs text-muted-foreground">
                    {mission.id.slice(0, 8)}
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  {(report?.goals ?? []).map((goal) => (
                    <div key={goal.goalMissionId} className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{goal.capabilityId}</span>
                        <Badge variant="secondary">{goal.status}</Badge>
                        <span className="text-muted-foreground">{goal.cause}</span>
                        {goal.gapResolved && <Badge>gap weg</Badge>}
                      </div>
                      {goal.repairChain.map((repair) => (
                        <div key={repair.missionId} className="font-mono text-xs text-muted-foreground">
                          repair {repair.depth}: {repair.capabilityId} · {repair.status}
                          {repair.failureReason ? ` · ${repair.failureReason}` : ""}
                        </div>
                      ))}
                    </div>
                  ))}
                  {!report && <span className="text-muted-foreground">Wacht op approval</span>}
                </div>
                <div className="text-right text-sm">
                  <div>{report?.resolvedGapIds.length ?? 0} gaps weg</div>
                  <div className="text-muted-foreground">
                    ${(report?.actualEstimatedCostUsd ?? 0).toFixed(4)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Operational", runtime.data?.capabilities.operational ?? 0],
          ["Validated", runtime.data?.capabilities.validated ?? 0],
          ["Experimental", runtime.data?.capabilities.experimental ?? 0],
          ["Total", runtime.data?.capabilities.total ?? 0],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardContent className="pt-6">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {label}
              </div>
              <div className="mt-2 text-3xl font-bold">
                {value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <section className="border-y border-border/70 py-5">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Wat mist Forge
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Gerangschikt op terugkerende oorzaken in echte missie-evidence.
            </p>
          </div>
          <Badge variant="outline">{candidates.length} kandidaten</Badge>
        </div>

        {gaps.isError ? (
          <div className="border-l-2 border-destructive px-4 py-3 text-sm text-destructive">
            {gaps.error instanceof Error ? gaps.error.message : "Gapregister niet beschikbaar"}
          </div>
        ) : candidates.length === 0 ? (
          <div className="border-l-2 border-border px-4 py-3 text-sm text-muted-foreground">
            Geen outcome-gaps geregistreerd.
          </div>
        ) : (
          <div className="divide-y divide-border/70 border-y border-border/70">
            {candidates.map((candidate, index) => (
              <div key={candidate.id} className="grid gap-4 py-4 lg:grid-cols-[3rem_1fr_auto] lg:items-center">
                <div className="font-mono text-2xl font-semibold text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{candidate.capabilityName}</span>
                    <Badge variant="secondary">{candidate.occurrences} keer</Badge>
                    {candidate.releasedGoalSpecMissionId && (
                      <Badge>GoalSpec vrijgegeven</Badge>
                    )}
                  </div>
                  <div className="mt-1 font-mono text-xs text-amber-600 dark:text-amber-400">
                    {candidate.cause}
                  </div>
                  <div className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
                    <Target className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{candidate.proposedGoalSpec.objective}</span>
                  </div>
                  <div className="mt-2 font-mono text-[11px] text-muted-foreground">
                    {candidate.missionIds.slice(-5).map((id) => id.slice(0, 8)).join(" · ")}
                    {candidate.missionIds.length > 5 && ` · +${candidate.missionIds.length - 5}`}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={candidate.releasedGoalSpecMissionId ? "outline" : "default"}
                  disabled={Boolean(candidate.releasedGoalSpecMissionId) || releaseGap.isPending}
                  onClick={() => releaseGap.mutate(candidate.id)}
                >
                  <Target className="h-4 w-4" />
                  {candidate.releasedGoalSpecMissionId ? "Vrijgegeven" : "GoalSpec vrijgeven"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Boxes className="h-5 w-5 text-primary" />
            Registered capabilities
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 lg:grid-cols-2">
            {records.map((capability) => (
              <div
                key={capability.id}
                className="rounded-md border border-border/60 bg-background/40 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">
                      {capability.name}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                      {capability.id}
                    </div>
                  </div>
                  <Badge
                    variant={
                      capability.status === "operational"
                        ? "default"
                        : capability.status === "experimental"
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {capability.status}
                  </Badge>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  {capability.description}
                </p>
                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Confidence {Math.round(capability.confidence * 100)}%</span>
                  <span>{capability.source}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}