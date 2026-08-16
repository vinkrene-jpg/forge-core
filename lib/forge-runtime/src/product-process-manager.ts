import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import type { ProjectRecord } from "./operator.js";
import type { RuntimeEventBus } from "./event-bus.js";

export interface ProductProcessController {
  isRunning(productId: string): boolean;
  start(product: ProjectRecord): Promise<void>;
  stop(productId: string): Promise<void>;
  stopAll(): Promise<void>;
}

export class NodeProductProcessManager implements ProductProcessController {
  readonly #events: RuntimeEventBus;
  readonly #processes = new Map<string, ChildProcess>();

  constructor(events: RuntimeEventBus) {
    this.#events = events;
  }

  isRunning(productId: string): boolean {
    const child = this.#processes.get(productId);
    return child !== undefined && child.exitCode === null && child.signalCode === null;
  }

  async start(product: ProjectRecord): Promise<void> {
    if (this.isRunning(product.id)) {
      return;
    }
    if (product.startCommand.length === 0) {
      throw new Error("Product has no start command");
    }
    await access(product.rootPath);
    const [executable, ...args] = product.startCommand;
    if (!executable) {
      throw new Error("Product has no start executable");
    }

    const windowsScript = process.platform === "win32" && /\.(cmd|bat)$/i.test(executable);
    const child = spawn(
      windowsScript ? process.env.ComSpec || "cmd.exe" : executable,
      windowsScript ? ["/d", "/s", "/c", executable, ...args] : args,
      {
        cwd: product.rootPath,
        env: process.env,
        shell: false,
        windowsHide: true,
        stdio: "ignore",
      },
    );
    this.#processes.set(product.id, child);
    child.once("exit", () => {
      if (this.#processes.get(product.id) === child) {
        this.#processes.delete(product.id);
      }
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.#processes.delete(product.id);
        reject(error);
      };
      child.once("error", onError);
      child.once("spawn", () => {
        child.off("error", onError);
        resolve();
      });
    });
    this.#events.publish("operator.product.started", {
      projectId: product.id,
      pid: child.pid ?? null,
    });
  }

  async stop(productId: string): Promise<void> {
    const child = this.#processes.get(productId);
    if (!child) {
      return;
    }
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === "win32" && child.pid !== undefined) {
        const terminator = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
          windowsHide: true,
          stdio: "ignore",
        });
        await new Promise<void>((resolve) => terminator.once("close", () => resolve()));
      } else {
        child.kill("SIGTERM");
      }
      if (child.exitCode === null && child.signalCode === null) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 5_000);
          child.once("exit", () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
    this.#processes.delete(productId);
    this.#events.publish("operator.product.stopped", { projectId: productId });
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.#processes.keys()].map((productId) => this.stop(productId)));
  }
}