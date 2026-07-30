import { Router, type IRouter } from "express";
import {
  assessMissionRequest,
  classifyAutonomousObjective,
  forgeRuntime,
  requirementsForMission,
  type CapabilityStatus,
  type CreateProjectMemoryRequest,
  type CreateMissionRequest,
  type ForgeRuntime,
  type ModelRouteRequest,
  type MissionKind,
  type ProjectMemoryKind,
  type PromptComposeRequest,
} from "@workspace/forge-runtime";

const router: IRouter = Router();

type IntakeGovernanceStatus =
  | "can_start"
  | "approval_required"
  | "blocked";

interface MissionIntakePreview {
  readonly originalCommand: string;
  readonly interpretedGoal: string;
  readonly missionKind: MissionKind;
  readonly request: CreateMissionRequest;
  readonly governance: {
    readonly status: IntakeGovernanceStatus;
    readonly decision: "allow" | "require_approval" | "deny";
    readonly riskLevel: "low" | "medium" | "high" | "critical";
    readonly reason: string;
    readonly hardBoundaryActive: boolean;
  };
  readonly expectedCapabilities: readonly {
    readonly capabilityId: string;
    readonly minimumStatus: CapabilityStatus;
    readonly currentStatus: CapabilityStatus | "missing";
    readonly reason: string;
  }[];
}

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "Unknown error");
}

function memoryKind(
  value: unknown,
): ProjectMemoryKind | undefined {
  if (
    value === "decision" ||
    value === "architecture" ||
    value === "requirement" ||
    value === "task" ||
    value === "evidence" ||
    value === "note"
  ) {
    return value;
  }

  return undefined;
}

function normalizeCommand(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("command must be a string");
  }

  const normalized = value.trim().replace(/\s+/g, " ");

  if (normalized.length < 8) {
    throw new Error("command must be at least 8 characters");
  }

  if (normalized.length > 4000) {
    throw new Error("command must be at most 4000 characters");
  }

  return normalized;
}

type MissionIntakeRuntime = Pick<
  ForgeRuntime,
  | "listOperatorProjects"
  | "autonomySummary"
  | "getCapability"
  | "addProjectMemory"
  | "recordMemoryBridgeDecision"
  | "recordMemoryBridgeLearning"
  | "upsertMemoryBridgeContext"
  | "createMission"
>;

function pickProjectId(runtime: MissionIntakeRuntime = forgeRuntime): string {
  return runtime.listOperatorProjects()[0]?.id ?? "forge-core";
}

function extractMaxCycles(command: string): number {
  const cycleMatch = command.match(/(\d+)\s*(?:cycle|cycles|cycli)/i);
  const candidate = cycleMatch ? Number(cycleMatch[1]) : 1;

  if (!Number.isInteger(candidate) || candidate < 1) {
    return 1;
  }

  return Math.min(candidate, 5);
}

function extractDurationMs(command: string): number {
  const match = command.match(/(\d+)\s*(ms|millisecond|milliseconds|sec|secs|second|seconds|min|mins|minute|minutes|uur|hour|hours)/i);

  if (!match) {
    return 30_000;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  if (!Number.isFinite(amount) || amount <= 0) {
    return 30_000;
  }

  if (unit.startsWith("ms")) {
    return Math.min(Math.round(amount), 300_000);
  }

  if (unit.startsWith("sec")) {
    return Math.min(Math.round(amount * 1000), 300_000);
  }

  if (unit.startsWith("min")) {
    return Math.min(Math.round(amount * 60_000), 300_000);
  }

  return Math.min(Math.round(amount * 3_600_000), 300_000);
}

function extractProofTargetPath(command: string): string | null {
  const match = command.match(/\b([a-z0-9][a-z0-9._-]*proof[a-z0-9._-]*\.txt)\b/i);

  if (!match) {
    return null;
  }

  return match[1].toLowerCase();
}

function extractWorkspaceTargets(
  command: string,
): readonly { readonly path: string; readonly allowCreate: true }[] {
  const targets = new Map<string, { readonly path: string; readonly allowCreate: true }>();
  const mutationVerbs =
    /\b(?:maak|creëer|creeer|bouw|wijzig|verander|bewerk|schrijf|implementeer|create|build|modify|edit|write|implement)\b/gi;
  const pathPattern =
    /(?:^|[\s"'`])((?:(?:[a-z0-9._-]+[\\/])+)?[a-z0-9][a-z0-9._-]*\.[a-z0-9]+)(?=$|[\s,.;:!?'"`])/i;

  for (const verb of command.matchAll(mutationVerbs)) {
    const start = (verb.index ?? 0) + verb[0].length;
    const pathMatch = command.slice(start, start + 160).match(pathPattern);

    if (!pathMatch) {
      continue;
    }

    const targetPath = pathMatch[1].replace(/\\/g, "/");
    const segments = targetPath.split("/");

    if (segments.some((segment) => segment === "." || segment === "..")) {
      continue;
    }

    targets.set(targetPath.toLowerCase(), Object.freeze({
      path: targetPath,
      allowCreate: true,
    }));
  }

  return Object.freeze([...targets.values()].slice(0, 8));
}

function chooseMissionKind(command: string): MissionKind {
  if (/(stabil|stability|soak|monitor)/i.test(command)) {
    return "runtime.stability-window";
  }

  if (/(health|gezondheid|self-check|statuscheck|check runtime)/i.test(command)) {
    return "runtime.self-check";
  }

  return "operator.autonomous-cycle";
}

function buildMissionIntakePreview(
  command: string,
  runtime: MissionIntakeRuntime = forgeRuntime,
): MissionIntakePreview {
  const projectId = pickProjectId(runtime);
  const missionKind = chooseMissionKind(command);
  const interpretedGoal = command;
  const proofTargetPath = extractProofTargetPath(command);
  const objectiveClassification =
    missionKind === "operator.autonomous-cycle"
      ? classifyAutonomousObjective(interpretedGoal)
      : null;
  const targets =
    objectiveClassification?.mode === "build-or-mutate"
      ? extractWorkspaceTargets(command)
      : [];

  const request: CreateMissionRequest =
    missionKind === "operator.autonomous-cycle"
      ? {
          kind: missionKind,
          title: `Operator opdracht: ${interpretedGoal.slice(0, 90)}`,
          input: {
            projectId,
            objective: interpretedGoal,
            intakeObjectiveExecutionMode:
              targets.length > 0
                ? "build-or-mutate"
                : objectiveClassification?.mode,
            intakeObjectiveProfile:
              targets.length > 0
                ? "generic-build"
                : objectiveClassification?.profile,
            ...(proofTargetPath ? { proofTargetPath } : {}),
            ...(targets.length > 0 ? { targets } : {}),
            cycleIndex: 1,
            maxCycles: extractMaxCycles(command),
            continuationAuthorized: false,
          },
        }
      : missionKind === "runtime.stability-window"
        ? {
            kind: missionKind,
            title: `Operator stability check: ${interpretedGoal.slice(0, 90)}`,
            input: {
              durationMs: extractDurationMs(command),
              projectId,
              objective: interpretedGoal,
            },
          }
        : {
            kind: missionKind,
            title: `Operator runtime check: ${interpretedGoal.slice(0, 90)}`,
            input: {
              projectId,
              objective: interpretedGoal,
            },
          };

  const assessment = assessMissionRequest(request);
  const autonomy = runtime.autonomySummary();
  const expectedCapabilities = requirementsForMission(missionKind).map((requirement) => {
    const current = runtime.getCapability(requirement.capabilityId);

    return Object.freeze({
      capabilityId: requirement.capabilityId,
      minimumStatus: requirement.minimumStatus,
      currentStatus: current?.status ?? "missing",
      reason: requirement.reason,
    });
  });

  const status: IntakeGovernanceStatus =
    assessment.decision === "allow"
      ? "can_start"
      : assessment.decision === "require_approval"
        ? "approval_required"
        : "blocked";

  return Object.freeze({
    originalCommand: command,
    interpretedGoal,
    missionKind,
    request,
    governance: {
      status,
      decision: assessment.decision,
      riskLevel: assessment.riskLevel,
      reason: assessment.reason,
      hardBoundaryActive: autonomy.blockedByHardGovernance,
    },
    expectedCapabilities,
  });
}

async function persistMissionIntake(
  preview: MissionIntakePreview,
  missionId: string | null,
  runtime: MissionIntakeRuntime = forgeRuntime,
): Promise<void> {
  const projectId = pickProjectId(runtime);

  await runtime.addProjectMemory(projectId, {
    kind: "task",
    source: "desktop-mission-intake",
    tags: ["mission-intake", "command"],
    content: preview.originalCommand,
  });

  await runtime.addProjectMemory(projectId, {
    kind: "decision",
    source: "desktop-mission-intake",
    tags: ["mission-intake", "interpretation", preview.missionKind],
    content: JSON.stringify(
      {
        interpretedGoal: preview.interpretedGoal,
        missionKind: preview.missionKind,
        governance: preview.governance,
        expectedCapabilities: preview.expectedCapabilities,
      },
      null,
      2,
    ),
  });

  await runtime.recordMemoryBridgeDecision({
    title: "Operator opdrachtinvoer",
    content: preview.originalCommand,
    tags: ["desktop-intake", "command"],
    sourceMissionId: missionId,
  });

  await runtime.recordMemoryBridgeDecision({
    title: "Operator interpretatie",
    content: [
      `Goal: ${preview.interpretedGoal}`,
      `Mission kind: ${preview.missionKind}`,
      `Governance: ${preview.governance.status} (${preview.governance.reason})`,
    ].join("\n"),
    tags: [
      "desktop-intake",
      "interpretation",
      preview.missionKind,
      preview.governance.status,
    ],
    sourceMissionId: missionId,
  });

  await runtime.upsertMemoryBridgeContext({
    summary: [
      `Operator goal: ${preview.interpretedGoal}`,
      `Mission kind: ${preview.missionKind}`,
      `Governance: ${preview.governance.status}`,
    ].join("\n"),
    activeMissionIds: missionId ? [missionId] : [],
  });
}

function missionProgress(status: string): number {
  if (status === "awaiting_approval") {
    return 20;
  }

  if (status === "queued") {
    return 35;
  }

  if (status === "running") {
    return 70;
  }

  if (status === "succeeded") {
    return 100;
  }

  if (status === "failed" || status === "cancelled") {
    return 100;
  }

  return 0;
}

router.get("/operator", (_req, res): void => {
  res.json(forgeRuntime.operatorSummary());
});

router.get(
  "/operator/projects",
  (_req, res): void => {
    res.json({
      projects:
        forgeRuntime.listOperatorProjects(),
    });
  },
);

router.get(
  "/operator/projects/:projectId",
  (req, res): void => {
    const project =
      forgeRuntime.getOperatorProject(
        req.params.projectId,
      );

    if (!project) {
      res.status(404).json({
        error: "Project not found",
      });
      return;
    }

    res.json(project);
  },
);

router.get(
  "/operator/projects/:projectId/memories",
  (req, res): void => {
    try {
      res.json({
        memories:
          forgeRuntime.listProjectMemories(
            req.params.projectId,
            memoryKind(req.query.kind),
          ),
      });
    } catch (error) {
      res.status(400).json({
        error: message(error),
      });
    }
  },
);

router.post(
  "/operator/projects/:projectId/memories",
  async (req, res): Promise<void> => {
    try {
      const memory =
        await forgeRuntime.addProjectMemory(
          req.params.projectId,
          req.body as CreateProjectMemoryRequest,
        );

      res.status(201).json(memory);
    } catch (error) {
      res.status(400).json({
        error: message(error),
      });
    }
  },
);

router.get(
  "/operator/projects/:projectId/files",
  async (req, res): Promise<void> => {
    try {
      const depthValue = Number(
        req.query.depth ?? 2,
      );
      const files =
        await forgeRuntime.inspectProjectWorkspace(
          req.params.projectId,
          String(req.query.path ?? "."),
          depthValue,
        );

      res.json({ files });
    } catch (error) {
      res.status(400).json({
        error: message(error),
      });
    }
  },
);

router.post(
  "/operator/projects/:projectId/read",
  async (req, res): Promise<void> => {
    try {
      const file =
        await forgeRuntime.readProjectWorkspaceFile(
          req.params.projectId,
          String(req.body?.path ?? ""),
          req.body?.maxChars === undefined
            ? undefined
            : Number(req.body.maxChars),
        );

      res.json(file);
    } catch (error) {
      res.status(400).json({
        error: message(error),
      });
    }
  },
);

router.post(
  "/operator/model-route",
  (req, res): void => {
    try {
      res.json(
        forgeRuntime.routeModel(
          req.body as ModelRouteRequest,
        ),
      );
    } catch (error) {
      res.status(400).json({
        error: message(error),
      });
    }
  },
);

router.get(
  "/operator/prompts",
  (req, res): void => {
    res.json({
      compositions:
        forgeRuntime.listPromptCompositions(
          typeof req.query.projectId === "string"
            ? req.query.projectId
            : undefined,
        ),
    });
  },
);

router.get(
  "/operator/prompts/:compositionId",
  (req, res): void => {
    const composition =
      forgeRuntime.getPromptComposition(
        req.params.compositionId,
      );

    if (!composition) {
      res.status(404).json({
        error: "Prompt composition not found",
      });
      return;
    }

    res.json(composition);
  },
);

export function createMissionIntakeRouter(
  runtime: MissionIntakeRuntime = forgeRuntime,
): IRouter {
  const intakeRouter: IRouter = Router();

  intakeRouter.post("/operator/mission-intake/preview", (req, res): void => {
    try {
      const command = normalizeCommand(req.body?.command);
      const preview = buildMissionIntakePreview(command, runtime);
      res.json(preview);
    } catch (error) {
      res.status(400).json({ error: message(error) });
    }
  });

  intakeRouter.post("/operator/mission-intake/start", async (req, res): Promise<void> => {
    try {
      const command = normalizeCommand(req.body?.command);
      const preview = buildMissionIntakePreview(command, runtime);

      await persistMissionIntake(preview, null, runtime);

      const result = await runtime.createMission(preview.request);

      await persistMissionIntake(preview, result.mission.id, runtime);
      await runtime.recordMemoryBridgeLearning({
        title: `Mission gestart: ${result.mission.id}`,
        content: [
          `Command: ${preview.originalCommand}`,
          `Interpreted goal: ${preview.interpretedGoal}`,
          `Mission kind: ${preview.missionKind}`,
          `Mission status: ${result.mission.status}`,
          `Governance decision: ${result.governance.decision}`,
        ].join("\n"),
        tags: ["desktop-intake", "mission-started", preview.missionKind],
        sourceMissionId: result.mission.id,
      });

      res.status(202).json({
        preview,
        mission: result.mission,
        governance: result.governance,
        approval: result.approval,
        progress: missionProgress(result.mission.status),
      });
    } catch (error) {
      res.status(400).json({ error: message(error) });
    }
  });

  return intakeRouter;
}

router.use(createMissionIntakeRouter());

router.post(
  "/operator/mission-intake/:missionId/record-result",
  async (req, res): Promise<void> => {
    try {
      const mission = forgeRuntime.getMission(req.params.missionId);

      if (!mission) {
        res.status(404).json({ error: "Mission not found" });
        return;
      }

      if (mission.status !== "succeeded" && mission.status !== "failed" && mission.status !== "cancelled") {
        res.status(400).json({ error: "Mission is not finished yet" });
        return;
      }

      const projectId = pickProjectId();
      const resultSummary = mission.status === "succeeded"
        ? JSON.stringify(mission.output ?? {}, null, 2)
        : mission.lastError ?? `Mission ended with status ${mission.status}`;

      await forgeRuntime.addProjectMemory(projectId, {
        kind: "evidence",
        source: "desktop-mission-console",
        tags: ["mission-console", "mission-result", mission.status, mission.kind],
        content: JSON.stringify(
          {
            missionId: mission.id,
            kind: mission.kind,
            status: mission.status,
            title: mission.title,
            startedAt: mission.startedAt,
            completedAt: mission.completedAt,
            result: resultSummary,
          },
          null,
          2,
        ),
      });

      await forgeRuntime.recordMemoryBridgeLearning({
        title: `Mission result ${mission.status}: ${mission.id}`,
        content: [
          `Mission: ${mission.id}`,
          `Kind: ${mission.kind}`,
          `Status: ${mission.status}`,
          `Result: ${resultSummary}`,
        ].join("\n"),
        tags: ["mission-console", "mission-result", mission.status, mission.kind],
        sourceMissionId: mission.id,
      });

      res.json({ missionId: mission.id, status: mission.status, recorded: true });
    } catch (error) {
      res.status(400).json({ error: message(error) });
    }
  },
);

router.post(
  "/operator/prompts",
  async (req, res): Promise<void> => {
    try {
      const composition =
        await forgeRuntime.composeProjectPrompt(
          req.body as PromptComposeRequest,
        );

      res.status(201).json(composition);
    } catch (error) {
      res.status(400).json({
        error: message(error),
      });
    }
  },
);

router.get("/operator/workspace-plans", (_req, res): void => {
  res.json({
    missions: forgeRuntime
      .listMissions()
      .filter((mission) => mission.kind === "operator.workspace-plan"),
  });
});

router.post(
  "/operator/workspace-plans",
  async (req, res): Promise<void> => {
    try {
      const result = await forgeRuntime.createMission({
        kind: "operator.workspace-plan",
        title:
          typeof req.body?.title === "string"
            ? req.body.title
            : "Governed provider workspace plan",
        input: {
          projectId: req.body?.projectId ?? "forge-core",
          objective: req.body?.objective,
          targets: req.body?.targets,
        },
      });

      res.status(202).json({
        ...result.mission,
        governance: result.governance,
        approval: result.approval,
        capabilityAnalysis: result.capabilityAnalysis,
      });
    } catch (error) {
      res.status(400).json({ error: message(error) });
    }
  },
);

router.post(
  "/operator/workspace-plans/:missionId/schedule",
  async (req, res): Promise<void> => {
    try {
      const result = await forgeRuntime.scheduleWorkspacePlan(
        req.params.missionId,
      );

      res.status(202).json({
        planningMission: result.planningMission,
        plan: result.plan,
        executionMission: result.executionMission.mission,
        governance: result.executionMission.governance,
        approval: result.executionMission.approval,
      });
    } catch (error) {
      res.status(400).json({ error: message(error) });
    }
  },
);

export default router;
