/** Addresses of the open JSON files (api.ts writes them, pages.ts links to them from each page's head). */
export const API_PATHS = {
  index: "/api/index.json",
  country: (code: string) => `/api/zemlja/${code}.json`,
  asset: (slug: string) => `/api/objekt/${slug}.json`,
  cities: "/api/gradovi.json",
  docs: { hr: "/api/", en: "/en/api/" } as const,
};
