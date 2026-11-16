import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { renderNotFound, renderPage } from "../src/seo/html";
import { buildPages } from "../src/seo/pages";
import { bareSite } from "../src/seo/site.fixture";
import { contentSecurityPolicy, headersFile, STATIC_STYLE_HASH } from "./securityHeaders";

/** The SHA-256 the browser computes for the text of every inline <style> in a page. */
function inlineStyleHashes(html: string): string[] {
  return [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(
    (match) =>
      `'sha256-${createHash("sha256")
        .update(match[1] ?? "", "utf8")
        .digest("base64")}'`,
  );
}

describe("content security policy", () => {
  it("allows exactly the configured data origin and MapTiler", () => {
    const csp = contentSecurityPolicy("https://podaci.example.hr/");
    expect(csp).toContain(
      "connect-src 'self' https://podaci.example.hr https://api.maptiler.com https://cloudflareinsights.com https://api.open-meteo.com https://archive-api.open-meteo.com;",
    );
    // Cloudflare Web Analytics, and nothing else, may add a script (decision 2026-11-08)
    expect(csp).toContain("script-src 'self' https://static.cloudflareinsights.com;");
    expect(csp).toContain("frame-ancestors *"); // embedding is a feature (?embed=1)
  });

  it("needs no extra origin for same-origin data", () => {
    expect(contentSecurityPolicy("/local-data/")).toContain(
      "connect-src 'self' https://api.maptiler.com https://cloudflareinsights.com https://api.open-meteo.com https://archive-api.open-meteo.com;",
    );
  });

  it("marks hashed assets immutable", () => {
    expect(headersFile("/d/")).toMatch(
      /\/assets\/\*\n {2}Cache-Control: public, max-age=31536000, immutable/,
    );
  });

  it("allows the static pages' own stylesheet by its hash, and no other inline style", () => {
    const csp = contentSecurityPolicy("/d/");
    expect(csp).toContain(`style-src 'self' ${STATIC_STYLE_HASH};`);
    expect(csp).not.toContain("unsafe-inline");
    const site = bareSite();
    const pages = buildPages(site);
    expect(pages.length).toBeGreaterThan(0);
    for (const html of [...pages.map((page) => renderPage(page, site)), renderNotFound(site)]) {
      const hashes = inlineStyleHashes(html);
      expect(hashes).toHaveLength(1);
      expect(hashes[0]).toBe(STATIC_STYLE_HASH);
      expect(html).not.toMatch(/\sstyle="/);
    }
  });
  it("lets images come from the data bucket, where the photographs of plants are kept", () => {
    const policy = contentSecurityPolicy("https://podaci.test/");
    expect(policy).toMatch(
      /img-src 'self' data: blob: https:\/\/api\.maptiler\.com https:\/\/podaci\.test(;|$)/,
    );
    // same origin in development: nothing is added, and nothing is repeated
    expect(contentSecurityPolicy("/local-data/")).toMatch(
      /img-src 'self' data: blob: https:\/\/api\.maptiler\.com(;|$)/,
    );
  });
});
