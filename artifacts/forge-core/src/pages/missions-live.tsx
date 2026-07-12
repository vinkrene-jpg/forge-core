import { Play, ShieldAlert } from "lucide-react";
import {
  useCreateMission,
  useMissionsQuery,
} from "@/hooks/use-forge-live";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function variant(
  status: string,
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "succeeded" || status === "running") {
    return "default";
  }

  if (status === "failed" || status === "cancelled") {
    return "destructive";
  }

  return "secondary";
}

export default function Missions() {
  const missions = useMissionsQuery();
  const createMission = useCreateMission();

  const records = [...(missions.data?.missions ?? [])].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
  );

  const error =
    createMission.error instanceof Error
      ? createMission.error.message
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Mission Engine
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Persistent Mission Queue
          </h1>
          <p className="mt-1 text-muted-foreground">
            Create governed work and follow execution from queue to evidence.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={createMission.isPending}
            onClick={() =>
              createMission.mutate({
                kind: "runtime.self-check",
                title: "Desktop runtime self-check",
                input: {},
              })
            }
          >
            <Play className="mr-2 h-4 w-4" />
            Run self-check
          </Button>
          <Button
            variant="outline"
            disabled={createMission.isPending}
            onClick={() =>
              createMission.mutate({
                kind: "runtime.stability-window",
                title: "Desktop stability window",
                input: {
                  durationMs: 10_000,
                  sampleIntervalMs: 500,
                },
              })
            }
          >
            <ShieldAlert className="mr-2 h-4 w-4" />
            Request stability mission
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Missions ({records.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-3">Mission</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Attempts</th>
                  <th className="px-3 py-3">Interrupted</th>
                  <th className="px-3 py-3">Updated</th>
                </tr>
              </thead>
              <tbody>
                {records.map((mission) => (
                  <tr
                    key={mission.id}
                    className="border-b border-border/40 last:border-0"
                  >
                    <td className="px-3 py-4">
                      <div className="font-medium">
                        {mission.title}
                      </div>
                      <div className="mt-1 font-mono text-xs text-muted-foreground">
                        {mission.kind} Â· {mission.id.slice(0, 8)}
                      </div>
                      {mission.lastError ? (
                        <div className="mt-2 text-xs text-destructive">
                          {mission.lastError}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-4">
                      <Badge variant={variant(mission.status)}>
                        {mission.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-4 font-mono">
                      {mission.attempts}
                    </td>
                    <td className="px-3 py-4 font-mono">
                      {mission.interruptedCount}
                    </td>
                    <td className="px-3 py-4 text-muted-foreground">
                      {new Date(mission.updatedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!missions.isLoading && records.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No missions recorded.
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}