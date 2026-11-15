import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { localDataHandler, parseRange } from "./localData";

describe("parseRange", () => {
  it.each([
    [undefined, null],
    ["bytes=0-126", { start: 0, end: 126 }],
    ["bytes=100-", { start: 100, end: 999 }],
    ["bytes=-10", { start: 990, end: 999 }],
    ["bytes=900-5000", { start: 900, end: 999 }],
    ["bytes=1000-", "invalid"],
    ["bytes=5-1", "invalid"],
    ["bytes=-0", "invalid"],
    ["bytes=0-1,5-6", "invalid"],
    ["items=0-1", "invalid"],
  ])("%s → %j", (header, expected) => {
    expect(parseRange(header, 1000)).toEqual(expected);
  });
});

function call(root: string, url: string, headers: Record<string, string> = {}, method = "GET") {
  const req = { url, method, headers } as unknown as IncomingMessage;
  const body = new PassThrough();
  const chunks: Buffer[] = [];
  body.on("data", (chunk: Buffer) => chunks.push(chunk));
  const recorded: { statusCode: number; headers: Record<string, unknown> } = { statusCode: 0, headers: {} };
  const res = Object.assign(body, {
    ...recorded,
    writeHead(status: number, h: Record<string, unknown> = {}) {
      res.statusCode = status;
      res.headers = h;
      return res;
    },
  }) as unknown as ServerResponse & { statusCode: number; headers: Record<string, unknown> };
  const next = vi.fn();
  localDataHandler(root)(req, res, next);
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string; next: boolean }>(
    (resolve) => {
      if (next.mock.calls.length > 0) {
        resolve({ status: 0, headers: {}, body: "", next: true });
        return;
      }
      body.on("finish", () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString(),
          next: false,
        });
      });
    },
  );
}

describe("localDataHandler", () => {
  const root = mkdtempSync(path.join(tmpdir(), "local-data-"));
  mkdirSync(path.join(root, "builds"));
  writeFileSync(path.join(root, "builds", "grid.pmtiles"), "0123456789");
  writeFileSync(path.join(root, "current.json"), "{}");

  it("ignores other paths", async () => {
    expect((await call(root, "/index.html")).next).toBe(true);
  });

  it("serves byte ranges for PMTiles", async () => {
    const result = await call(root, "/local-data/builds/grid.pmtiles", { range: "bytes=2-4" });
    expect(result.status).toBe(206);
    expect(result.body).toBe("234");
    expect(result.headers).toMatchObject({ "Content-Range": "bytes 2-4/10", "Accept-Ranges": "bytes" });
  });

  it("serves whole files and never caches the pointer", async () => {
    const result = await call(root, "/local-data/current.json");
    expect(result.status).toBe(200);
    expect(result.headers["Cache-Control"]).toBe("no-cache");
  });

  it("answers HEAD without a body", async () => {
    const result = await call(root, "/local-data/current.json", {}, "HEAD");
    expect(result.status).toBe(200);
    expect(result.body).toBe("");
  });

  it.each([
    ["/local-data/..%2F..%2Fetc%2Fpasswd", 403],
    ["/local-data/missing.json", 404],
    ["/local-data/builds", 404],
  ])("rejects %s with %i", async (url, status) => {
    expect((await call(root, url)).status).toBe(status);
  });

  it("rejects unsatisfiable ranges and other methods", async () => {
    expect((await call(root, "/local-data/builds/grid.pmtiles", { range: "bytes=50-" })).status).toBe(416);
    expect((await call(root, "/local-data/current.json", {}, "POST")).status).toBe(405);
  });
});
