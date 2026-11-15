import { z } from "zod";

import { supportEnabled } from "./support";

const EnvSchema = z.object({
  VITE_DATA_BASE_URL: z.string().min(1, "VITE_DATA_BASE_URL is empty"),
  VITE_MAPTILER_KEY: z.string().optional(),
  VITE_SUPPORT: z.string().optional(),
});

export interface AppConfig {
  /** Absolute URL of the data bucket root, always ending with "/". */
  dataBaseUrl: URL;
  /** MapTiler key, or null to use the built-in fallback basemap. */
  maptilerKey: string | null;
  /** the "Support and partners" page is on (Faza 24): the app links it quietly */
  support: boolean;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

export function readConfig(env: Record<string, unknown>, pageUrl: string): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  const raw = parsed.data.VITE_DATA_BASE_URL;
  const dataBaseUrl = new URL(raw.endsWith("/") ? raw : `${raw}/`, pageUrl);
  const key = parsed.data.VITE_MAPTILER_KEY?.trim() ?? "";
  return {
    dataBaseUrl,
    maptilerKey: key === "" ? null : key,
    support: supportEnabled(parsed.data.VITE_SUPPORT),
  };
}
