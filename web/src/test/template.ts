import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The site's index.html, which the prerender tests fill in. Resolved as a path, not as `new URL(...)`: under
 * jsdom the global URL is the browser's, and it does not resolve against the module's file: address.
 */
export function readTemplate(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return readFileSync(path.join(here, "..", "..", "index.html"), "utf8");
}
