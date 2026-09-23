/** Validators for persisted navigation/preferences; no UI or platform dependencies. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}
export function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}
