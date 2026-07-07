// Evolution Scheduler: periodically triggers the autonomous evolution loop
// without any external development orders. In-memory interval; state is
// audit-logged so scheduler activity remains traceable. Disabled by default;
// enable via POST /evolution/scheduler or EVOLUTION_SCHEDULER_ENABLED=true.

import { executeEvolutionRun, RunInProgressError } from "./evolutionLoop";
import { audit } from "./audit";
import { logger } from "./logger";

export interface SchedulerStatus {
  enabled: boolean;
  intervalMinutes: number;
  running: boolean;
  ticks: number;
  lastRunId: number | null;
  lastTickAt: string | null;
  nextTickAt: string | null;
  lastError: string | null;
}

const DEFAULT_INTERVAL_MINUTES = Math.max(
  1,
  Math.min(10080, Number(process.env.EVOLUTION_SCHEDULER_INTERVAL_MINUTES) || 60),
);

const state = {
  enabled: false,
  intervalMinutes: DEFAULT_INTERVAL_MINUTES,
  running: false,
  ticks: 0,
  lastRunId: null as number | null,
  lastTickAt: null as string | null,
  nextTickAt: null as string | null,
  lastError: null as string | null,
  timer: null as ReturnType<typeof setInterval> | null,
};

export function getSchedulerStatus(): SchedulerStatus {
  const { timer: _timer, ...rest } = state;
  return { ...rest };
}

export async function tick(): Promise<void> {
  state.ticks += 1;
  state.lastTickAt = new Date().toISOString();
  if (state.enabled) state.nextTickAt = new Date(Date.now() + state.intervalMinutes * 60_000).toISOString();
  if (state.running) return;
  state.running = true;
  try {
    const run = await executeEvolutionRun("scheduler");
    state.lastRunId = run.id;
    state.lastError = null;
    await audit({
      actor: "evolution-scheduler",
      action: "scheduler_tick",
      targetType: "evolution-run",
      targetId: run.id,
      details: `Scheduled evolution run #${run.id} finished with status=${run.status} phase=${run.phase}`,
      outcome: run.status === "completed" ? "allowed" : "blocked",
    });
  } catch (err) {
    if (err instanceof RunInProgressError) {
      state.lastError = err.message;
      await audit({
        actor: "evolution-scheduler",
        action: "scheduler_tick",
        targetType: "evolution-run",
        targetId: err.runId,
        details: `Tick skipped: evolution run #${err.runId} already in progress.`,
        outcome: "blocked",
      });
    } else {
      state.lastError = err instanceof Error ? err.message : String(err);
      logger.error({ err: state.lastError }, "Scheduler tick failed");
      await audit({
        actor: "evolution-scheduler",
        action: "scheduler_tick",
        targetType: "evolution-run",
        details: `Scheduled run failed: ${state.lastError}`,
        outcome: "blocked",
      });
    }
  } finally {
    state.running = false;
  }
}

function startTimer(): void {
  stopTimer();
  state.timer = setInterval(() => {
    void tick();
  }, state.intervalMinutes * 60_000);
  // Do not keep the process alive purely for the scheduler.
  state.timer.unref?.();
  state.nextTickAt = new Date(Date.now() + state.intervalMinutes * 60_000).toISOString();
}

function stopTimer(): void {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.nextTickAt = null;
}

export async function configureScheduler(config: { enabled: boolean; intervalMinutes?: number }): Promise<SchedulerStatus> {
  if (config.intervalMinutes != null) state.intervalMinutes = Math.max(1, Math.min(10080, config.intervalMinutes));
  state.enabled = config.enabled;
  if (state.enabled) startTimer();
  else stopTimer();
  await audit({
    actor: "evolution-scheduler",
    action: "scheduler_configured",
    targetType: "scheduler",
    details: `enabled=${state.enabled} intervalMinutes=${state.intervalMinutes}`,
  });
  return getSchedulerStatus();
}

export function initSchedulerFromEnv(): void {
  if (process.env.EVOLUTION_SCHEDULER_ENABLED === "true") {
    state.enabled = true;
    startTimer();
    logger.info({ intervalMinutes: state.intervalMinutes }, "Evolution scheduler enabled from env");
  }
}
