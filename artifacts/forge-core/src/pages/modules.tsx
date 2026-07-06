import { useListModules } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, ShieldAlert } from "lucide-react";

export default function Modules() {
  const { data: modules, isLoading } = useListModules();

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
