import { forgeApi } from "../lib/forge-api";
import { operatorApi } from "../lib/operator-api";

export async function startMissionFromCurrentIntake(
  rawObjective: string,
) {
  const preview = await operatorApi.missionIntakePreview(rawObjective);
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
  ) => ReturnType<typeof startMissionFromCurrentIntake> =
    startMissionFromCurrentIntake,
) {
  return submit(rawObjective);
}
