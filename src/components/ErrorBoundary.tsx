/**
 * ErrorBoundary.tsx
 *
 * React class component — the only way to catch rendering errors in React.
 * Wraps the authenticated app shell in __root.tsx so any component crash
 * is caught here, logged to Supabase, and shows a simple recovery UI
 * rather than a blank screen.
 *
 * The fallback UI deliberately avoids importing any other app components
 * (they may be the ones that crashed) — plain inline styles only.
 */

import React from "react";
import { logError } from "@/lib/errorLogger";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Extract just the first line of the component stack for the DB field
    const firstComponent = info.componentStack?.split("\n").find((l) => l.trim().startsWith("at "))?.trim();
    void logError({
      errorMessage: error.message,
      errorStack: error.stack,
      pageUrl: typeof window !== "undefined" ? window.location.href : "",
      componentName: firstComponent,
      errorType: "react_boundary",
      metadata: { componentStack: info.componentStack?.slice(0, 2000) },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem", textAlign: "center" }}>
          <div style={{ maxWidth: "24rem" }}>
            <p style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem" }}>
              Something went wrong
            </p>
            <p style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "1rem" }}>
              This error has been logged. Please refresh to continue.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{ fontSize: "0.875rem", padding: "0.5rem 1.25rem", borderRadius: "0.5rem", border: "1px solid #d1d5db", cursor: "pointer", background: "#fff" }}
            >
              Refresh page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
