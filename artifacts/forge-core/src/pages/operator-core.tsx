import { useMemo, useState } from "react";
import {
  BrainCircuit,
  Database,
  FileCode2,
  FolderTree,
  Plus,
  Route,
  WandSparkles,
} from "lucide-react";
import {
  useAddMemory,
  useComposePrompt,
  useOperatorProjects,
  useOperatorSummary,
  useProjectMemories,
  usePromptCompositions,
  useWorkspaceFiles,
} from "@/hooks/use-operator-core";
import type {
  ModelBudget,
  ModelPrivacy,
  ModelTaskType,
  ProjectMemoryKind,
} from "@/lib/operator-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const memoryKinds: ProjectMemoryKind[] = [
  "decision",
  "architecture",
  "requirement",
  "task",
  "evidence",
  "note",
];

export default function OperatorCorePage() {
  const projects = useOperatorProjects();
  const summary = useOperatorSummary();
  const project =
    projects.data?.projects[0] ?? null;
  const projectId = project?.id ?? "";
  const memories = useProjectMemories(projectId);
  const files = useWorkspaceFiles(projectId);
  const compositions =
    usePromptCompositions(projectId);
  const addMemory = useAddMemory();
  const compose = useComposePrompt();

  const [memoryKind, setMemoryKind] =
    useState<ProjectMemoryKind>("decision");
  const [memoryContent, setMemoryContent] =
    useState("");
  const [objective, setObjective] =
    useState(
      "Review the current Forge Core architecture and identify the next evidence-backed implementation step.",
    );
  const [taskType, setTaskType] =
    useState<ModelTaskType>("analysis");
  const [privacy, setPrivacy] =
    useState<ModelPrivacy>("local-only");
  const [budget, setBudget] =
    useState<ModelBudget>("low");
  const [selectedFiles, setSelectedFiles] =
    useState<string[]>([
      "GOVERNANCE/CONSTITUTION.md",
      "package.json",
    ]);
  const visibleFiles = useMemo(
    () =>
      (files.data?.files ?? [])
        .filter((file) => file.type === "file")
        .slice(0, 40),
    [files.data],
  );

  const latestComposition =
    compositions.data?.compositions.at(-1) ??
    null;

  const actionError =
    addMemory.error instanceof Error
      ? addMemory.error.message
      : compose.error instanceof Error
        ? compose.error.message
        : null;

  const summaryCards: ReadonlyArray<{
    readonly label: string;
    readonly value: number;
    readonly icon: typeof FolderTree;
  }> = [
    {
      label: "Projects",
      value: summary.data?.projects ?? 0,
      icon: FolderTree,
    },
    {
      label: "Project memories",
      value: summary.data?.memories ?? 0,
      icon: Database,
    },
    {
      label: "Prompt compositions",
      value: summary.data?.compositions ?? 0,
      icon: WandSparkles,
    },
    {
      label: "Model profiles",
      value: summary.data?.modelProfiles ?? 0,
      icon: Route,
    },
  ];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Operator Core
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Project Memory, Prompt Composer and Model Router
          </h1>
          <p className="mt-1 text-muted-foreground">
            Ground model work in persistent project context and protected workspace evidence.
          </p>
        </div>
        <Badge variant="outline">
          Tool connector:{" "}
          {summary.data?.workspaceConnector ?? "loading"}
        </Badge>
      </div>

      {actionError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {actionError}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="flex items-center justify-between pt-6">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  {label}
                </div>
                <div className="mt-2 text-3xl font-bold">
                  {value}
                </div>
              </div>
              <Icon className="h-5 w-5 text-primary" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Database className="h-5 w-5 text-primary" />
              Project Memory
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-border/60 bg-background/40 p-3">
              <div className="font-medium">
                {project?.name ?? "Loading project"}
              </div>
              <div className="mt-1 font-mono text-xs text-muted-foreground">
                {project?.rootPath}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[170px_1fr]">
              <Select
                value={memoryKind}
                onValueChange={(value) =>
                  setMemoryKind(
                    value as ProjectMemoryKind,
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {memoryKinds.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {kind}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={memoryContent}
                onChange={(event) =>
                  setMemoryContent(event.target.value)
                }
                placeholder="Record a durable project fact or decision"
              />
            </div>
            <Button
              disabled={
                projectId.length === 0 ||
                memoryContent.trim().length === 0 ||
                addMemory.isPending
              }
              onClick={() => {
                addMemory.mutate({
                  projectId,
                  kind: memoryKind,
                  content: memoryContent,
                });
                setMemoryContent("");
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add memory
            </Button>

            <div className="max-h-72 space-y-2 overflow-y-auto">
              {[...(memories.data?.memories ?? [])]
                .reverse()
                .map((memory) => (
                  <div
                    key={memory.id}
                    className="rounded-md border border-border/50 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <Badge variant="outline">
                        {memory.kind}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(
                          memory.createdAt,
                        ).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-2 text-sm">
                      {memory.content}
                    </p>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileCode2 className="h-5 w-5 text-primary" />
              Workspace Connector
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              Read-only view. Protected paths, secrets, binaries and oversized files are blocked.
            </p>
            <div className="max-h-[420px] space-y-1 overflow-y-auto font-mono text-xs">
              {visibleFiles.map((file) => {
                const selected =
                  selectedFiles.includes(file.path);

                return (
                  <button
                    type="button"
                    key={file.path}
                    onClick={() =>
                      setSelectedFiles((current) =>
                        selected
                          ? current.filter(
                              (path) =>
                                path !== file.path,
                            )
                          : [
                              ...current,
                              file.path,
                            ].slice(-8),
                      )
                    }
                    className={`block w-full rounded px-3 py-2 text-left transition-colors ${
                      selected
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {selected ? "[x]" : "[ ]"}{" "}
                    {file.path}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BrainCircuit className="h-5 w-5 text-primary" />
            Prompt Composer and Model Router
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={objective}
            onChange={(event) =>
              setObjective(event.target.value)
            }
            className="min-h-28"
          />

          <div className="grid gap-3 md:grid-cols-3">
            <Select
              value={taskType}
              onValueChange={(value) =>
                setTaskType(value as ModelTaskType)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[
                  "analysis",
                  "reasoning",
                  "coding",
                  "summarization",
                ].map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={privacy}
              onValueChange={(value) =>
                setPrivacy(value as ModelPrivacy)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[
                  "local-only",
                  "private",
                  "standard",
                ].map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={budget}
              onValueChange={(value) =>
                setBudget(value as ModelBudget)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["low", "medium", "high"].map(
                  (value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              Files selected: {selectedFiles.length}
            </div>
            <Button
              disabled={
                projectId.length === 0 ||
                objective.trim().length === 0 ||
                compose.isPending
              }
              onClick={() =>
                compose.mutate({
                  projectId,
                  objective,
                  taskType,
                  privacy,
                  budget,
                  files: selectedFiles,
                })
              }
            >
              <WandSparkles className="mr-2 h-4 w-4" />
              Compose grounded prompt
            </Button>
          </div>

          {latestComposition ? (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">
                    Latest composition
                  </div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">
                    {latestComposition.id}
                  </div>
                </div>
                <Badge>
                  {
                    latestComposition.route
                      .selectedProfile.id
                  }
                </Badge>
              </div>
              <div className="mt-3 text-xs text-amber-400">
                Routing-only: no external provider is bound yet.
              </div>
              <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-background p-4 text-xs text-muted-foreground">
                {latestComposition.content}
              </pre>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}