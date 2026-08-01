import { useDeferredValue, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Link, useParams } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  EVENT_LABELS,
  filterMirrorMissions,
  MISSING_LINK_LABELS,
  MirrorApiError,
  sortTimeline,
  useMirrorMission,
  useMirrorMissions,
  type MirrorTimelineEvent,
} from "@/lib/mirror-api";

const PAGE_SIZE = 50;

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("nl-NL", {
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(date);
}

function statusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  if (status === "succeeded" || status === "running" || status === "approved") return "default";
  if (status === "failed" || status === "cancelled" || status === "rejected") return "destructive";
  return "secondary";
}

function WarningList({ warnings }: { readonly warnings: readonly string[] }) {
  if (warnings.length === 0) {
    return <span className="text-sm text-emerald-400">Geen integriteitswaarschuwingen</span>;
  }

  return (
    <ul className="space-y-1 text-sm text-amber-300">
      {warnings.map((warning) => (
        <li key={warning} className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{warning}</span>
        </li>
      ))}
    </ul>
  );
}

export function MirrorOverviewPage() {
  const missions = useMirrorMissions();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search);
  const records = missions.data?.missions ?? [];
  const statuses = [...new Set(records.map((mission) => mission.status))].sort();
  const filtered = filterMirrorMissions(records, deferredSearch, status);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => setPage(1), [deferredSearch, status]);

  return (
    <div className="space-y-6" data-testid="mirror-overview">
      <header>
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">Mirror</div>
        <h1 className="text-3xl font-bold tracking-tight">Missies</h1>
        <p className="mt-1 text-muted-foreground">Lees de volledige missieketen zonder de runtime te wijzigen.</p>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-4">
        <label className="min-w-64 flex-1 text-sm font-medium">
          Zoeken
          <span className="relative mt-2 block">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="Zoeken op missionId, titel of samenvatting"
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="MissionId, titel of samenvatting"
            />
          </span>
        </label>
        <label className="text-sm font-medium">
          Status
          <select
            aria-label="Statusfilter"
            className="mt-2 block h-9 min-w-44 rounded-md border border-input bg-background px-3 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">Alle statussen</option>
            {statuses.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>

      {missions.isPending ? (
        <div role="status" className="rounded-md border border-border p-8 text-center text-muted-foreground">Missies laden...</div>
      ) : missions.isError ? (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-6">
          <div className="font-medium text-destructive">Missieoverzicht kon niet worden geladen.</div>
          <Button className="mt-4" variant="outline" onClick={() => void missions.refetch()}>Opnieuw proberen</Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-10 text-center">
          <div className="font-medium">Geen missies gevonden</div>
          <p className="mt-1 text-sm text-muted-foreground">Pas de zoekterm of het statusfilter aan.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b border-border bg-muted/30 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Missie</th><th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Eerste activiteit</th><th className="px-4 py-3">Laatste activiteit</th>
                  <th className="px-4 py-3">Gebeurtenissen</th><th className="px-4 py-3">Integriteit</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((mission) => (
                  <tr key={mission.missionId} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                    <td className="max-w-md px-4 py-4 align-top">
                      <Link href={`/mirror/${encodeURIComponent(mission.missionId)}`} className="font-medium text-primary hover:underline">{mission.title}</Link>
                      <div className="mt-1 break-all font-mono text-xs text-muted-foreground">{mission.missionId}</div>
                    </td>
                    <td className="px-4 py-4 align-top"><Badge variant={statusVariant(mission.status)}>{mission.status}</Badge></td>
                    <td className="px-4 py-4 align-top whitespace-nowrap">{formatDate(mission.firstOccurredAt)}</td>
                    <td className="px-4 py-4 align-top whitespace-nowrap">{formatDate(mission.lastOccurredAt)}</td>
                    <td className="px-4 py-4 align-top tabular-nums">{mission.eventCount}</td>
                    <td className="px-4 py-4 align-top">
                      {mission.integrityWarnings.length > 0 ? <Badge variant="outline" className="border-amber-500/60 text-amber-300">{mission.integrityWarnings.length} waarschuwing(en)</Badge> : <span className="text-emerald-400">In orde</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>{filtered.length} missies, maximaal {PAGE_SIZE} per pagina</span>
            <div className="flex items-center gap-2">
              <Button aria-label="Vorige pagina" size="icon" variant="outline" disabled={page === 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft className="h-4 w-4" /></Button>
              <span>Pagina {page} van {pageCount}</span>
              <Button aria-label="Volgende pagina" size="icon" variant="outline" disabled={page === pageCount} onClick={() => setPage((value) => value + 1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Timeline({ events }: { readonly events: readonly MirrorTimelineEvent[] }) {
  return (
    <ol className="relative ml-2 border-l border-border pl-7">
      {sortTimeline(events).map((event) => (
        <li key={event.eventId} className="relative pb-7 last:pb-0">
          <span className="absolute -left-[2.05rem] top-1 h-3 w-3 rounded-full border-2 border-primary bg-background" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{EVENT_LABELS[event.eventType] ?? event.eventType}</span>
            <Badge variant={statusVariant(event.status)}>{event.status}</Badge>
            <span className="text-xs text-muted-foreground">{formatDate(event.occurredAt)}</span>
          </div>
          <p className="mt-2 text-sm">{event.summary}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
            <span>Actor: {event.actorType}</span><span>Bron: {event.sourceType}</span><span className="break-all">Bron-ID: {event.sourceId}</span>
          </div>
          {event.integrityFlags.length > 0 ? <div className="mt-2"><WarningList warnings={event.integrityFlags} /></div> : null}
        </li>
      ))}
    </ol>
  );
}

function ReadOnlySection({ title, values }: { readonly title: string; readonly values: readonly unknown[] }) {
  return (
    <section className="border-t border-border py-5 first:border-0 first:pt-0">
      <h3 className="font-semibold">{title} <span className="text-muted-foreground">({values.length})</span></h3>
      {values.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Niet aanwezig</p> : (
        <div className="mt-3 space-y-2">
          {values.map((value, index) => {
            const record = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
            const label = String(record.summary ?? record.reason ?? record.path ?? record.id ?? `${title} ${index + 1}`);
            return <div key={`${title}-${String(record.id ?? index)}`} className="rounded-md border border-border/70 bg-muted/20 p-3 text-sm"><div>{label}</div><details className="mt-2"><summary className="cursor-pointer text-xs text-muted-foreground">Technische details</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(value, null, 2)}</pre></details></div>;
          })}
        </div>
      )}
    </section>
  );
}

export function MirrorDetailPage() {
  const { missionId = "" } = useParams<{ missionId: string }>();
  const detail = useMirrorMission(missionId);

  if (detail.isPending) return <div role="status" className="p-8 text-center text-muted-foreground">Missiedetail laden...</div>;
  if (detail.isError) {
    const notFound = detail.error instanceof MirrorApiError && detail.error.status === 404;
    return <div className="space-y-4 rounded-md border border-border p-8"><h1 className="text-2xl font-bold">{notFound ? "Missie niet gevonden" : "Missiedetail kon niet worden geladen"}</h1><p className="text-muted-foreground">{detail.error instanceof Error ? detail.error.message : "Onbekende fout"}</p><div className="flex gap-2"><Button asChild variant="outline"><Link href="/mirror"><ArrowLeft className="mr-2 h-4 w-4" />Terug naar Missies</Link></Button>{notFound ? null : <Button onClick={() => void detail.refetch()}>Opnieuw proberen</Button>}</div></div>;
  }

  const data = detail.data;
  const timeline = sortTimeline(data.timeline);
  const first = timeline[0]?.occurredAt ?? data.mission.createdAt;
  const last = timeline.at(-1)?.occurredAt ?? data.mission.updatedAt;
  const missing = [...data.missingLinks, ...data.duplicateWarnings.map((warning) => `duplicate:${warning}`)];

  return (
    <div className="space-y-6" data-testid="mirror-detail">
      <Button asChild variant="ghost" className="-ml-3"><Link href="/mirror"><ArrowLeft className="mr-2 h-4 w-4" />Terug naar Missies</Link></Button>
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3"><Badge variant={statusVariant(data.mission.status)}>{data.mission.status}</Badge><span className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Mirror missiedetail</span></div>
        <h1 className="text-3xl font-bold tracking-tight">{data.mission.title}</h1>
        <div className="break-all font-mono text-xs text-muted-foreground">{data.mission.id}</div>
        <dl className="grid gap-4 border-y border-border py-4 sm:grid-cols-3">
          <div><dt className="text-xs text-muted-foreground">Eerste activiteit</dt><dd className="mt-1 text-sm">{formatDate(first)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Laatste activiteit</dt><dd className="mt-1 text-sm">{formatDate(last)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Gebeurtenissen</dt><dd className="mt-1 text-sm">{timeline.length}</dd></div>
        </dl>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <section>
          <h2 className="mb-5 text-xl font-semibold">Chronologische tijdlijn</h2>
          <Timeline events={timeline} />
        </section>
        <aside className="space-y-6">
          <Card><CardHeader><CardTitle className="text-base">Integriteitswaarschuwingen</CardTitle></CardHeader><CardContent><WarningList warnings={data.integrityWarnings} /></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Ontbrekende schakels</CardTitle></CardHeader><CardContent>{missing.length === 0 ? <span className="text-sm text-emerald-400">Geen ontbrekende schakels</span> : <ul className="space-y-2 text-sm text-amber-300">{missing.map((item) => <li key={item}>{item.startsWith("duplicate:") ? `Dubbele gebeurtenis gedetecteerd: ${item.slice(10)}` : MISSING_LINK_LABELS[item] ?? `${item} ontbreekt`}</li>)}</ul>}</CardContent></Card>
          <Card><CardContent className="pt-6"><ReadOnlySection title="Goedkeuringen" values={data.approvals} /><ReadOnlySection title="Bewijs" values={data.evidence} /><ReadOnlySection title="Bestanden" values={data.artifacts} /><ReadOnlySection title="Beoordelingen" values={data.assessments} /><ReadOnlySection title="Resultaat" values={data.result ? [data.result] : []} /></CardContent></Card>
        </aside>
      </div>
    </div>
  );
}