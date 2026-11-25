import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

const rpc = vi.fn();
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc }) }));

import { DEFAULT_ALERT_MB, judgeDbSize, parseAlertMb, runDbSizeCheck } from "./dbSizeCheckCron";

const URL = "https://hc-ping.example/abc";
const okFetch = () => vi.fn().mockResolvedValue(new Response("OK"));

describe("parseAlertMb", () => {
  it("uses the default when unset, empty or not a positive number", () => {
    for (const v of [undefined, null, "", "   ", "abc", "0", "-5", "NaN"]) {
      expect(parseAlertMb(v as string | undefined)).toBe(DEFAULT_ALERT_MB);
    }
  });
  it("accepts a positive number", () => {
    expect(parseAlertMb("1")).toBe(1);
    expect(parseAlertMb("250.5")).toBe(250.5);
  });
});

describe("judgeDbSize", () => {
  it("is fine below the alert level and warns at or above it", () => {
    expect(judgeDbSize(299.9, 300).ok).toBe(true);
    expect(judgeDbSize(300, 300).ok).toBe(false);
    expect(judgeDbSize(450, 300).message).toContain("WARNING");
  });
});

describe("runDbSizeCheck", () => {
  it("sends a normal success ping with the size when under the alert level", async () => {
    const fetchFn = okFetch();
    const r = await runDbSizeCheck(
      { HEALTHCHECKS_DBSIZE_PING_URL: URL },
      { readSizeMb: async () => 42.5, fetchFn },
    );
    expect(r.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe(URL);
    expect(String(fetchFn.mock.calls[0][1].body)).toContain("42.5 MB");
  });

  it("sends a /fail ping when at or over the alert level", async () => {
    const fetchFn = okFetch();
    const r = await runDbSizeCheck(
      { HEALTHCHECKS_DBSIZE_PING_URL: URL },
      { readSizeMb: async () => 310, fetchFn },
    );
    expect(r.ok).toBe(false);
    expect(fetchFn.mock.calls[0][0]).toBe(URL + "/fail");
  });

  it("DB_SIZE_ALERT_MB=1 is the test switch: any real database then raises the alarm", async () => {
    const fetchFn = okFetch();
    const r = await runDbSizeCheck(
      { HEALTHCHECKS_DBSIZE_PING_URL: URL, DB_SIZE_ALERT_MB: "1" },
      { readSizeMb: async () => 7.3, fetchFn },
    );
    expect(r.ok).toBe(false);
    expect(fetchFn.mock.calls[0][0]).toBe(URL + "/fail");
  });

  it("reports a failed lookup as /fail and never throws", async () => {
    const fetchFn = okFetch();
    const r = await runDbSizeCheck(
      { HEALTHCHECKS_DBSIZE_PING_URL: URL },
      {
        readSizeMb: async () => {
          throw new Error("boom");
        },
        fetchFn,
      },
    );
    expect(r.ok).toBe(false);
    expect(fetchFn.mock.calls[0][0]).toBe(URL + "/fail");
  });

  it("treats an unusable number as a failure", async () => {
    for (const bad of [NaN, -1, Infinity]) {
      const fetchFn = okFetch();
      const r = await runDbSizeCheck(
        { HEALTHCHECKS_DBSIZE_PING_URL: URL },
        { readSizeMb: async () => bad, fetchFn },
      );
      expect(r.ok).toBe(false);
      expect(fetchFn.mock.calls[0][0]).toBe(URL + "/fail");
    }
  });

  it("without a ping URL: no outside request, still logs the warning, never throws", async () => {
    const fetchFn = okFetch();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runDbSizeCheck({}, { readSizeMb: async () => 400, fetchFn });
    expect(r.ok).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(err.mock.calls.flat().join(" ")).toContain("no email alert");
    err.mockRestore();
  });

  it("a Healthchecks outage does not break the job", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));
    const r = await runDbSizeCheck(
      { HEALTHCHECKS_DBSIZE_PING_URL: URL },
      { readSizeMb: async () => 10, fetchFn },
    );
    expect(r.ok).toBe(true);
  });

  it("missing Supabase settings is reported, not thrown", async () => {
    const fetchFn = okFetch();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runDbSizeCheck({ HEALTHCHECKS_DBSIZE_PING_URL: URL }, { fetchFn });
    expect(r.ok).toBe(false);
    expect(fetchFn.mock.calls[0][0]).toBe(URL + "/fail");
    err.mockRestore();
  });
});

describe("default database read (the real path, with the Supabase client faked)", () => {
  const env = {
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "k",
    HEALTHCHECKS_DBSIZE_PING_URL: URL,
  };
  it("calls get_database_size_mb and uses the number it returns", async () => {
    rpc.mockResolvedValueOnce({ data: 12.3, error: null });
    const fetchFn = okFetch();
    const r = await runDbSizeCheck(env, { fetchFn });
    expect(rpc).toHaveBeenCalledWith("get_database_size_mb");
    expect(r.sizeMb).toBe(12.3);
    expect(fetchFn.mock.calls[0][0]).toBe(URL);
  });
  it("a database error becomes a /fail ping", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    const fetchFn = okFetch();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runDbSizeCheck(env, { fetchFn });
    expect(r.ok).toBe(false);
    expect(fetchFn.mock.calls[0][0]).toBe(URL + "/fail");
    err.mockRestore();
  });
});

describe("wiring with the database", () => {
  it("the database function the job calls is defined in schema.sql and locked to the server key", () => {
    const schema = readFileSync("supabase/schema.sql", "utf8");
    const code = readFileSync("src/lib/dbSizeCheckCron.ts", "utf8");
    expect(code).toContain('rpc("get_database_size_mb")');
    expect(schema.toLowerCase()).toContain(
      "create or replace function public.get_database_size_mb()",
    );
    // The live dump lists: revoke from PUBLIC, grant to service_role only (so anon and authenticated have no access).
    expect(schema.toLowerCase()).toContain(
      "revoke all on function public.get_database_size_mb() from public;",
    );
    expect(schema.toLowerCase()).not.toMatch(
      /grant execute on function public\.get_database_size_mb\(\) to (anon|authenticated|public)/,
    );
    expect(schema.toLowerCase()).toContain(
      "grant execute on function public.get_database_size_mb() to service_role;",
    );
  });
});
