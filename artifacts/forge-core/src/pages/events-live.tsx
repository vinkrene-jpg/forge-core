import { Radio } from "lucide-react";
import { useRuntimeQuery } from "@/hooks/use-forge-live";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Events() {
  const runtime = useRuntimeQuery();
  const events = [...(runtime.data?.events ?? [])].reverse();

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Runtime Event Bus
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          Live Event History
        </h1>
        <p className="mt-1 text-muted-foreground">
          Bounded event history emitted by the authoritative Forge runtime.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Radio className="h-5 w-5 text-primary" />
            Events ({events.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {events.map((event) => (
              <div
                key={event.sequence}
                className="rounded-md border border-border/50 bg-background/40 p-3 font-mono text-xs"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant="outline">
                    #{event.sequence}
                  </Badge>
                  <span className="font-semibold text-primary">
                    {event.type}
                  </span>
                  <span className="ml-auto text-muted-foreground">
                    {new Date(event.occurredAt).toLocaleString()}
                  </span>
                </div>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-muted-foreground">
                  {JSON.stringify(event.payload, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}