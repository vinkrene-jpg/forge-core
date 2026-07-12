import { Router, type IRouter } from "express";
import healthRouter from "./health";
import runtimeRouter from "./runtime";
import missionsRouter from "./missions";
import runtimeGovernanceRouter from "./runtimeGovernance";
import capabilitiesRouter from "./capabilities";
import operatorRouter from "./operator";
import dashboardRouter from "./dashboard";
import coreRouter from "./core";
import aiRouter from "./ai";
import projectsRouter from "./projects";
import tasksRouter from "./tasks";
import modulesRouter from "./modules";
import sandboxesRouter from "./sandboxes";
import governanceRouter from "./governance";
import memoryRouter from "./memory";
import dailyLoopRouter from "./dailyLoop";

const router: IRouter = Router();

router.use(healthRouter);
router.use(runtimeRouter);
router.use(missionsRouter);
router.use(runtimeGovernanceRouter);
router.use(capabilitiesRouter);
router.use(operatorRouter);
router.use(dashboardRouter);
router.use(coreRouter);
router.use(aiRouter);
router.use(projectsRouter);
router.use(tasksRouter);
router.use(modulesRouter);
router.use(sandboxesRouter);
router.use(governanceRouter);
router.use(memoryRouter);
router.use(dailyLoopRouter);

export default router;
