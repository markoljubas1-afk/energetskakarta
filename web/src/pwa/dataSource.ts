/**
 * The service worker's word to the page on where the data it just served came from (Faza 59). The browser's own
 * `navigator.onLine` says "connected" on a Wi-Fi that reaches nothing; the worker knows that the network failed
 * and a kept copy was served instead.
 */
export const DATA_SOURCE_MESSAGE = "gridatlas:data-source";

export interface DataSourceMessage {
  type: typeof DATA_SOURCE_MESSAGE;
  source: "network" | "cache";
}

export function isDataSourceMessage(value: unknown): value is DataSourceMessage {
  if (typeof value !== "object" || value === null) return false;
  const { type, source } = value as Record<string, unknown>;
  return type === DATA_SOURCE_MESSAGE && (source === "network" || source === "cache");
}
