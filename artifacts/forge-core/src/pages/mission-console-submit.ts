import { forgeApi } from "../lib/forge-api";
import {
  operatorApi,
  type CreateMissionRequest,
} from "../lib/operator-api";

export interface MissionConsoleRequestDiagnostic {
  readonly endpoint: string;
  readonly body: Readonly<Record<string, unknown>>;
}

function extractLabeledTarget(rawObjective: string): string | null {
  const pathLines = rawObjective
    .split(/\r?\n/)
    .map((line) => line.match(/^Pad:\s*(\S+)\s*$/i)?.[1] ?? null)
    .filter((path): path is string => path !== null);
  const uniquePaths = [...new Set(pathLines)];

  if (uniquePaths.length === 0) {
    return null;
  }

  if (uniquePaths.length !== 1) {
    throw new Error(
      "Mission Console requires exactly one unambiguous Pad target",
    );
  }

  const targetPath = uniquePaths[0];
  const segments = targetPath.split("/");

  if (
    segments.length < 2 ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === "..",
    )
  ) {
    throw new Error(
      "Mission Console target must preserve all repository directory components",
    );
  }

  return targetPath;
}

export function buildMissionConsoleCreateRequest(
  rawObjective: string,
  previewRequest: CreateMissionRequest,
): CreateMissionRequest {
  const targetPath = extractLabeledTarget(rawObjective);

  if (targetPath === null) {
    return Object.freeze({
      ...previewRequest,
      input: Object.freeze({
        ...previewRequest.input,
        rawObjective,
      }),
    });
  }

  const request = Object.freeze({
    ...previewRequest,
    input: Object.freeze({
      ...previewRequest.input,
      rawObjective,
      targets: Object.freeze([
        Object.freeze({
          path: targetPath,
          allowCreate: true,
        }),
      ]),
      objectiveExecutionMode: "build-or-mutate",
      objectiveProfile: "generic-build",
      intakeObjectiveExecutionMode: "build-or-mutate",
      intakeObjectiveProfile: "generic-build",
      proofTargetPath: targetPath,
    }),
  });
  const canonicalTarget = (
    request.input.targets as readonly {
      readonly path: string;
      readonly allowCreate: boolean;
    }[]
  )[0];

  if (
    canonicalTarget.path !== targetPath ||
    canonicalTarget.allowCreate !== true ||
    request.input.proofTargetPath !== targetPath
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
