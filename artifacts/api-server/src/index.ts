import app from "./app";
import { logger } from "./lib/logger";
import { ensureStorage } from "./lib/storage";
import { seedCoreRegistry } from "./lib/seed";
import { forgeRuntime } from "@workspace/forge-runtime";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

let server: ReturnType<typeof app.listen> | undefined;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info({ signal }, "Shutting down server");

  await forgeRuntime.stop();

  if (!server) {
    process.exit(0);
  }

  server.close((error) => {
    if (error) {
      logger.error({ error }, "Failed to close server");
      process.exit(1);
    }

    process.exit(0);
  });
}

async function start(): Promise<void> {
  ensureStorage();
  await seedCoreRegistry();
  await forgeRuntime.start();

  server = app.listen(port, () => {
    logger.info({ port }, "Server listening");
  });

  server.on("error", async (error) => {
    logger.error({ error }, "Error listening on port");
    await forgeRuntime.stop();
    process.exit(1);
  });

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

start().catch(async (error) => {
  logger.error({ error }, "Failed to start server");
  await forgeRuntime.stop();
  process.exit(1);
});
