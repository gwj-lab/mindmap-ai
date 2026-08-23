export function isTrustedIpcSender(actual: unknown, expected: unknown): boolean {
  return actual !== null && actual === expected;
}
