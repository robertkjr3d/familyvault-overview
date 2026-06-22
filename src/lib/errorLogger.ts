/**
 * errorLogger.ts
 *
 * Lightweight production error logging to Supabase.
 * Design rules:
 *   - NEVER throws. Errors in the logger must not cause further crashes.
 *   - Silently skips when the user is not authenticated (RLS would block it anyway).
 *   - Caps string lengths so a single runaway error can't bloat the DB.
 *   - Deduplicates: the same error message won't be logged more than 3 times
 *     per page session (prevents cascade floods from a looping render).
 */

import { supabase } from "@/integrations/supabase/client";

// Session-level deduplication — key: errorMessage, value: count logged
const _seen = new Map<string, number>();
const MAX_PER_SESSION = 3;

export type ErrorType = "react_boundary" | "unhandled_rejection" | "global_error";

interface LogParams {
  errorMessage: string;
  errorStack?: string;
  pageUrl: string;
  componentName?: string;
  errorType: ErrorType;
  metadata?: Record<string, unknown>;
}

export async function logError(params: LogParams): Promise<void> {
  try {
    const key = params.errorMessage.slice(0, 200);
    const count = _seen.get(key) ?? 0;
    if (count >= MAX_PER_SESSION) return;
    _seen.set(key, count + 1);

    // getSession() reads from the local cache — no network call.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return; // RLS blocks unauthenticated inserts anyway

    await supabase.from("error_logs").insert({
      user_id: session.user.id,
      error_type: params.errorType,
      error_message: params.errorMessage.slice(0, 2000),
      error_stack: params.errorStack?.slice(0, 5000) ?? null,
      page_url: params.pageUrl.slice(0, 500),
      component_name: params.componentName?.slice(0, 200) ?? null,
      metadata: params.metadata ?? null,
    });
  } catch {
    // Silent fail — never propagate errors from the error logger.
    // console.error is safe here since it doesn't re-trigger the handler.
    console.error("[ErrorLogger] Failed to log:", params.errorMessage);
  }
}

/**
 * Call once on app startup (inside a useEffect in RootComponent).
 * Sets window.onerror and window.onunhandledrejection to log to Supabase.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
let _initialized = false;

export function setupGlobalErrorHandlers(): void {
  if (typeof window === "undefined" || _initialized) return;
  _initialized = true;

  window.onerror = (message, source, lineno, colno, error) => {
    void logError({
      errorMessage: String(message),
      errorStack: error?.stack,
      pageUrl: window.location.href,
      errorType: "global_error",
      metadata: { source, lineno, colno },
    });
    return false; // don't suppress — let the browser still log it
  };

  window.onunhandledrejection = (event) => {
    const err = event.reason;
    void logError({
      errorMessage: err?.message ?? String(err),
      errorStack: err?.stack,
      pageUrl: window.location.href,
      errorType: "unhandled_rejection",
    });
  };
}
