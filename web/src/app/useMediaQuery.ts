import { useCallback, useMemo, useSyncExternalStore } from "react";

/** Whether a CSS media query holds, followed live (a window resized, a preference changed). */
export function useMediaQuery(media: string): boolean {
  const query = useMemo(() => window.matchMedia(media), [media]);
  const subscribe = useCallback(
    (onChange: () => void) => {
      query.addEventListener("change", onChange);
      return () => {
        query.removeEventListener("change", onChange);
      };
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => query.matches);
}
