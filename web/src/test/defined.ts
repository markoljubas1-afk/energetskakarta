/** The value, or a failed test when it is missing: a typed stand-in for `!` in tests. */
export function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("expected a value, got none");
  return value;
}
