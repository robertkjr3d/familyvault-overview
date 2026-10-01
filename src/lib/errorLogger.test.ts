import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression test for the Sep 29 2026 bug: errorLogger.ts used reportToSentry
// and SENTRY_DSN without importing them, so every browser error threw inside
// its own try/catch and nothing reached Sentry or the error_logs table.

const insert = vi.fn(async () => ({ error: null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    from: () => ({ insert }),
  },
}));

const fetchMock = vi.fn(async () => ({ ok: true }));
vi.stubGlobal("fetch", fetchMock);
vi.stubEnv("VITE_SENTRY_DSN", "https://abc123@o999.ingest.us.sentry.io/4500000000");

const { logError } = await import("./errorLogger");

describe("logError", () => {
  beforeEach(() => {
    fetchMock.mockClear();
    insert.mockClear();
  });

  it("sends the error to Sentry with a path-only URL", async () => {
    await logError({
      errorMessage: "Uncaught Error: Sentry test",
      pageUrl: "https://app.familyhubsg.com/loans?invite=SECRET&email=a%40b.com#x",
      errorType: "global_error",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe("https://o999.ingest.us.sentry.io/api/4500000000/store/");
    const body = JSON.parse(init.body);
    expect(body.message).toBe("Uncaught Error: Sentry test");
    expect(body.extra.pageUrl).toBe("https://app.familyhubsg.com/loans");
    expect(init.body).not.toContain("SECRET");
  });

  it("also saves a row to error_logs with a path-only page_url", async () => {
    await logError({
      errorMessage: "another distinct error",
      pageUrl: "https://app.familyhubsg.com/?invite=SECRET#access_token=tok",
      errorType: "react_boundary",
    });
    expect(insert).toHaveBeenCalledTimes(1);
    const row = (insert.mock.calls[0] as unknown[])[0] as { page_url: string; user_id: string };
    expect(row.user_id).toBe("user-1");
    expect(row.page_url).toBe("https://app.familyhubsg.com/");
  });
});
