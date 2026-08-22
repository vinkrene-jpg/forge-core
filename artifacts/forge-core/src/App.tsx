import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  Route,
  Router as WouterRouter,
  Switch,
} from "wouter";
import { Layout } from "@/components/layout";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import Dashboard from "@/pages/dashboard";
import MissionConsolePage from "@/pages/mission-console";
import Missions from "@/pages/missions-live";
import Approvals from "@/pages/approvals";
import Capabilities from "@/pages/capabilities-live";
import Evolution from "@/pages/evolution-live";
import Events from "@/pages/events-live";
import OperatorCorePage from "@/pages/operator-core";
import Projects from "@/pages/projects";
import Tasks from "@/pages/tasks";
import Modules from "@/pages/modules";
import Sandboxes from "@/pages/sandboxes";
import Tests from "@/pages/tests";
import AiGateway from "@/pages/ai-gateway";
import Memory from "@/pages/memory";
import DailyLoop from "@/pages/daily-loop";
import CoreComponents from "@/pages/core-components";
import AuditLogs from "@/pages/audit-logs";
import Learning from "@/pages/learning-live";
import AutonomyLive from "@/pages/autonomy-live";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});
const routerBase = import.meta.env?.BASE_URL?.replace(/\/$/, "") ?? "";

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={MissionConsolePage} />
        <Route path="/runtime" component={Dashboard} />
        <Route path="/missions" component={Missions} />
        <Route path="/approvals" component={Approvals} />
        <Route path="/capabilities" component={Capabilities} />
        <Route path="/evolution" component={Evolution} />
        <Route path="/learning" component={Learning} />
        <Route path="/autonomy" component={AutonomyLive} />
        <Route path="/events" component={Events} />
        <Route path="/operator" component={OperatorCorePage} />

        <Route path="/projects" component={Projects} />
        <Route path="/tasks" component={Tasks} />
        <Route path="/modules" component={Modules} />
        <Route path="/sandboxes" component={Sandboxes} />
        <Route path="/tests" component={Tests} />
        <Route path="/ai-gateway" component={AiGateway} />
        <Route path="/memory" component={Memory} />
        <Route path="/improvements" component={Evolution} />
        <Route path="/daily-loop" component={DailyLoop} />
        <Route path="/core" component={CoreComponents} />
        <Route path="/audit" component={AuditLogs} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter
          base={routerBase}
        >
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
