/**
 * IndexNow (https://www.indexnow.org/documentation): one POST tells Bing, Yandex, Seznam, Naver and
 * their partners which pages changed, instead of waiting for a crawl. Google does not take part; for
 * Google the sitemap and Search Console remain the way.
 *
 * The key is not a secret: it must be served as `https://<site>/<key>.txt`, which is how the engines
 * know the sender owns the site. It still lives in a GitHub variable rather than in the repository, so
 * every deployment of this code can use its own.
 */

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
/** the protocol's limit per request */
export const INDEXNOW_MAX_URLS = 10_000;
/** 8–128 characters, hexadecimal or dashes: the protocol's rule for a key */
const KEY = /^[a-fA-F0-9-]{8,128}$/;

export function isValidKey(key: string | undefined): key is string {
  return key !== undefined && KEY.test(key);
}

export function keyFileName(key: string): string {
  return `${key}.txt`;
}

export interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

/** One payload per 10 000 URLs; every URL must belong to `siteUrl`, anything else is left out. */
export function indexNowPayloads(siteUrl: string, key: string, urls: readonly string[]): IndexNowPayload[] {
  const site = new URL(siteUrl);
  const own = [...new Set(urls)].filter((url) => {
    try {
      return new URL(url).host === site.host;
    } catch {
      return false;
    }
  });
  const payloads: IndexNowPayload[] = [];
  for (let i = 0; i < own.length; i += INDEXNOW_MAX_URLS) {
    payloads.push({
      host: site.host,
      key,
      keyLocation: `${site.origin}/${keyFileName(key)}`,
      urlList: own.slice(i, i + INDEXNOW_MAX_URLS),
    });
  }
  return payloads;
}

/** Every `<loc>` of a sitemap or sitemap index, in order. */
export function sitemapLocations(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => decodeEntities(match[1] ?? ""));
}

function decodeEntities(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

/** What an engine's answer means; 200 and 202 both mean "accepted" in the protocol. */
export function describeResponse(
  status: number,
): "accepted" | "bad-request" | "key-rejected" | "throttled" | "failed" {
  if (status === 200 || status === 202) return "accepted";
  if (status === 400) return "bad-request";
  if (status === 403 || status === 422) return "key-rejected";
  if (status === 429) return "throttled";
  return "failed";
}
