import {
  CheckCircle2,
  Play,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import {
  useApproveEvolutionPlan,
  useEvolutionPlansQuery,
  useExecuteEvolutionPlan,
} from "@/hooks/use-forge-live";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Evolution() {
  const plans = useEvolutionPlansQuery();
  const approve = useApproveEvolutionPlan();
  const execute = useExecuteEvolutionPlan();

  const records = [...(plans.data?.plans ?? [])].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
  );

  const busy = approve.isPending || execute.isPending;
  const error =
    approve.error instanceof Error
      ? approve.error.message
      : execute.error instanceof Error
        ? execute.error.message
        : null;

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Evolution Engine
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          Controlled Capability Evolution
        </h1>
        <p className="mt-1 text-muted-foreground">
          Improvement plans require approval and concrete verification before capability promotion.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="space-y-4">
        {records.map((plan) => (
          <Card key={plan.id}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-lg">
                    {plan.objective}
                  </CardTitle>
                  <div className="mt-2 font-mono text-xs text-muted-foreground">
                    {plan.id} Â· ROI {plan.roiScore}
                  </div>
                </div>
                <Badge
                  variant={
                    plan.status === "completed"
                      ? "default"
                      : plan.status === "cancelled"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {plan.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {plan.steps.map((step) => (
                  <div
                    key={`${plan.id}-${step.order}`}
                    className="rounded-md border border-border/60 bg-background/40 p-3"
                  >
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <TrendingUp className="h-4 w-4 text-primary" />
                      {step.order}. {step.capabilityId}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {step.action}: {step.fromStatus ?? "missing"} â†’ {step.toStatus}
                    </div>
                  </div>
                ))}
              </div>

              {plan.lastError ? (
                <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {plan.lastError}
                </div>
              ) : null}

              {plan.evidence.length > 0 ? (
                <div className="mt-4 space-y-2">
                  {plan.evidence.map((evidence) => (
                    <div
                      key={`${plan.id}-${evidence.verifierId}`}
                      className="flex items-center gap-2 text-sm text-emerald-500"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {evidence.verifierId}
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                {plan.status === "proposed" ? (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      approve.mutate({
                        planId: plan.id,
                        actor: "forge-desktop-owner",
                      })
                    }
                  >
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    Approve plan
                  </Button>
                ) : null}

                {plan.status === "approved" ? (
                  <Button
                    disabled={busy}
                    onClick={() => execute.mutate(plan.id)}
                  >
                    <Play className="mr-2 h-4 w-4" />
                    Execute verified evolution
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}

        {!plans.isLoading && records.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No evolution plans recorded.
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}