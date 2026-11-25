/**
 * Parts of the app that arrive later (the map, the energy and compare pages, their charts) as separate files.
 * React's `lazy` remembers a failed load and throws the same error on every later render, and a new deploy
 * renames the files, so such a failure is never retried in place: the page is loaded again (Faza 56, 4.3).
 */

/** A separately loaded part of the code did not arrive (network, or a deploy renamed it). */
export class ChunkLoadError extends Error {
  constructor(cause: unknown) {
    super("a part of the page could not be loaded", { cause });
    this.name = "ChunkLoadError";
  }
}

/** `load()`, with a failure marked as ChunkLoadError so error boundaries know a retry means a reload. */
export function loadChunk<T>(load: () => Promise<T>): Promise<T> {
  return load().catch((cause: unknown) => {
    throw new ChunkLoadError(cause);
  });
}

/** Its own function so tests can stand in for it (jsdom cannot reload). */
export function reloadPage(): void {
  window.location.reload();
}
