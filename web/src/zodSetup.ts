/**
 * Zod without its compiled fast path. Zod 4 probes once whether it may build functions with `new Function`;
 * our Content-Security-Policy forbids that (no 'unsafe-eval'), the probe's throw is caught, but the browser
 * still reports the blocked attempt as an error (Lighthouse: "Content Security Policy blocks the use of eval").
 * `jitless` skips the probe; parsing stays as strict, and the documents we parse are small.
 *
 * Imported first by every script that runs in the browser (main.tsx, widgets/learnLive.ts).
 */
import { z } from "zod";

z.config({ jitless: true });
