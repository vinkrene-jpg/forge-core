// Internal Knowledge Base: unified search over the knowledge graph, memory
// engine, capability map, documentation and recent audit trail.

import fs from "fs";
import path from "path";
import { desc, eq } from "drizzle-orm";
import {
  db,
  knowledgeNodesTable,
  introspectionSnapshotsTable,
  memoryItemsTable,
  capabilitiesTable,
  auditLogsTable,
} from "@workspace/db";
import { workspaceRoot } from "./codeScan";
import { audit } from "./audit";

export interface KnowledgeBaseHit {
  sourceType: "knowledge_node" | "memory_item" | "capability" | "doc" | "audit_log";
  refKey: string | null;
  title: string;
  snippet: string;
}

export interface KnowledgeBaseResult {
  query: string;
  total: number;
  results: KnowledgeBaseHit[];
}

const MAX_PER_SOURCE = 10;

function snippetAround(text: string, q: string, radius = 120): string {
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  return `${start > 0 ? "..." : ""}${text.slice(start, idx + q.length + radius)}${idx + q.length + radius < text.length ? "..." : ""}`;
}

export async function searchKnowledgeBase(query: string): Promise<KnowledgeBaseResult> {
  const q = query.trim().toLowerCase();
  const hits: KnowledgeBaseHit[] = [];

  if (q.length > 0) {
    // Knowledge graph nodes (latest snapshot only).
    const [snapshot] = await db
      .select({ id: introspectionSnapshotsTable.id })
      .from(introspectionSnapshotsTable)
      .orderBy(desc(introspectionSnapshotsTable.createdAt))
      .limit(1);
    if (snapshot) {
      const nodes = await db.select().from(knowledgeNodesTable).where(eq(knowledgeNodesTable.snapshotId, snapshot.id));
      for (const n of nodes.filter((x) => x.key.toLowerCase().includes(q) || x.label.toLowerCase().includes(q)).slice(0, MAX_PER_SOURCE)) {
        hits.push({ sourceType: "knowledge_node", refKey: n.key, title: n.label, snippet: `${n.nodeType}: ${n.key}` });
      }
    }

    // Memory engine.
    const memory = await db.select().from(memoryItemsTable).orderBy(desc(memoryItemsTable.createdAt));
    for (const m of memory
      .filter((x) => x.title.toLowerCase().includes(q) || (x.content ?? "").toLowerCase().includes(q))
      .slice(0, MAX_PER_SOURCE)) {
      hits.push({ sourceType: "memory_item", refKey: String(m.id), title: m.title, snippet: snippetAround(m.content ?? "", q) });
    }

    // Capability map.
    const caps = await db.select().from(capabilitiesTable);
    for (const c of caps
      .filter((x) => x.key.toLowerCase().includes(q) || x.name.toLowerCase().includes(q) || x.description.toLowerCase().includes(q))
      .slice(0, MAX_PER_SOURCE)) {
      hits.push({ sourceType: "capability", refKey: c.key, title: c.name, snippet: `${c.status} (maturity ${c.maturity}): ${snippetAround(c.description, q)}` });
    }

    // Documentation (workspace root markdown files).
    try {
      const docFiles = fs.readdirSync(workspaceRoot).filter((f) => f.endsWith(".md"));
      let docHits = 0;
      for (const f of docFiles) {
        if (docHits >= MAX_PER_SOURCE) break;
        const content = fs.readFileSync(path.join(workspaceRoot, f), "utf8");
        const line = content.split("\n").find((l) => l.toLowerCase().includes(q));
        if (f.toLowerCase().includes(q) || line) {
          hits.push({ sourceType: "doc", refKey: f, title: f, snippet: line ? snippetAround(line, q) : "filename match" });
          docHits += 1;
        }
      }
    } catch {
      /* docs unreadable: skipped */
    }

    // Recent audit trail.
    const logs = await db.select().from(auditLogsTable).orderBy(desc(auditLogsTable.createdAt)).limit(500);
    for (const l of logs
      .filter((x) => x.action.toLowerCase().includes(q) || (x.details ?? "").toLowerCase().includes(q))
      .slice(0, MAX_PER_SOURCE)) {
      hits.push({ sourceType: "audit_log", refKey: String(l.id), title: `${l.actor}: ${l.action}`, snippet: snippetAround(l.details ?? "", q) });
    }
  }

  await audit({
    actor: "knowledge-base",
    action: "kb_search_performed",
    targetType: "knowledge-base",
    details: `query='${query.slice(0, 100)}' hits=${hits.length}`,
  });

  return { query, total: hits.length, results: hits };
}
