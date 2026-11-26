import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans-condensed/600.css";
import "./app/tokens.css";

// before anything parses: no `new Function` probe for the CSP to report
import "./zodSetup";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { AppErrorScreen, ConfigErrorScreen } from "./app/Screens";
import { ConfigError, readConfig, type AppConfig } from "./config";
import { registerServiceWorker } from "./pwa/register";
import { canonicalUrl } from "./state/url";

const root = document.getElementById("root");
if (!root) throw new Error("#root element is missing from index.html");

// Old links carried the language as ?lang=en; move it into the path (/en/) before anything reads the URL.
const canonical = canonicalUrl(window.location.pathname, window.location.search);
if (canonical) window.history.replaceState(null, "", `${canonical}${window.location.hash}`);

let config: AppConfig | null = null;
try {
  config = readConfig(import.meta.env, window.location.href);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error("[config]", error.message);
}

// each part of the page has its own boundary (App.tsx); this one catches what fails outside them (Faza 56, 4.3)
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary area="app" fallback={() => <AppErrorScreen />}>
      {config ? <App config={config} /> : <ConfigErrorScreen />}
    </ErrorBoundary>
  </StrictMode>,
);

// installable, and the last release and data seen open without a network (Faza 59)
registerServiceWorker(import.meta.env.PROD);
