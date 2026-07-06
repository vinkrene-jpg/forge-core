import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListModules,
  useRunAiGuardianReview,
  getListGuardianReviewsQueryKey,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, ShieldAlert, Sparkles, Loader2 } from "lucide-react";

export default function Modules() {
  const { data: modules, isLoading } = useListModules();
  const queryClient = useQueryClient();
  const aiReview = useRunAiGuardianReview();
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [reviewResult, setReviewResult] = useState<{
    moduleId: number;
    outcome: string;
    summary: string | null;
    model: string | null;
    findingCount: number;
    error?: string;
  } | null>(null);

  const runAiReview = (moduleId: number) => {
    setReviewingId(moduleId);
    setReviewResult(null);
    aiReview.mutate(
      { id: moduleId },
      {
        onSuccess: (review) => {
          setReviewResult({
            moduleId,
            outcome: review.outcome,
            summary: review.summary ?? null,
            model: review.model ?? null,
            findingCount: review.findings.length,
          });
          queryClient.invalidateQueries({ queryKey: getListGuardianReviewsQueryKey() });
        },
        onError: (err) => {
          setReviewResult({
            moduleId,
            outcome: "error",
            summary: null,
            model: null,
            findingCount: 0,
            error: err instanceof Error ? err.message : "AI review failed",
          });
        },
        onSettled: () => setReviewingId(null),
      },
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Modules</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight uppercase">Module Registry</h1>
          <p className="text-muted-foreground">Generated code units</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {modules?.map(mod => (
          <Card key={mod.id} className="border-border/50 bg-card/50 hover:border-primary/40 transition-colors">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <Package className="w-4 h-4 text-primary" />
                  {mod.name}
                </CardTitle>
                <div className="flex gap-2">
                  {mod.touchesCore && (
                    <span title="Touches Core Paths">
                      <ShieldAlert className="w-4 h-4 text-destructive" />
                    </span>
                  )}
                  <Badge variant={mod.active ? "default" : "secondary"} className="uppercase text-[10px]">
                    {mod.active ? "Active" : "Inactive"}
                  </Badge>
                </div>
              </div>
              <div className="text-xs font-mono text-muted-foreground mt-1 flex gap-2">
                <span>v{mod.version}</span>
                <span>•</span>
                <span className="uppercase">{mod.type}</span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2 mt-4">
                <Badge variant="outline" className="text-[10px] uppercase border-border/50">
                  Risk: {mod.riskLevel}
                </Badge>
                <Badge variant="outline" className="text-[10px] uppercase border-border/50">
                  Test: {mod.testStatus}
                </Badge>
                <Badge variant="outline" className="text-[10px] uppercase border-border/50">
                  Inst: {mod.installStatus}
                </Badge>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-4 w-full"
                disabled={reviewingId === mod.id}
                onClick={() => runAiReview(mod.id)}
              >
                {reviewingId === mod.id ? (
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5 mr-2" />
                )}
                AI Guardian Review
              </Button>
              {reviewResult?.moduleId === mod.id && (
                <div className="mt-3 text-xs border border-border/50 rounded-md p-3 bg-background/40 space-y-1">
                  {reviewResult.error ? (
                    <p className="text-destructive">{reviewResult.error}</p>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            reviewResult.outcome === "pass"
                              ? "default"
                              : reviewResult.outcome === "fail"
                                ? "destructive"
                                : "secondary"
                          }
                          className="uppercase text-[10px]"
                        >
                          {reviewResult.outcome}
                        </Badge>
                        <span className="text-muted-foreground">
                          {reviewResult.findingCount} findings
                          {reviewResult.model ? ` · ${reviewResult.model}` : ""}
                        </span>
                      </div>
                      {reviewResult.summary && (
                        <p className="text-muted-foreground">{reviewResult.summary}</p>
                      )}
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {modules?.length === 0 && (
          <div className="col-span-full p-12 text-center border border-dashed rounded-lg border-border text-muted-foreground">
            No modules generated yet.
          </div>
        )}
      </div>
    </div>
  );
}
