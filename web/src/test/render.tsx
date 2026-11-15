import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

import { I18nProvider } from "../i18n";
import type { Lang } from "../state/url";

export function renderWithI18n(ui: ReactElement, lang: Lang = "hr"): RenderResult {
  return render(<I18nProvider lang={lang}>{ui}</I18nProvider>);
}

export function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

/** A fetch stand-in that answers by URL suffix with a fresh Response every time. */
export function routeFetch(routes: Record<string, unknown>): (input: RequestInfo | URL) => Promise<Response> {
  return (input) => {
    const url = input instanceof Request ? input.url : String(input);
    const path = new URL(url).pathname;
    const match = Object.entries(routes).find(([suffix]) => path.endsWith(suffix));
    return Promise.resolve(match ? jsonResponse(match[1]) : new Response("not found", { status: 404 }));
  };
}
