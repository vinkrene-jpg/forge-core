import {
  Bot,
  CheckCircle2,
  CircleOff,
  Play,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  useAiExecutions,
  useAiGatewayStatus,
  useExecuteComposition,
} from "@/hooks/use-ai-gateway-live";
import { usePromptCompositions } from "@/hooks/use-operator-core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function AiGateway() {
  const gateway = useAiGatewayStatus();
  const executions = useAiExecutions();
  const compositions =
    usePromptCompositions("forge-core");
  const execute = useExecuteComposition();

  const latestComposition =
    compositions.data?.compositions.at(-1) ??
    null;
  const records = [
    ...(executions.data?.executions ?? []),
  ].reverse();
  const status = gateway.data?.status;
  const summary = gateway.data?.summary;

  const error =
    execute.error instanceof Error
      ? execute.error.message
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Provider-independent AI Gateway
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Controlled Model Execution
          </h1>
          <p className="mt-1 text-muted-foreground">
            Route grounded compositions through a configured provider without storing credentials in Git.
          </p>
        </div>
        <Badge
          variant={
            status?.configured
              ? "default"
              : "secondary"
          }
        >
          {status?.configured
            ? "PROVIDER READY"
            : "PROVIDER UNBOUND"}
        </Badge>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          [
            "Provider",
            status?.providerId ?? "none",
          ],
          [
            "Model",
            status?.model ?? "not configured",
          ],
          [
            "Succeeded",
            String(summary?.succeeded ?? 0),
          ],
          [
            "Unavailable / failed",
            `${summary?.unavailable ?? 0} / ${summary?.failed ?? 0}`,
          ],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent className="pt-6">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {label}
              </div>
              <div className="mt-2 truncate text-xl font-bold">
                {value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card
        className={
          status?.configured
            ? "border-primary/30"
            : "border-amber-500/40"
        }
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            {status?.configured ? (
              <ShieldCheck className="h-5 w-5 text-emerald-500" />
            ) : (
              <CircleOff className="h-5 w-5 text-amber-500" />
            )}
            Provider status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {status?.note}
          </p>
          <div className="grid gap-2 font-mono text-xs text-muted-foreground md:grid-cols-2">
            <div>
              Secret configured:{" "}
              {status?.secretConfigured
                ? "yes"
                : "no"}
            </div>
            <div>
              API base:{" "}
              {status?.apiBase ?? "none"}
            </div>
            <div>
              Max input:{" "}
              {status?.maxInputChars ?? 0} chars
            </div>
            <div>
              Max output:{" "}
              {status?.maxOutputTokens ?? 0} tokens
            </div>
          </div>

          <div className="rounded-md border border-border/50 bg-background/50 p-3 text-xs text-muted-foreground">
            Configure locally in <code>.env</code>:
            <pre className="mt-2 whitespace-pre-wrap">
FORGE_AI_PROVIDER=openai-responses
OPENAI_API_KEY=...
OPENAI_MODEL=...
            </pre>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-4 text-lg">
            <span className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              Latest grounded composition
            </span>
            <Button
              disabled={
                !latestComposition ||
                !status?.configured ||
                execute.isPending
              }
              onClick={() => {
                if (latestComposition) {
                  execute.mutate(
                    latestComposition.id,
                  );
                }
              }}
            >
              <Play className="mr-2 h-4 w-4" />
              Execute
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {latestComposition ? (
            <div>
              <div className="font-medium">
                {latestComposition.objective}
              </div>
              <div className="mt-2 font-mono text-xs text-muted-foreground">
                Composition {latestComposition.id} Â·
                route{" "}
                {
                  latestComposition.route
                    .selectedProfile.id
                }
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Compose a prompt in Operator Core first.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Execution history
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {records.map((execution) => (
              <div
                key={execution.id}
                className="rounded-md border border-border/60 bg-background/40 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-xs">
                      {execution.id}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {execution.providerId ?? "no provider"} Â·
                      {" "}
                      {execution.model ?? "no model"} Â·
                      route {execution.routeProfileId}
                    </div>
                  </div>
                  <Badge
                    variant={
                      execution.status === "succeeded"
                        ? "default"
                        : execution.status === "failed"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {execution.status}
                  </Badge>
                </div>

                {execution.outputText ? (
                  <div className="mt-4 rounded-md border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm">
                    <div className="mb-2 flex items-center gap-2 font-medium text-emerald-500">
                      <CheckCircle2 className="h-4 w-4" />
                      Provider output
                    </div>
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-muted-foreground">
                      {execution.outputText}
                    </pre>
                  </div>
                ) : null}

                {execution.error ? (
                  <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-400">
                    <XCircle className="mt-0.5 h-4 w-4 flex-none" />
                    {execution.error}
                  </div>
                ) : null}
              </div>
            ))}

            {!executions.isLoading &&
            records.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No provider executions recorded.
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}