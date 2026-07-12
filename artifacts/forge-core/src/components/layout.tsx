import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  Activity,
  BookOpenCheck,
  Boxes,
  BrainCircuit,
  CheckSquare,
  ClipboardList,
  Container,
  Database,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  Lock,
  Package,
  Radio,
  ShieldCheck,
  TestTube,
  TrendingUp,
} from "lucide-react";
import { useRuntimeQuery } from "@/hooks/use-forge-live";

const LIVE_NAV_ITEMS = [
  { href: "/", label: "Runtime", icon: LayoutDashboard },
  { href: "/missions", label: "Missions", icon: ListChecks },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/capabilities", label: "Capabilities", icon: Boxes },
  { href: "/evolution", label: "Evolution", icon: TrendingUp },
  { href: "/events", label: "Live Events", icon: Radio },
  { href: "/operator", label: "Operator Core", icon: BookOpenCheck },
];

const LEGACY_NAV_ITEMS = [
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/modules", label: "Modules", icon: Package },
  { href: "/sandboxes", label: "Sandboxes", icon: Container },
  { href: "/tests", label: "Test Runs", icon: TestTube },
  { href: "/ai-gateway", label: "AI Gateway", icon: BrainCircuit },
  { href: "/memory", label: "Memory Engine", icon: Database },
  { href: "/daily-loop", label: "Legacy Daily Loop", icon: Activity },
  { href: "/core", label: "Locked Core", icon: Lock },
  { href: "/audit", label: "Audit Logs", icon: ClipboardList },
];

function NavigationGroup({
  label,
  items,
  location,
}: {
  label: string;
  items: typeof LIVE_NAV_ITEMS;
  location: string;
}) {
  return (
    <div className="space-y-1">
      <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      {items.map((item) => {
        const active =
          location === item.href ||
          (item.href !== "/" &&
            location.startsWith(item.href));

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

export function Layout({
  children,
}: {
  children: ReactNode;
}) {
  const [location] = useLocation();
  const runtime = useRuntimeQuery();

  const status =
    runtime.data?.health.status === "ok"
      ? "Live"
      : runtime.isError
        ? "Offline"
        : "Starting";

  const dotClass =
    status === "Live"
      ? "bg-emerald-500"
      : status === "Offline"
        ? "bg-destructive"
        : "bg-amber-500";

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground dark">
      <aside className="flex w-72 flex-shrink-0 flex-col border-r border-border bg-sidebar">
        <div className="flex h-16 items-center border-b border-border px-6">
          <div className="flex items-center gap-2 text-primary">
            <BrainCircuit className="h-6 w-6" />
            <div>
              <div className="text-sm font-bold uppercase tracking-wider">
                Forge Desktop
              </div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Live Runtime
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
          <NavigationGroup
            label="Live control"
            items={LIVE_NAV_ITEMS}
            location={location}
          />
          <NavigationGroup
            label="Existing workbench"
            items={LEGACY_NAV_ITEMS}
            location={location}
          />
        </nav>

        <div className="border-t border-border p-4">
          <div className="rounded-md border border-border bg-background/50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">
                Forge Runtime
              </span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className={`h-2 w-2 rounded-full ${dotClass}`} />
                {status}
              </span>
            </div>
            <div className="mt-2 truncate font-mono text-[10px] text-muted-foreground">
              {runtime.data?.persistence.runtimeId ?? "No runtime identity"}
            </div>
          </div>
        </div>
      </aside>

      <main className="relative flex flex-1 flex-col overflow-auto">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage:
              "url('data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E')",
          }}
        />
        <div className="z-10 mx-auto w-full max-w-[1500px] flex-1 p-8">
          {children}
        </div>
      </main>
    </div>
  );
}