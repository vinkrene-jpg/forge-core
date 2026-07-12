import { Router, type IRouter } from "express";
import {
  forgeRuntime,
  type ApprovalStatus,
} from "@workspace/forge-runtime";

const router: IRouter = Router();

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

router.get("/governance", (_req, res): void => {
  res.json(forgeRuntime.governanceSummary());
});

router.get(
  "/governance/approvals",
  (req, res): void => {
    const status = approvalStatus(req.query.status);

    res.json({
      summary: forgeRuntime.governanceSummary(),
      approvals: forgeRuntime.listApprovals(status),
    });
  },
);

router.get(
  "/governance/approvals/:approvalId",
  (req, res): void => {
    const approval = forgeRuntime.getApproval(
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
      const result = await forgeRuntime.approveApproval(
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
      const result = await forgeRuntime.rejectApproval(
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

export default router;