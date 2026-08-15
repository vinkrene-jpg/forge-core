export function formatSourceMutationProof(value: string): string {
  return `forge-source:${value.trim().toLowerCase()}`;
}