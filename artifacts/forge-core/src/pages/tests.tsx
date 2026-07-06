import { useState } from "react";
import {
  useListTestRuns,
  useGetTestRun,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FlaskConical, ChevronDown, ChevronRight, Terminal } from "lucide-react";

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "passed" ? "default" : status === "failed" ? "destructive" : "secondary";
  return (
    <Badge variant={variant} className="uppercase text-[10px]">
      {status}
    </Badge>
  );
}

function StepDetails({ runId }: { runId: number }) {
  const { data, isLoading } = useGetTestRun(runId);

  if (isLoading) return <Skeleton className="h-24 mt-3" />;
  if (!data || data.steps.length === 0) {
    return (
      <p className="text-xs text-muted-foreground mt-3">
        No execution steps recorded (static analysis run).
      </p>
    );
  }
  return (
    <div className="mt-3 space-y-2">
      {data.steps.map((step) => (
        <div key={step.id} className="border border-border/50 rounded-md p-3 bg-background/40">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-primary" />
              <span className="text-sm font-medium uppercase">{step.step}</span>
              <StatusBadge status={step.status} />
            </div>
            <span className="text-[11px] font-mono text-muted-foreground">
              exit {step.exitCode ?? "n/a"} · {step.durationMs}ms
            </span>
          </div>
          <div className="text-[11px] font-mono text-muted-foreground mt-1 break-all">
            $ {step.command}
          </div>
          {step.stdout && (
            <pre className="mt-2 text-[11px] font-mono bg-muted/40 rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">
              {step.stdout}
            </pre>
          )}
          {step.stderr && (
            <pre className="mt-2 text-[11px] font-mono text-destructive/90 bg-destructive/5 rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">
              {step.stderr}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

export default function Tests() {
  const { data: runs, isLoading } = useListTestRuns();
  const [expanded, setExpanded] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Test Runs</h1>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight uppercase">Test Runs</h1>
        <p className="text-muted-foreground">
          Static analysis and real code execution results
        </p>
      </div>

      <div className="space-y-3">
        {runs?.map((run) => {
          const isOpen = expanded === run.id;
          return (
            <Card
              key={run.id}
              className="border-border/50 bg-card/50 hover:border-primary/40 transition-colors"
            >
              <CardHeader
                className="pb-2 cursor-pointer select-none"
                onClick={() => setExpanded(isOpen ? null : run.id)}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-base font-medium flex items-center gap-2">
                    {isOpen ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    )}
                    <FlaskConical className="w-4 h-4 text-primary" />
                    Run #{run.id}
                    {run.moduleId != null && (
                      <span className="text-xs text-muted-foreground font-normal">
                        module {run.moduleId}
                        {run.moduleVersion ? ` v${run.moduleVersion}` : ""}
                      </span>
                    )}
                    {run.sandboxId != null && (
                      <span className="text-xs text-muted-foreground font-normal">
                        sandbox {run.sandboxId}
                      </span>
                    )}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={run.mode === "real" ? "default" : "outline"}
                      className="uppercase text-[10px]"
                    >
                      {run.mode === "real" ? "Real Execution" : "Static"}
                    </Badge>
                    <StatusBadge status={run.status} />
                  </div>
                </div>
                <div className="text-xs font-mono text-muted-foreground mt-1 flex gap-2 flex-wrap">
                  <span>{(run.types ?? []).join(", ")}</span>
                  <span>•</span>
                  <span>
                    {run.passed ?? 0} passed / {run.failed ?? 0} failed
                  </span>
                  {run.durationMs != null && (
                    <>
                      <span>•</span>
                      <span>{run.durationMs}ms</span>
                    </>
                  )}
                  <span>•</span>
                  <span>{new Date(run.createdAt).toLocaleString()}</span>
                </div>
              </CardHeader>
              {isOpen && (
                <CardContent>
                  <StepDetails runId={run.id} />
                </CardContent>
              )}
            </Card>
          );
        })}
        {runs?.length === 0 && (
          <div className="p-12 text-center border border-dashed rounded-lg border-border text-muted-foreground">
            No test runs yet.
          </div>
        )}
      </div>
    </div>
  );
}
