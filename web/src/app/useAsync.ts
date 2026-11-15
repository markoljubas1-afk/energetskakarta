import { useCallback, useEffect, useState } from "react";

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "ready"; value: T };

export interface AsyncOptions {
  /**
   * Reload in the background this often (ms) while the page is visible, and when the visitor comes back to a
   * tab whose copy is older than that. The current value stays on screen during a reload; a failed reload
   * keeps the last good copy (and logs), so a network blip never blanks a panel (Faza 18-1).
   */
  refreshMs?: number;
}

/**
 * Run `load` whenever `key` changes (or `retry` is called). Aborts stale requests so a slow response can
 * never overwrite a newer one. Pass `key = null` to stay idle.
 */
export function useAsync<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  options: AsyncOptions = {},
): [AsyncState<T> | null, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; attempt: number; value: AsyncState<T> } | null>(null);

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    // No "loading" setState here: a request whose result is not stored yet is derived as loading below.
    load(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setState({ key, attempt, value: { status: "ready", value } });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const normalized = error instanceof Error ? error : new Error(String(error));
        console.error(`[data] ${key} failed`, normalized);
        setState({ key, attempt, value: { status: "error", error: normalized } });
      },
    );
    return () => {
      controller.abort();
    };
    // `load` is intentionally not a dependency: callers pass inline closures keyed by `key`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const refreshMs = options.refreshMs ?? 0;
  useEffect(() => {
    if (key === null || refreshMs <= 0) return;
    let controller: AbortController | null = null;
    let last = Date.now();
    const reload = (): void => {
      if (document.visibilityState !== "visible") return;
      controller?.abort();
      const own = new AbortController();
      controller = own;
      last = Date.now();
      load(own.signal).then(
        (value) => {
          if (own.signal.aborted) return;
          // only over a settled result of the same request: a first load still in flight wins
          setState((s) =>
            s?.key === key && s.attempt === attempt ? { key, attempt, value: { status: "ready", value } } : s,
          );
        },
        (error: unknown) => {
          if (own.signal.aborted) return;
          console.error(`[data] ${key} refresh failed; keeping the last good copy`, error);
        },
      );
    };
    const timer = window.setInterval(reload, refreshMs);
    const onVisible = (): void => {
      if (document.visibilityState === "visible" && Date.now() - last >= refreshMs) reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      controller?.abort();
    };
    // `load` is intentionally not a dependency, as above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt, refreshMs]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  if (key === null) return [null, retry];
  const current =
    state?.key === key && state.attempt === attempt ? state.value : { status: "loading" as const };
  return [current, retry];
}
