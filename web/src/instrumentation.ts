import * as Sentry from "@sentry/nextjs";
import { SENTRY_OPTIONS } from "./lib/sentry-options";

// Server and edge error reporting (Sentry). Inert without a DSN — see
// lib/sentry-options.ts.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init(SENTRY_OPTIONS);
  }
}

// Errors thrown while rendering Server Components, route handlers and server
// actions — including the deliberate 500s from requireSupabaseServiceClient.
export const onRequestError = Sentry.captureRequestError;
