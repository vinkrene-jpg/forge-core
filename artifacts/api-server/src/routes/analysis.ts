import { Router, type IRouter } from "express";
import {
  GetQualityAnalysisResponse,
  GetTechnicalDebtAnalysisResponse,
  GetDependencyAnalysisResponse,
  GetArchitectureValidationResponse,
  CreateRefactorPlanResponse,
  GetRoadmapResponse,
  SearchKnowledgeBaseResponse,
  SearchKnowledgeBaseQueryParams,
  GenerateDocumentationResponse,
} from "@workspace/api-zod";
import { analyzeQuality } from "../lib/qualityAnalyzer";
import { analyzeTechnicalDebt } from "../lib/techDebtAnalyzer";
import { analyzeDependencies } from "../lib/dependencyAnalyzer";
import { validateArchitecture } from "../lib/architectureValidator";
import { createRefactorPlan } from "../lib/refactoringEngine";
import { generateRoadmap } from "../lib/roadmapGenerator";
import { searchKnowledgeBase } from "../lib/knowledgeBase";
import { generateSelfModelDocs } from "../lib/docsGenerator";
import { jsonSafe } from "../lib/jsonSafe";

const router: IRouter = Router();

router.get("/analysis/quality", async (_req, res): Promise<void> => {
  res.json(GetQualityAnalysisResponse.parse(jsonSafe(await analyzeQuality())));
});

router.get("/analysis/debt", async (_req, res): Promise<void> => {
  res.json(GetTechnicalDebtAnalysisResponse.parse(jsonSafe(await analyzeTechnicalDebt())));
});

router.get("/analysis/dependencies", async (_req, res): Promise<void> => {
  res.json(GetDependencyAnalysisResponse.parse(jsonSafe(await analyzeDependencies())));
});

router.get("/analysis/architecture", async (_req, res): Promise<void> => {
  res.json(GetArchitectureValidationResponse.parse(jsonSafe(await validateArchitecture())));
});

router.post("/analysis/refactor-plan", async (_req, res): Promise<void> => {
  res.status(201).json(CreateRefactorPlanResponse.parse(jsonSafe(await createRefactorPlan())));
});

router.get("/roadmap", async (_req, res): Promise<void> => {
  res.json(GetRoadmapResponse.parse(jsonSafe(await generateRoadmap())));
});

router.get("/knowledge-base/search", async (req, res): Promise<void> => {
  const { q } = SearchKnowledgeBaseQueryParams.parse(req.query);
  res.json(SearchKnowledgeBaseResponse.parse(jsonSafe(await searchKnowledgeBase(q))));
});

router.post("/docs/generate", async (_req, res): Promise<void> => {
  res.status(201).json(GenerateDocumentationResponse.parse(jsonSafe(await generateSelfModelDocs())));
});

export default router;
