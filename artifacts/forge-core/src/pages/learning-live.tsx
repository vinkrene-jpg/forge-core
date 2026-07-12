import { BrainCircuit, CheckCircle2, Play, Target } from "lucide-react";
import {
  useLearningQuery,
  useScheduleLearningProposal,
} from "@/hooks/use-forge-live";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Learning() {
  const learning = useLearningQuery();
  const schedule = useScheduleLearningProposal();
  const data = learning.data;
  const profiles = [...(data?.profiles ?? [])].sort(
    (left, right) =>
      left.score - right.score ||
      left.capabilityId.localeCompare(right.capabilityId),
  );
  const proposals = [...(data?.proposals ?? [])].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
  const error =
    learning.error instanceof Error
      ? learning.error.message
      : schedule.error instanceof Error
        ? schedule.error.message
        : null;

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Learning Engine
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          Evidence-backed capability learning
        </h1>
        <p className="mt-1 text-muted-foreground">
          Deterministic scores, traceable evidence and governed next-mission
          proposals.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Observations", data?.summary.observations ?? 0],
          ["Profiles", data?.summary.profiles ?? 0],
          ["Open proposals", data?.summary.proposed ?? 0],
          ["Completed", data?.summary.completed ?? 0],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardContent className="pt-6">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {label}
              </div>
              <div className="mt-2 text-3xl font-bold">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Target className="h-5 w-5 text-primary" />
            Adaptive next missions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {proposals.map((proposal) => (
            <div
              key={proposal.id}
              className="rounded-md border border-border/60 bg-background/40 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium">
                    {proposal.targetCapabilityId}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {proposal.reason}
                  </p>
                </div>
                <Badge
                  variant={
                    proposal.status === "completed"
                      ? "default"
                      : proposal.status === "failed"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {proposal.status}
                </Badge>
              </div>
              {proposal.status === "proposed" ? (
                <Button
                  className="mt-4"
                  disabled={schedule.isPending}
                  onClick={() => schedule.mutate(proposal.id)}
                >
                  <Play className="mr-2 h-4 w-4" />
                  Submit through governance
                </Button>
              ) : proposal.status === "scheduled" ? (
                <div className="mt-3 flex items-center gap-2 text-sm text-amber-500">
                  <Play className="h-4 w-4" />
                  Awaiting or executing mission {proposal.scheduledMissionId}
                </div>
              ) : proposal.status === "completed" ? (
                <div className="mt-3 flex items-center gap-2 text-sm text-emerald-500">
                  <CheckCircle2 className="h-4 w-4" />
                  Evidence {proposal.resultObservationId}
                </div>
              ) : (
                <div className="mt-3 text-sm text-destructive">
                  Failed evidence {proposal.resultObservationId}
                </div>
              )}
            </div>
          ))}
          {!learning.isLoading && proposals.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              A verified autonomous cycle will create the first proposal.
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BrainCircuit className="h-5 w-5 text-primary" />
            Transparent capability profile
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 lg:grid-cols-2">
            {profiles.map((profile) => (
              <div
                key={profile.capabilityId}
                className="rounded-md border border-border/60 bg-background/40 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-mono text-sm">
                    {profile.capabilityId}
                  </div>
                  <Badge
                    variant={profile.score >= 70 ? "default" : "secondary"}
                  >
                    {profile.score}/100
                  </Badge>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  {profile.rationale}
                </p>
                <div className="mt-3 text-xs text-muted-foreground">
                  {profile.observations} observations -{" "}
                  {Math.round(profile.confidence * 100)}% confidence
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Target className="h-5 w-5 text-primary" />
            Experimental capability matrix
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-3">
          {(data?.matrix ?? []).map((entry) => (
            <div
              key={entry.capabilityId}
              className="rounded-md border border-border/60 bg-background/40 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{entry.name}</div>
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {entry.capabilityId}
                  </div>
                </div>
                <Badge variant="secondary">{entry.maturity}</Badge>
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                {entry.exerciseTypes.join(", ")}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Authority: none - dependencies {entry.dependencies.length}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
