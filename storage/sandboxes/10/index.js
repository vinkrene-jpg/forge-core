export function formatLesson(runId, outcome) {
  if (typeof runId !== 'number') throw new TypeError('runId must be a number');
  return { title: `Run #${runId}: ${outcome}`, recordedAt: new Date().toISOString() };
}
