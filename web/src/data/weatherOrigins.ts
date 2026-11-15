/**
 * Open-Meteo (Faza 19, "near me"): current weather and last year's sunshine for a rounded location the
 * visitor chose to share. Asked only from the browser, only after the visitor presses the button.
 *
 * Kept free of imports on purpose: the browser (weather.ts) and the build (vite/securityHeaders.ts, which
 * allows these origins in the content security policy) both read it, and the browser must never load a
 * module that needs Node.
 */
export const WEATHER_ORIGINS = ["https://api.open-meteo.com", "https://archive-api.open-meteo.com"] as const;
