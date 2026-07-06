import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  FolderKanban, 
  CheckSquare, 
  Package, 
  Container, 
  TestTube, 
  ShieldCheck, 
  BrainCircuit, 
  Database, 
  TrendingUp, 
  ActivitySquare, 
  Lock, 
  ClipboardList 
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/modules", label: "Modules", icon: Package },
  { href: "/sandboxes", label: "Sandboxes", icon: Container },
  { href: "/tests", label: "Test Runs", icon: TestTube },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/ai-gateway", label: "AI Gateway", icon: BrainCircuit },
  { href: "/memory", label: "Memory Engine", icon: Database },
  { href: "/improvements", label: "Improvements", icon: TrendingUp },
  { href: "/daily-loop", label: "Daily Loop", icon: ActivitySquare },
  { href: "/core", label: "Locked Core", icon: Lock },
  { href: "/audit", label: "Audit Logs", icon: ClipboardList },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground dark">
      <aside className="w-64 flex-shrink-0 border-r border-border bg-sidebar flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <div className="flex items-center gap-2 text-primary">
            <BrainCircuit className="h-6 w-6" />
            <span className="font-bold tracking-wider uppercase text-sm">Forge Core</span>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${isActive ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}>
                <item.icon className={`h-4 w-4 ${isActive ? "text-primary" : ""}`} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded bg-primary/20 flex items-center justify-center text-primary font-mono text-xs border border-primary/30">
              OW
            </div>
            <div className="text-xs">
              <div className="font-medium text-foreground">Owner</div>
              <div className="text-muted-foreground">Admin Access</div>
            </div>
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-auto flex flex-col relative">
        <div className="absolute inset-0 pointer-events-none opacity-[0.02]" style={{ backgroundImage: "url('data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E')" }}></div>
        <div className="p-8 max-w-7xl mx-auto w-full flex-1 z-10">
          {children}
        </div>
      </main>
    </div>
  );
}
