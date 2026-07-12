import { Router, type IRouter } from "express";
import {
  forgeRuntime,
  type CreateProjectMemoryRequest,
  type ModelRouteRequest,
  type ProjectMemoryKind,
  type PromptComposeRequest,
} from "@workspace/forge-runtime";

const router: IRouter = Router();

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

export default router;