import { RuntimeEventBus } from "./event-bus";
import { WorkspaceBridgeHost } from "./workspace-bridge";

const directory = process.env.FORGE_WORKSPACE_BRIDGE_DIR?.trim();
const rootPath = process.env.FORGE_WORKSPACE_ROOT?.trim();
const token = process.env.FORGE_WORKSPACE_BRIDGE_TOKEN?.trim();

if (!directory || !rootPath || !token) {
  throw new Error(
    "FORGE_WORKSPACE_BRIDGE_DIR, FORGE_WORKSPACE_ROOT and FORGE_WORKSPACE_BRIDGE_TOKEN are required",
  );
}

const host = new WorkspaceBridgeHost({
  directory,
  rootPath,
  token,
  events: new RuntimeEventBus(),
});

await host.start();
process.stdout.write(
  `${JSON.stringify({
    status: "running",
    processId: process.pid,
    directory,
    rootPath,
  })}\n`,
);

const stop = async (): Promise<void> => {
  await host.stop();
  process.exit(0);
};

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
await new Promise(() => undefined);
