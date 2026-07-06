import { useGetDashboardSummary, useListApprovals, useListTasks } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActivitySquare, AlertOctagon, CheckSquare, ShieldAlert, Package, TrendingUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: approvals, isLoading: isLoadingApprovals } = useListApprovals({ status: 'pending' });
  const { data: blockedTasks, isLoading: isLoadingBlocked } = useListTasks({ status: 'blocked' });

  if (isLoadingSummary || isLoadingApprovals || isLoadingBlocked) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">System Overview</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight uppercase">Mission Control</h1>
          <p className="text-muted-foreground">Autonomous Factory Status</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={summary.failedTests > 0 ? "destructive" : "default"} className="px-3 py-1">
            {summary.failedTests > 0 ? "TESTS FAILING" : "SYSTEM NOMINAL"}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card/50 border-primary/20 hover:border-primary/50 transition-colors">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
              Pending Approvals
              <ShieldAlert className="h-4 w-4 text-primary" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-foreground">{summary.pendingApprovals}</div>
            <p className="text-xs text-muted-foreground mt-1">Require owner decision</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-destructive/20 hover:border-destructive/50 transition-colors">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
              Blocked Tasks
              <AlertOctagon className="h-4 w-4 text-destructive" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-foreground">{summary.blockedTasks}</div>
            <p className="text-xs text-muted-foreground mt-1">Execution halted</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
              Active Modules
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-foreground">{summary.activeModules}</div>
            <p className="text-xs text-muted-foreground mt-1">Out of {summary.modules} total</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
              Improvements
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-foreground">{summary.improvements}</div>
            <p className="text-xs text-muted-foreground mt-1">Self-optimization backlog</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="flex justify-between">
              <span className="text-lg">Action Required: Approvals</span>
              <Link href="/approvals" className="text-sm font-normal text-primary hover:underline">View All</Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {approvals?.length === 0 ? (
              <div className="text-sm text-muted-foreground italic py-4 text-center">No pending approvals.</div>
            ) : (
              <div className="space-y-3">
                {approvals?.slice(0, 5).map(approval => (
                  <div key={approval.id} className="flex items-center justify-between p-3 rounded-md border border-border/50 bg-background/50">
                    <div>
                      <div className="font-medium text-sm">{approval.moduleName || `Module #${approval.moduleId}`}</div>
                      <div className="text-xs text-muted-foreground">Level: {approval.level}</div>
                    </div>
                    <Badge variant="outline" className="border-primary/50 text-primary uppercase text-[10px]">
                      {approval.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="flex justify-between">
              <span className="text-lg">System Blockades</span>
              <Link href="/tasks" className="text-sm font-normal text-primary hover:underline">View Tasks</Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {blockedTasks?.length === 0 ? (
              <div className="text-sm text-muted-foreground italic py-4 text-center">No blocked tasks.</div>
            ) : (
              <div className="space-y-3">
                {blockedTasks?.slice(0, 5).map(task => (
                  <div key={task.id} className="flex flex-col gap-1 p-3 rounded-md border border-destructive/20 bg-destructive/5">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-sm text-destructive-foreground">{task.title}</div>
                      <Badge variant="destructive" className="uppercase text-[10px]">{task.status}</Badge>
                    </div>
                    {task.blockedReason && (
                      <div className="text-xs text-destructive/80 mt-1 line-clamp-2">
                        {task.blockedReason}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">Recent Audit Logs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {summary.recentAuditLogs?.slice(0, 8).map(log => (
              <div key={log.id} className="flex items-center gap-4 text-sm font-mono p-2 border-b border-border/20 last:border-0 hover:bg-muted/50 transition-colors">
                <div className="w-32 text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis">
                  {new Date(log.createdAt).toLocaleString(undefined, {
                    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
                  })}
                </div>
                <div className={`w-20 font-bold ${log.outcome === 'allowed' ? 'text-emerald-500' : 'text-destructive'}`}>
                  {log.outcome.toUpperCase()}
                </div>
                <div className="w-32 text-primary">{log.actor}</div>
                <div className="flex-1 truncate">
                  {log.action} <span className="text-muted-foreground">on</span> {log.targetType} {log.targetId ? `(${log.targetId})` : ''}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
