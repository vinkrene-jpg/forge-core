export function jsonSafe<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}
