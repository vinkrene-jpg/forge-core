import { Boxes } from "lucide-react";
import {
  useCapabilitiesQuery,
  useRuntimeQuery,
} from "@/hooks/use-forge-live";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Capabilities() {
  const capabilities = useCapabilitiesQuery();
  const runtime = useRuntimeQuery();

  const records = [...(capabilities.data?.capabilities ?? [])].sort(
    (left, right) =>
      left.name.localeCompare(right.name),
  );

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