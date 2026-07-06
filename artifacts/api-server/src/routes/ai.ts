import { Router, type IRouter } from "express";
import { jsonSafe } from "../lib/jsonSafe";
import { desc } from "drizzle-orm";
import { db, aiCallsTable } from "@workspace/db";
import {
  ListAiProvidersResponse,
  ListAiCallsQueryParams,
  ListAiCallsResponse,
  InvokeAiBody,
  InvokeAiResponse,
} from "@workspace/api-zod";
import { providerSummary, invokeGateway, GatewayError, type TaskType } from "../lib/aiGateway";
import { audit } from "../lib/audit";

const router: IRouter = Router();

router.get("/ai/providers", async (_req, res): Promise<void> => {
  res.json(ListAiProvidersResponse.parse(providerSummary()));
});

router.post("/ai/invoke", async (req, res): Promise<void> => {
  const body = InvokeAiBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const result = await invokeGateway(
      body.data.taskType as TaskType,
      body.data.prompt,
      body.data.context,
    );
    await audit({
      actor: "ai-gateway",
      action: "ai_invoke",
      targetType: "ai-call",
      targetId: result.id,
      details: `Task type: ${body.data.taskType}, provider: ${result.provider}`,
    });
    res.json(
      InvokeAiResponse.parse({
        id: result.id,
        provider: result.provider,
        model: result.model,
        taskType: body.data.taskType,
        response: result.response,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costIndication: result.costIndication,
      }),
    );
  } catch (err) {
    if (err instanceof GatewayError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

router.get("/ai/calls", async (req, res): Promise<void> => {
  const query = ListAiCallsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(aiCallsTable)
    .orderBy(desc(aiCallsTable.createdAt))
    .limit(query.data.limit ?? 100);
  res.json(ListAiCallsResponse.parse(jsonSafe(rows)));
});

export default router;
