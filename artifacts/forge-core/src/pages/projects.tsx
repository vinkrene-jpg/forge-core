import { Activity, CheckCircle2, CircleOff, Clock3, FolderGit2, Play, Square, XCircle } from "lucide-react";
import { useProductAction, useProducts } from "@/hooks/use-operator-core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function dateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Nog niet bekend";
}

export default function Projects() {
  const products = useProducts();
  const action = useProductAction();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/60 pb-5">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase text-primary">Forge Control</div>
          <h1 className="text-3xl font-bold">Productregister</h1>
        </div>
        <Badge variant="outline">{products.data?.products.length ?? 0} producten</Badge>
      </div>

      {action.error instanceof Error ? (
        <div className="border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{action.error.message}</div>
      ) : null}
      {products.error instanceof Error ? (
        <div className="border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{products.error.message}</div>
      ) : null}

      {products.isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((item) => <Skeleton key={item} className="h-40 w-full" />)}</div>
      ) : (
        <div className="divide-y divide-border/60 border-y border-border/60">
          {(products.data?.products ?? []).map((entry) => {
            const verification = entry.lastVerification;
            return (
              <section key={entry.product.id} className="grid gap-5 py-5 lg:grid-cols-[minmax(240px,1.2fr)_minmax(420px,2fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">{entry.product.name}</h2>
                    <Badge variant={entry.running ? "default" : "secondary"}>{entry.running ? "Draait" : "Gestopt"}</Badge>
                    <Badge variant="outline">{entry.product.origin === "forge-built" ? "Door Forge gebouwd" : "Ingebracht"}</Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-2 truncate font-mono text-xs text-muted-foreground">
                    <FolderGit2 className="h-4 w-4 shrink-0" />{entry.product.rootPath}
                  </div>
                  <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{entry.product.goal}</p>
                </div>

                <div className="grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Laatste wijziging</div>
                    <div className="mt-1 flex items-center gap-2"><Clock3 className="h-4 w-4" />{dateTime(entry.lastChangedAt)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Laatste verificatie</div>
                    <div className="mt-1 flex items-center gap-2">
                      {verification?.status === "passed" ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : verification ? <XCircle className="h-4 w-4 text-destructive" /> : <CircleOff className="h-4 w-4" />}
                      {verification ? `${verification.status === "passed" ? "Geslaagd" : "Mislukt"} · ${dateTime(verification.verifiedAt)}` : "Nog niet uitgevoerd"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Forge bouwt nu</div>
                    <div className="mt-1 flex items-center gap-2"><Activity className="h-4 w-4" />{entry.currentWork?.title ?? "Geen actief werk"}</div>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button aria-label={`${entry.product.name} starten`} size="icon" variant="outline" disabled={!entry.canStart || action.isPending} onClick={() => action.mutate({ projectId: entry.product.id, action: "start" })}>
                        <Play className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Product starten</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button aria-label={`${entry.product.name} stoppen`} size="icon" variant="outline" disabled={!entry.canStop || action.isPending} onClick={() => action.mutate({ projectId: entry.product.id, action: "stop" })}>
                        <Square className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Product stoppen</TooltipContent>
                  </Tooltip>
                </div>
              </section>
            );
          })}
          {products.data?.products.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Geen producten geregistreerd.</div>
          ) : null}
        </div>
      )}
    </div>
  );
}
