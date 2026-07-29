import {
  readFile,
  readdir,
  realpath,
  stat,
} from "node:fs/promises";
import path from "node:path";
import type {
  WorkspaceFileContent,
  WorkspaceFileSummary,
} from "./operator";

const deniedSegments = new Set([
  ".git",
  "node_modules",
  "storage",
  ".pnpm-store",
  "dist",
]);

const deniedNames = new Set([
  "id_rsa",
  "id_ed25519",
]);

function denied(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean);

  if (
    segments.some((segment) =>
      deniedSegments.has(segment),
    )
  ) {
    return true;
  }

  const name = segments.at(-1) ?? "";

  if (
    name === ".env" ||
    name.startsWith(".env.") &&
      name !== ".env.example" ||
    name.endsWith(".pem") ||
    name.endsWith(".key") ||
    deniedNames.has(name)
  ) {
    return true;
  }

  return false;
}

function normalizeRelativePath(
  relativePath: string,
): string {
  const normalized = relativePath
    .replaceAll("\\", "/")
    .replace(/^\/+/, "");

  if (
    normalized === "" ||
    normalized === "."
  ) {
    return ".";
  }

  if (
    normalized.split("/").some(
      (segment) => segment === "..",
    )
  ) {
    throw new Error("Parent path traversal is not allowed");
  }

  if (denied(normalized)) {
    throw new Error(
      `Access to protected path is denied: ${normalized}`,
    );
  }

  return normalized;
}

async function resolveInsideRoot(
  rootPath: string,
  relativePath: string,
): Promise<{
  readonly root: string;
  readonly target: string;
  readonly relative: string;
}> {
  const relative = normalizeRelativePath(relativePath);
  const root = await realpath(rootPath);
  const candidate = path.resolve(root, relative);
  const target = await realpath(candidate);

  if (
    target !== root &&
    !target.startsWith(root + path.sep)
  ) {
    throw new Error("Resolved path escapes the project root");
  }

  return { root, target, relative };
}

export class WorkspaceConnector {
  async inspect(
    rootPath: string,
    relativePath = ".",
    depth = 2,
    maxEntries = 250,
  ): Promise<readonly WorkspaceFileSummary[]> {
    if (
      !Number.isInteger(depth) ||
      depth < 0 ||
      depth > 5
    ) {
      throw new Error("depth must be between 0 and 5");
    }

    const resolved = await resolveInsideRoot(
      rootPath,
      relativePath,
    );
    const results: WorkspaceFileSummary[] = [];

    const visit = async (
      absolute: string,
      relative: string,
      remainingDepth: number,
    ): Promise<void> => {
      if (results.length >= maxEntries) {
        return;
      }

      const entries = await readdir(absolute, {
        withFileTypes: true,
      });

      entries.sort((left, right) =>
        left.name.localeCompare(right.name),
      );

      for (const entry of entries) {
        if (results.length >= maxEntries) {
          return;
        }

        const childRelative =
          relative === "."
            ? entry.name
            : `${relative}/${entry.name}`;

        if (denied(childRelative)) {
          continue;
        }

        const absoluteChild = path.join(
          absolute,
          entry.name,
        );
        const metadata = await stat(absoluteChild);

        results.push(
          Object.freeze({
            path: childRelative,
            type: entry.isDirectory()
              ? "directory"
              : "file",
            sizeBytes: entry.isDirectory()
              ? null
              : metadata.size,
            modifiedAt: metadata.mtime.toISOString(),
          }),
        );

        if (
          entry.isDirectory() &&
          remainingDepth > 0
        ) {
          await visit(
            absoluteChild,
            childRelative,
            remainingDepth - 1,
          );
        }
      }
    };

    const metadata = await stat(resolved.target);

    if (metadata.isDirectory()) {
      await visit(
        resolved.target,
        resolved.relative,
        depth,
      );
    } else {
      results.push(
        Object.freeze({
          path: resolved.relative,
          type: "file",
          sizeBytes: metadata.size,
          modifiedAt: metadata.mtime.toISOString(),
        }),
      );
    }

    return Object.freeze(results);
  }

  async readText(
    rootPath: string,
    relativePath: string,
    maxChars = 60_000,
  ): Promise<WorkspaceFileContent> {
    if (
      !Number.isInteger(maxChars) ||
      maxChars < 1_000 ||
      maxChars > 200_000
    ) {
      throw new Error(
        "maxChars must be between 1000 and 200000",
      );
    }

    const resolved = await resolveInsideRoot(
      rootPath,
      relativePath,
    );
    const metadata = await stat(resolved.target);

    if (!metadata.isFile()) {
      throw new Error("Requested path is not a file");
    }

    if (metadata.size > 1_000_000) {
      throw new Error(
        "Files larger than 1 MB cannot be read",
      );
    }

    const buffer = await readFile(resolved.target);

    if (buffer.includes(0)) {
      throw new Error("Binary files cannot be read");
    }

    const text = buffer.toString("utf8");

    return Object.freeze({
      path: resolved.relative,
      sizeBytes: metadata.size,
      truncated: text.length > maxChars,
      content: text.slice(0, maxChars),
    });
  }
}