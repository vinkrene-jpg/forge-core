import { Router, type IRouter } from "express";
import {
  type ForgeRuntime,
  forgeRuntime,
  type ApprovalStatus,
} from "@workspace/forge-runtime";

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "Unknown error");
}

function approvalStatus(
  value: unknown,
): ApprovalStatus | undefined {
  if (
    value === "pending" ||
    value === "approved" ||
    value === "rejected"
  ) {
    return value;
  }

  return undefined;
}

type GovernanceRuntime = Pick<
  ForgeRuntime,
  | "governanceSummary"
  | "listApprovals"
  | "getApproval"
  | "approveApproval"
  | "rejectApproval"
>;

export function createRuntimeGovernanceRouter(
  runtime: GovernanceRuntime = forgeRuntime,
): IRouter {
const router: IRouter = Router();

router.get("/governance", (_req, res): void => {
  res.json(runtime.governanceSummary());
});

router.get(
  "/governance/approvals",
  (req, res): void => {
    const status = approvalStatus(req.query.status);

    res.json({
      summary: runtime.governanceSummary(),
      approvals: runtime.listApprovals(status),
    });
  },
);

router.get(
  "/governance/approvals/:approvalId",
  (req, res): void => {
    const approval = runtime.getApproval(
      req.params.approvalId,
    );

    if (approval === null) {
      res.status(404).json({
        error: "Approval not found",
      });
      return;
    }

    res.json(approval);
  },
);

router.post(
  "/governance/approvals/:approvalId/approve",
  async (req, res): Promise<void> => {
    try {
      const result = await runtime.approveApproval(
        req.params.approvalId,
        String(req.body?.actor ?? ""),
        typeof req.body?.note === "string"
          ? req.body.note
          : undefined,
      );

      res.json(result);
    } catch (error) {
      res.status(400).json({
        error: message(error),
      });
    }
  },
);

router.post(
  "/governance/approvals/:approvalId/reject",
  async (req, res): Promise<void> => {
    try {
      const result = await runtime.rejectApproval(
        req.params.approvalId,
        String(req.body?.actor ?? ""),
        typeof req.body?.note === "string"
          ? req.body.note
          : undefined,
      );

      res.json(result);
    } catch (error) {
      res.status(400).json({
        error: message(error),
      });
    }
  },
);

return router;
}

export default createRuntimeGovernanceRouter();