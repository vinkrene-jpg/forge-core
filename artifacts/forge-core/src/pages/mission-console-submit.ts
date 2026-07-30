import { forgeApi } from "../lib/forge-api";
import { operatorApi } from "../lib/operator-api";

export interface MissionConsoleRequestDiagnostic {
  readonly endpoint: string;
  readonly body: Readonly<Record<string, unknown>>;
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

  onRequest?.({
    endpoint: "/api/missions",
    body: preview.request as unknown as Readonly<Record<string, unknown>>,
  });
  const mission = await forgeApi.createMission(preview.request);

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
