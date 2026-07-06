import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import NotFound from "@/pages/not-found";
import Projects from "@/pages/projects";
import Tasks from "@/pages/tasks";
import Modules from "@/pages/modules";
import Sandboxes from "@/pages/sandboxes";
import Tests from "@/pages/tests";
import Approvals from "@/pages/approvals";
import AiGateway from "@/pages/ai-gateway";
import Memory from "@/pages/memory";
import Improvements from "@/pages/improvements";
import DailyLoop from "@/pages/daily-loop";
import CoreComponents from "@/pages/core-components";
import AuditLogs from "@/pages/audit-logs";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/projects" component={Projects} />
        <Route path="/tasks" component={Tasks} />
        <Route path="/modules" component={Modules} />
        <Route path="/sandboxes" component={Sandboxes} />
        <Route path="/tests" component={Tests} />
        <Route path="/approvals" component={Approvals} />
        <Route path="/ai-gateway" component={AiGateway} />
        <Route path="/memory" component={Memory} />
        <Route path="/improvements" component={Improvements} />
        <Route path="/daily-loop" component={DailyLoop} />
        <Route path="/core" component={CoreComponents} />
        <Route path="/audit" component={AuditLogs} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
