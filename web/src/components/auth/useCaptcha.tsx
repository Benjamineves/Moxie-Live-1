"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CAPTCHA } from "@/lib/captcha-config";

type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SCRIPT_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scriptPromise = null;
        reject(new Error("Turnstile failed to load"));
      };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

/**
 * Turnstile for an auth form, behind lib/captcha-config.ts's switch.
 *
 * Off: `ready` is always true, `token` is undefined, `widget` is null — the
 * form's Supabase call is exactly what it was before.
 * On: `ready` once a token exists. Tokens are single-use, so call `reset()`
 * after every attempt, successful or not.
 */
export function useCaptcha(): {
  enabled: boolean;
  ready: boolean;
  token: string | undefined;
  reset: () => void;
  widget: ReactNode;
  configError: string | null;
} {
  const [token, setToken] = useState<string | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  // A callback ref, not useRef: a form can move the widget between branches
  // (forgot-password's Resend screen), and a new node must get a new widget.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);
  const siteKey = CAPTCHA.enabled ? CAPTCHA.siteKey : null;

  useEffect(() => {
    if (!CAPTCHA.enabled || !siteKey) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !node || !window.turnstile || widgetId.current) return;
        widgetId.current = window.turnstile.render(node, {
          sitekey: siteKey,
          callback: (t: string) => setToken(t),
          "expired-callback": () => setToken(undefined),
          "error-callback": () => setToken(undefined),
        });
      })
      .catch(() => setLoadError("The security check couldn't load. Check your connection and reload the page."));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
      setToken(undefined);
    };
  }, [siteKey, node]);

  const reset = useCallback(() => {
    setToken(undefined);
    if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
  }, []);

  if (!CAPTCHA.enabled) {
    return { enabled: false, ready: true, token: undefined, reset, widget: null, configError: null };
  }
  const configError = !siteKey
    ? "Sign-in is misconfigured (security check has no site key). Please try again later."
    : loadError;
  return {
    enabled: true,
    ready: !!token,
    token,
    reset,
    widget: <div ref={setNode} className="min-h-[65px]" />,
    configError,
  };
}
