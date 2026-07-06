import { useListCoreComponents, useUpdateCoreComponent, getListAuditLogsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Lock, Unlock, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";

export default function CoreComponents() {
  const { data: components, isLoading } = useListCoreComponents();
  const updateComponent = useUpdateCoreComponent();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleTestEdit = (id: number, locked: boolean) => {
    updateComponent.mutate({
      id,
      data: { description: "Attempted edit test" }
    }, {
      onSuccess: () => {
        toast({
          title: "Update Successful",
          description: "Core component was successfully updated.",
        });
      },
      onError: (err: any) => {
        toast({
          title: "Core Protection Triggered",
          description: err.data?.error || "Cannot modify locked core components.",
          variant: "destructive",
        });
        queryClient.invalidateQueries({ queryKey: getListAuditLogsQueryKey() });
      }
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Locked Core Registry</h1>
          <p className="text-muted-foreground">Immutable foundational systems</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight uppercase text-primary">Locked Core Registry</h1>
          <p className="text-muted-foreground">Foundational subsystems protected from autonomous mutation</p>
        </div>
        <Badge variant="outline" className="border-primary/50 text-primary gap-2 py-1 px-3">
          <Lock className="w-3 h-3" />
          SYSTEM INTEGRITY ENFORCED
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {components?.map(comp => (
          <Card key={comp.id} className={`border ${comp.locked ? 'border-primary/20 bg-card/50' : 'border-destructive/30 bg-destructive/5'}`}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <CardTitle className="text-lg font-mono tracking-tight">{comp.name}</CardTitle>
                <Badge variant={comp.locked ? "default" : "destructive"} className={comp.locked ? "bg-primary/20 text-primary hover:bg-primary/30" : ""}>
                  {comp.locked ? <Lock className="w-3 h-3 mr-1" /> : <Unlock className="w-3 h-3 mr-1" />}
                  {comp.locked ? "LOCKED" : "UNLOCKED"}
                </Badge>
              </div>
              <CardDescription className="font-mono text-xs">{comp.key} • v{comp.version}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground min-h-[40px]">
                {comp.description || "No description provided."}
              </p>
              
              <div className="pt-4 border-t border-border/50">
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full text-xs gap-2"
                  onClick={() => handleTestEdit(comp.id, comp.locked)}
                  disabled={updateComponent.isPending}
                >
                  <AlertTriangle className="w-3 h-3" />
                  Test Protection
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
