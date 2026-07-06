import { useListTasks } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function Tasks() {
  const { data: tasks, isLoading } = useListTasks();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight uppercase">Task Queue</h1>
          <p className="text-muted-foreground">Autonomous agent backlog</p>
        </div>
      </div>

      <div className="space-y-3">
        {tasks?.map(task => (
          <Card key={task.id} className="border-border/50 bg-card/30 hover:bg-card/80 transition-colors rounded-md overflow-hidden">
            <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-mono text-xs text-muted-foreground">TSK-{task.id.toString().padStart(4, '0')}</span>
                  <h3 className="font-medium">{task.title}</h3>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <Badge variant="outline" className="text-xs text-muted-foreground border-border/50 bg-transparent">
                    {task.ownerAgent}
                  </Badge>
                  {task.risk && (
                    <Badge variant="secondary" className="text-[10px] uppercase">
                      Risk: {task.risk}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {task.status === 'blocked' && task.blockedReason && (
                  <div className="text-xs text-destructive max-w-xs truncate hidden lg:block" title={task.blockedReason}>
                    {task.blockedReason}
                  </div>
                )}
                <Badge 
                  variant={task.status === 'blocked' ? 'destructive' : task.status === 'done' ? 'default' : 'outline'}
                  className={`uppercase text-[10px] w-24 justify-center ${task.status === 'active' ? 'bg-primary/20 text-primary border-primary/50' : ''}`}
                >
                  {task.status}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
        {tasks?.length === 0 && (
          <div className="p-12 text-center border border-dashed rounded-lg border-border text-muted-foreground">
            No tasks in queue.
          </div>
        )}
      </div>
    </div>
  );
}
