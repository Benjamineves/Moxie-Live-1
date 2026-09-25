import * as Sentry from "@sentry/nextjs";
import { SENTRY_OPTIONS } from "./lib/sentry-options";

// Browser error reporting (Sentry). Inert without a DSN — see
// lib/sentry-options.ts.
Sentry.init(SENTRY_OPTIONS);
