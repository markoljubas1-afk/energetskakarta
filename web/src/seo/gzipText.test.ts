import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { loadGzipText } from "./prerender";

describe("reading a download of the bucket for the asset pages", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "energymap-"));
  const options = { siteUrl: null, dataBaseUrl: "/local-data/", localDataDir: dir };
  const line = '{"type":"Feature","properties":{"id":"osm:way/2","status":"operating"}}\n';

  it("unpacks a gzip file, and takes one that arrives unpacked as it is", async () => {
    writeFileSync(path.join(dir, "plants.ndjson.gz"), gzipSync(line));
    writeFileSync(path.join(dir, "plain.ndjson.gz"), line);
    expect(await loadGzipText(options, "plants.ndjson.gz")).toBe(line);
    expect(await loadGzipText(options, "plain.ndjson.gz")).toBe(line);
  });

  it("says a missing file is missing", async () => {
    expect(await loadGzipText(options, "nothing.ndjson.gz")).toBeNull();
  });
});
