import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExerciseRecord, ExerciseRunResult, ExerciseRunner, ExerciseSolutionFile } from "./exercise";

function safePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || path.isAbsolute(value) || normalized.split("/").includes("..")) throw new Error(`Unsafe exercise path: ${value}`);
  return normalized;
}

function aggregate(files: readonly { path: string; content: string }[]): string {
  return createHash("sha256").update(files.map((file) => `${file.path}\0${createHash("sha256").update(file.content).digest("hex")}`).sort().join("\n")).digest("hex");
}

async function command(executable: string, args: readonly string[], signal?: AbortSignal): Promise<{ exitCode: number; stdout: string; containerId: string | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, signal });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ exitCode: code ?? 1, stdout: stdout.slice(0, 500), containerId: /[a-f0-9]{64}/.exec(stdout)?.[0] ?? null }));
  });
}

export class DockerExerciseRunner implements ExerciseRunner {
  readonly #image: string;

  constructor(image = process.env.FORGE_EXERCISE_IMAGE?.trim() || process.env.FORGE_VERIFICATION_IMAGE?.trim() || "forge-verification:latest") {
    this.#image = image;
  }

  async run(exercise: ExerciseRecord, solutionFiles: readonly ExerciseSolutionFile[], signal: AbortSignal): Promise<ExerciseRunResult> {
    if (exercise.source.track !== "python") throw new Error(`No isolated exercise runner is registered for track ${exercise.source.track}`);
    const expectedPaths = [...exercise.starterFiles.map((file) => file.path)].sort();
    const actualPaths = [...solutionFiles.map((file) => safePath(file.path))].sort();
    if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) throw new Error("Exercise solution must contain exactly the declared upstream solution files");
    const testCommand = Object.freeze(["python3", "-B", "-m", "unittest", ...exercise.testFiles.map((file) => safePath(file.path))]);
    const inspected = await command("docker", ["image", "inspect", "--format", "{{.Id}}", this.#image], signal);
    const imageId = inspected.stdout.trim();
    if (inspected.exitCode !== 0 || !/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error(`Exercise image is unavailable: ${this.#image}`);
    const root = await mkdtemp(path.join(os.tmpdir(), "forge-exercise-run-"));
    try {
      for (const file of [...solutionFiles, ...exercise.testFiles]) {
        const target = path.join(root, safePath(file.path));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, file.content, "utf8");
      }
      const testsBefore = aggregate(exercise.testFiles);
      const started = Date.now();
      const result = await command("docker", [
        "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--memory", "512m", "--pids-limit", "128", "--mount", `type=bind,src=${root},dst=/exercise,readonly`,
        "--workdir", "/exercise", "--env", "PYTHONDONTWRITEBYTECODE=1", "--entrypoint", "python3", imageId,
        ...testCommand.slice(1),
      ], signal);
      const testsAfter = aggregate(await Promise.all(exercise.testFiles.map(async (file) => ({ path: file.path, content: await readFile(path.join(root, file.path), "utf8") }))));
      return Object.freeze({
        command: testCommand,
        exitCode: result.exitCode, durationMs: Date.now() - started, testsSha256Before: testsBefore, testsSha256After: testsAfter,
        image: imageId, containerId: result.containerId,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}