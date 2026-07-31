import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { resolveSqlitePath } from "@workspace/db";
import healthRouter from "../routes/health";

test("SQLite path precedence is stable across API working directories", { concurrency: false }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-db-path-"));
  const repositoryRoot = path.join(root, "repo");
  const apiDirectory = path.join(repositoryRoot, "artifacts", "api-server");
  await mkdir(apiDirectory, { recursive: true });
  await writeFile(path.join(repositoryRoot, "pnpm-workspace.yaml"), "packages: []\n", "utf8");
  const originalDirectory = process.cwd();
  const originalEnvironment = new Map(
    ["FORGE_SQLITE_PATH", "STORAGE_DIR", "FORGE_CANONICAL_REPO_ROOT"]
      .map((key) => [key, process.env[key]]),
  );

  try {
    delete process.env.FORGE_SQLITE_PATH;
    delete process.env.STORAGE_DIR;
    delete process.env.FORGE_CANONICAL_REPO_ROOT;
    process.chdir(apiDirectory);
    const sharedDatabase = path.join(root, "storage", "forge.sqlite");
    await mkdir(path.dirname(sharedDatabase), { recursive: true });
    await writeFile(sharedDatabase, "existing shared database", "utf8");
    assert.equal(resolveSqlitePath(), sharedDatabase);

    const repositoryDatabase = path.join(repositoryRoot, "storage", "forge.sqlite");
    await mkdir(path.dirname(repositoryDatabase), { recursive: true });
    await writeFile(repositoryDatabase, "existing repository database", "utf8");
    assert.equal(resolveSqlitePath(), repositoryDatabase);

    const nestedPackageDirectory = path.join(repositoryRoot, "lib", "forge-runtime");
    await mkdir(nestedPackageDirectory, { recursive: true });
    process.chdir(nestedPackageDirectory);
    assert.equal(resolveSqlitePath(), repositoryDatabase);

    await rm(path.join(root, "storage"), { recursive: true, force: true });
    await rm(path.join(repositoryRoot, "storage"), { recursive: true, force: true });

    process.env.FORGE_CANONICAL_REPO_ROOT = path.join(root, "canonical");
    assert.equal(
      resolveSqlitePath(),
      path.join(root, "canonical", "storage", "forge.sqlite"),
    );

    process.env.STORAGE_DIR = path.join(root, "data");
    assert.equal(resolveSqlitePath(), path.join(root, "data", "forge.sqlite"));

    process.env.FORGE_SQLITE_PATH = path.join(root, "explicit", "forge.db");
    assert.equal(resolveSqlitePath(), path.join(root, "explicit", "forge.db"));
  } finally {
    process.chdir(originalDirectory);
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("healthz reports reachable database and writable storage", async () => {
  const app = express();
  app.use("/api", healthRouter);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ok",
      database: "ok",
      storage: "ok",
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});