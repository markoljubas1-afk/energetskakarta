import { useSyncExternalStore } from "react";

import { isDataSourceMessage } from "./dataSource";

/** where the worker last said the data came from; "network" until it says otherwise */
let lastSource: "network" | "cache" = "network";

function subscribe(onChange: () => void): () => void {
  const onMessage = (event: MessageEvent): void => {
    if (!isDataSourceMessage(event.data)) return;
    lastSource = event.data.source;
    onChange();
  };
  const workers = "serviceWorker" in navigator ? navigator.serviceWorker : null;
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  workers?.addEventListener("message", onMessage);
  // messages the worker sent before this page listened wait in a queue until it is started
  workers?.startMessages();
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
    workers?.removeEventListener("message", onMessage);
  };
}

/**
 * Whether the map's data is live (Faza 59): the browser has a network, and the service worker did not just serve
 * its kept copies because that network reached nothing. False means the map shows the last data seen.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine && lastSource === "network");
}
