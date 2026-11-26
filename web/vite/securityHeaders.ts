/**
 * Writes Cloudflare Pages `_headers` at build time. The content security policy only allows the data
 * origin that this build is configured for, plus MapTiler.
 */
import { createHash } from "node:crypto";

import type { Plugin } from "vite";

import { WEATHER_ORIGINS } from "../src/data/weatherOrigins";
import { STATIC_STYLE } from "../src/seo/style";

export const MAPTILER_ORIGIN = "https://api.maptiler.com";
/**
 * Cloudflare Web Analytics (decision 2026-11-08): no cookies, no personal data. When it is switched on for the
 * Pages project, Cloudflare adds its beacon script to every page; it loads from the first origin and reports
 * to the second.
 */
export const ANALYTICS_SCRIPT_ORIGIN = "https://static.cloudflareinsights.com";
export const ANALYTICS_REPORT_ORIGIN = "https://cloudflareinsights.com";

/**
 * The static pages carry their stylesheet inline (src/seo/style.ts); the policy allows exactly that stylesheet by
 * its hash, and no other inline style (Faza 31: with plain `style-src 'self'` every static page lost its styles).
 */
export const STATIC_STYLE_HASH = `'sha256-${createHash("sha256").update(STATIC_STYLE, "utf8").digest("base64")}'`;

export function dataOrigin(dataBaseUrl: string): string | null {
  try {
    return new URL(dataBaseUrl).origin;
  } catch {
    return null; // relative URL: same origin
  }
}

export function contentSecurityPolicy(dataBaseUrl: string): string {
  const origins = [
    "'self'",
    dataOrigin(dataBaseUrl),
    MAPTILER_ORIGIN,
    ANALYTICS_REPORT_ORIGIN,
    ...WEATHER_ORIGINS,
  ].filter((origin): origin is string => origin !== null);
  const unique = [...new Set(origins)].join(" ");
  return [
    "default-src 'self'",
    `script-src 'self' ${ANALYTICS_SCRIPT_ORIGIN}`,
    `style-src 'self' ${STATIC_STYLE_HASH}`,
    "font-src 'self'",
    // the data origin too: photographs of plants are copies kept in the bucket (src/data/images.ts)
    `img-src ${[...new Set(["'self'", "data:", "blob:", MAPTILER_ORIGIN, dataOrigin(dataBaseUrl)].filter(Boolean))].join(" ")}`,
    `connect-src ${unique}`,
    // MapLibre runs its workers from blob URLs
    "worker-src 'self' blob:",
    "child-src blob:",
    "object-src 'none'",
    "base-uri 'self'",
    // Anyone may put the map in an iframe (?embed=1): the site has no login and no action that a
    // clickjacked visitor could be tricked into, and every embed links back to the full site.
    "frame-ancestors *",
    "form-action 'none'",
  ].join("; ");
}

export function headersFile(dataBaseUrl: string): string {
  return [
    "/*",
    `  Content-Security-Policy: ${contentSecurityPolicy(dataBaseUrl)}`,
    "  X-Content-Type-Options: nosniff",
    "  Referrer-Policy: strict-origin-when-cross-origin",
    // location only on our own pages, and only when the visitor asks for "near me"; never inside embeds
    "  Permissions-Policy: geolocation=(self), camera=(), microphone=()",
    "  Cross-Origin-Opener-Policy: same-origin",
    "/assets/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    // the service worker (Faza 59): its fixed name must never be served from a cache, or a release waits
    "/sw.js",
    "  Cache-Control: no-cache",
    // the static pages' font (Faza 54-1): fixed names, so kept a month rather than for ever
    "/fonts/*",
    "  Cache-Control: public, max-age=2592000",
    // the open JSON files: any site may read them, and they change once per data build
    "/api/*",
    "  Access-Control-Allow-Origin: *",
    "  Cache-Control: public, max-age=3600",
    // the Markdown twins of the pages (16-C2): readable as text, by any site or assistant
    "/*.md",
    "  Content-Type: text/markdown; charset=utf-8",
    "  Access-Control-Allow-Origin: *",
    // the same site answers on Cloudflare's own address too; only the real one belongs in search results
    // (Faza 47-6; the pattern is the one in Cloudflare's documentation of _headers)
    "https://:project.pages.dev/*",
    "  X-Robots-Tag: noindex",
    "",
  ].join("\n");
}

export function securityHeaders(dataBaseUrl: string): Plugin {
  return {
    name: "energymap-security-headers",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "_headers", source: headersFile(dataBaseUrl) });
    },
  };
}
