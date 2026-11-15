/**
 * An optional layer's data (Faza 26, from App.tsx): loaded only while the layer is on, and turned into map
 * features once a release is there. Gas, geothermal and HEP ODS capacity all work this way.
 */
import { useMemo } from "react";

import { useAsync, type AsyncState } from "./useAsync";

/** What every optional layer's loader returns: nothing published yet, or a release carrying `R`. */
export type OverlayLoad<R> = { kind: "none" } | ({ kind: "ready" } & R);

/**
 * `key` is null while the layer is off. `features` must be a stable function (defined outside the component):
 * a new one every render would rebuild the features, and with them the map's style, every render.
 */
export function useOverlay<R extends object, F>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<OverlayLoad<R>>,
  features: (loaded: R) => F,
): { data: AsyncState<OverlayLoad<R>> | null; retry: () => void; features: F | null } {
  const [data, retry] = useAsync(key, load);
  const on = key !== null;
  const value = useMemo(
    () => (on && data?.status === "ready" && data.value.kind === "ready" ? features(data.value) : null),
    [on, data, features],
  );
  return { data, retry, features: value };
}
