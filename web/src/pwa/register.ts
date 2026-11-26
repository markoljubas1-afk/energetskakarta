/**
 * Registers the service worker (sw.ts, Faza 59) after the page has loaded, so the worker's own downloads never
 * compete with the map's first data. Only in a production build: in development Vite serves changing modules.
 */
interface Registrar {
  serviceWorker?: { register: (url: string) => Promise<unknown> };
}

export function registerServiceWorker(
  production: boolean,
  nav: Registrar = navigator,
  win:
    | Pick<Window, "addEventListener">
    | { addEventListener: (type: "load", listener: () => void) => void } = window,
): void {
  const workers = nav.serviceWorker;
  if (!production || !workers) return;
  win.addEventListener("load", () => {
    workers.register("/sw.js").catch((error: unknown) => {
      // the site works as before, only without its offline copy
      console.warn("[pwa] the service worker was not registered", error);
    });
  });
}
