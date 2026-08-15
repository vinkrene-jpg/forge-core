import { forgeApi } from "../lib/forge-api";
import {
  operatorApi,
  type CreateMissionRequest,
} from "../lib/operator-api";

export interface MissionConsoleRequestDiagnostic {
  readonly endpoint: string;
  readonly body: Readonly<Record<string, unknown>>;
}

function extractLabeledTargets(rawObjective: string): readonly string[] {
  const allowedRoots = new Set(["sandbox", "lib", "artifacts"]);
  const pathLines = rawObjective
    .split(/\r?\n/)
    .map((line) => line.match(/^Pad:\s*(\S+)\s*$/i)?.[1] ?? null)
    .filter((path): path is string => path !== null);
  const uniquePaths = [...new Set(pathLines)];

  if (uniquePaths.length === 0) {
    return Object.freeze([]);
  }

  for (const targetPath of uniquePaths) {
    const segments = targetPath.replaceAll("\\", "/").split("/");
    if (
      !allowedRoots.has(segments[0]?.toLowerCase() ?? "") ||
      segments.length < 2 ||
      segments.some(
        (segment) =>
          segment.length === 0 ||
          segment === "." ||
          segment === "..",
      )
    ) {
      throw new Error("Mission Console targets must remain inside sandbox/, lib/, or artifacts/");
    }
  }

  return Object.freeze(uniquePaths.map((targetPath) => targetPath.replaceAll("\\", "/")));
}

export function buildMissionConsoleCreateRequest(
  rawObjective: string,
  previewRequest: CreateMissionRequest,
): CreateMissionRequest {
  const targetPaths = extractLabeledTargets(rawObjective);

  if (targetPaths.length === 0) {
    return Object.freeze({
      ...previewRequest,
      input: Object.freeze({
        ...previewRequest.input,
        rawObjective,
      }),
    });
  }

  const requestInput: Readonly<Record<string, unknown>> = Object.freeze({
      ...previewRequest.input,
      rawObjective,
      targets: Object.freeze(targetPaths.map((targetPath) =>
        Object.freeze({ path: targetPath, allowCreate: true })
      )),
      objectiveExecutionMode: "build-or-mutate",
      objectiveProfile: "generic-build",
      intakeObjectiveExecutionMode: "build-or-mutate",
      intakeObjectiveProfile: "generic-build",
      ...(targetPaths.length === 1
        ? { proofTargetPath: targetPaths[0] }
        : { proofTargetPath: undefined, proofTargetPaths: targetPaths }),
  });
  const request: CreateMissionRequest = Object.freeze({
    ...previewRequest,
    input: requestInput,
  });
  const canonicalTargets = (
    requestInput.targets as readonly {
      readonly path: string;
      readonly allowCreate: boolean;
    }[]
  );

  if (
    canonicalTargets.length !== targetPaths.length ||
    canonicalTargets.some((target, index) =>
      target.path !== targetPaths[index] || target.allowCreate !== true
    ) ||
    (targetPaths.length === 1
      ? requestInput.proofTargetPath !== targetPaths[0] || requestInput.proofTargetPaths !== undefined
      : requestInput.proofTargetPath !== undefined ||
        JSON.stringify(requestInput.proofTargetPaths) !== JSON.stringify(targetPaths))
  ) {
    throw new Error(
      "Mission Console refused a request that discarded target directory components",
    );
  }

  return request;
}

export async function startMissionFromCurrentIntake(
  rawObjective: string,
  onRequest?: (diagnostic: MissionConsoleRequestDiagnostic) => void,
) {
  onRequest?.({
    endpoint: "/api/operator/mission-intake/preview",
    body: { command: rawObjective },
  });
  const preview = await operatorApi.missionIntakePreview(rawObjective);
  const createRequest = buildMissionConsoleCreateRequest(
    rawObjective,
    preview.request,
  );

  onRequest?.({
    endpoint: "/api/missions",
    body: createRequest as unknown as Readonly<Record<string, unknown>>,
  });
  const mission = await forgeApi.createMission(createRequest);

  return Object.freeze({
    preview,
    mission,
    governance: mission.governance,
    approval: mission.approval,
    progress: mission.status === "awaiting_approval" ? 20 : 35,
  });
}

export function handleMissionConsoleSubmit(
  rawObjective: string,
  submit: (
    currentRawObjective: string,
    onRequest?: (diagnostic: MissionConsoleRequestDiagnostic) => void,
  ) => ReturnType<typeof startMissionFromCurrentIntake> =
    startMissionFromCurrentIntake,
  onRequest?: (diagnostic: MissionConsoleRequestDiagnostic) => void,
) {
  return submit(rawObjective, onRequest);
}
