import { Router, type IRouter } from "express";
import healthRouter from "./health";
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
import proposalsRouter from "./proposals";

const router: IRouter = Router();

router.use(healthRouter);
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
router.use(proposalsRouter);

export default router;
