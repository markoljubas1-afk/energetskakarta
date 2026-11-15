/**
 * Serves a local mirror of the data bucket (written by `energymap publish dir`) during development and
 * `vite preview`, including HTTP Range requests that PMTiles relies on.
 */
import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";

export const LOCAL_DATA_PREFIX = "/local-data/";

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".pmtiles": "application/vnd.pmtiles",
  ".gz": "application/gzip",
};

export interface ByteRange {
  start: number;
  end: number;
}

/** Parse a single-range `Range` header. Returns null when absent, "invalid" when unsatisfiable. */
export function parseRange(header: string | undefined, size: number): ByteRange | "invalid" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "invalid";
  const [, rawStart = "", rawEnd = ""] = match;
  if (rawStart === "" && rawEnd === "") return "invalid";
  let start: number;
  let end: number;
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }
  if (start > end || start >= size) return "invalid";
  return { start, end };
}

export function localDataHandler(root: string) {
  const base = path.resolve(root);
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const url = new URL(req.url ?? "/", "http://local");
    if (!url.pathname.startsWith(LOCAL_DATA_PREFIX)) {
      next();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    const relative = decodeURIComponent(url.pathname.slice(LOCAL_DATA_PREFIX.length));
    const file = path.resolve(base, relative);
    if (!file.startsWith(base + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    let size: number;
    try {
      const stats = statSync(file);
      if (!stats.isFile()) throw new Error("not a file");
      size = stats.size;
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" }).end(`Not found: ${relative}`);
      return;
    }

    const headers: Record<string, string | number> = {
      "Accept-Ranges": "bytes",
      "Content-Type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
      "Cache-Control": relative === "current.json" ? "no-cache" : "public, max-age=60",
      ETag: `"${size.toString(16)}"`,
    };
    const range = parseRange(req.headers.range, size);
    if (range === "invalid") {
      res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
      return;
    }
    const { start, end } = range ?? { start: 0, end: size - 1 };
    headers["Content-Length"] = end - start + 1;
    if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    res.writeHead(range ? 206 : 200, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file, { start, end }).pipe(res);
  };
}

export function localData(root: string): Plugin {
  return {
    name: "energymap-local-data",
    configureServer(server) {
      server.middlewares.use(localDataHandler(root));
    },
    configurePreviewServer(server) {
      server.middlewares.use(localDataHandler(root));
    },
  };
}
