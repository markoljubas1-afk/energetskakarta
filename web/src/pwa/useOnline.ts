import { useSyncExternalStore } from "react";

import { isDataSourceMessage } from "./dataSource";

/** where the worker last said the data came from; "network" until it says otherwise */
let lastSource: "network" | "cache" = "network";
const subscribers = new Set<() => void>();

type WorkerMessages = Pick<ServiceWorkerContainer, "addEventListener" | "startMessages">;

/**
 * Listens to the service worker from the moment the app's code loads, not from when the map mounts: the data
 * index is read (and, offline, served from a kept copy) before the map exists, and the browser delivers the
 * worker's messages as soon as the document has loaded, to whoever listens then (a real offline test found the
 * first one lost, 59-B).
 */
export function listenToWorker(workers: WorkerMessages | null | undefined): void {
  if (!workers) return;
  workers.addEventListener("message", (event: MessageEvent) => {
    if (!isDataSourceMessage(event.data)) return;
    lastSource = event.data.source;
    subscribers.forEach((notify) => {
      notify();
    });
  });
  workers.startMessages();
}

if (typeof navigator !== "undefined" && "serviceWorker" in navigator) listenToWorker(navigator.serviceWorker);

function subscribe(onChange: () => void): () => void {
  subscribers.add(onChange);
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    subscribers.delete(onChange);
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Whether the map's data is live (Faza 59): the browser has a network, and the service worker did not just serve
 * its kept copies because that network reached nothing. False means the map shows the last data seen.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine && lastSource === "network");
}
