import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, proposalsTable } from "@workspace/db";
import {
  ListProposalsResponse,
  GetProposalParams,
  GetProposalResponse,
  GenerateProposalBody,
  GenerateProposalResponse,
} from "@workspace/api-zod";
import { jsonSafe } from "../lib/jsonSafe";
import { GatewayError } from "../lib/aiGateway";
import { generateProposal, ProposalSourceNotFoundError } from "../lib/proposalGenerator";

const router: IRouter = Router();

router.get("/proposals", async (_req, res): Promise<void> => {
  const rows = await db.select().from(proposalsTable).orderBy(desc(proposalsTable.createdAt));
  res.json(ListProposalsResponse.parse(jsonSafe(rows)));
});

router.get("/proposals/:id", async (req, res): Promise<void> => {
  const params = GetProposalParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(proposalsTable).where(eq(proposalsTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  res.json(GetProposalResponse.parse(jsonSafe(row)));
});

router.post("/proposals/generate", async (req, res): Promise<void> => {
  const body = GenerateProposalBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const proposal = await generateProposal({
      sourceType: body.data.sourceType,
      sourceId: body.data.sourceId,
      instructions: body.data.instructions,
    });
    res.status(201).json(GenerateProposalResponse.parse(jsonSafe(proposal)));
  } catch (err) {
    if (err instanceof ProposalSourceNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof GatewayError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

export default router;
