import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface FetchedDependency {
  readonly name: string;
  readonly version: string;
  readonly resolved: string;
  readonly integrity: string | null;
  readonly license: string | null;
  readonly requestedBy: string;
  readonly fetchedAt: string;
}

export interface DependencyFetchRequest {
  readonly repositoryRoot: string;
  readonly workspace: string;
  readonly name: string;
  readonly requestedBy: string;
}

interface RegistryPackument {
  readonly "dist-tags"?: { readonly latest?: string };
  readonly versions?: Record<
    string,
    {
      readonly license?: string;
      readonly dist?: { readonly tarball?: string; readonly integrity?: string };
    }
  >;
}

const PUBLIC_REGISTRY = "https://registry.npmjs.org";

function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<{ readonly code: number; readonly output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      shell: process.platform === "win32",
    });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

async function appendFetchRecord(
  repositoryRoot: string,
  record: FetchedDependency,
): Promise<void> {
  const directory = path.join(repositoryRoot, "reconstruction", "proofs");
  const file = path.join(directory, "DEPENDENCY_FETCH_LOG.json");
  await mkdir(directory, { recursive: true });
  let existing: FetchedDependency[] = [];
  try {
    existing = JSON.parse(await readFile(file, "utf8")) as FetchedDependency[];
  } catch {
    existing = [];
  }
  existing.push(record);
  await writeFile(file, JSON.stringify(existing, null, 2) + "\n", "utf8");
}

export async function fetchDependency(
  request: DependencyFetchRequest,
): Promise<FetchedDependency> {
  const { repositoryRoot, workspace, name, requestedBy } = request;

  if (name.includes("://") || name.startsWith("git+") || name.startsWith("file:")) {
    throw new Error("Only public npm package names are allowed: " + name);
  }

  const registryPath = name.startsWith("@") ? name.replace("/", "%2F") : name;
  const response = await fetch(PUBLIC_REGISTRY + "/" + registryPath);

  if (response.status === 401 || response.status === 402 || response.status === 403) {
    throw new Error("Package requires an account or payment and is refused: " + name);
  }
  if (!response.ok) {
    throw new Error("Package not found on the public registry: " + name);
  }

  const packument = (await response.json()) as RegistryPackument;
  const version = packument["dist-tags"]?.latest;
  if (!version) {
    throw new Error("Package has no published version: " + name);
  }
  const meta = packument.versions?.[version];

  const install = await runCommand(
    "pnpm",
    ["--filter", workspace, "add", "--ignore-scripts", name + "@" + version],
    repositoryRoot,
  );
  if (install.code !== 0) {
    throw new Error("Fetching " + name + "@" + version + " failed:\n" + install.output);
  }

  const record: FetchedDependency = Object.freeze({
    name,
    version,
    resolved: meta?.dist?.tarball ?? PUBLIC_REGISTRY + "/" + name,
    integrity: meta?.dist?.integrity ?? null,
    license: meta?.license ?? null,
    requestedBy,
    fetchedAt: new Date().toISOString(),
  });

  await appendFetchRecord(repositoryRoot, record);
  return record;
}
