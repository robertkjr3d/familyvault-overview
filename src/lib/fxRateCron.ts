import { createClient } from "@supabase/supabase-js";

// Runs once a day via the Cloudflare Cron Trigger declared in wrangler.jsonc
// (see src/server.ts's `scheduled` export). Fetches SGD-based rates for every
// non-SGD currency this app supports (see CURRENCIES in src/lib/options.ts)
// from Frankfurter (free, open-source, ECB-based, no API key) and caches them
// in the `fx_rates` table. Every page reads that cache — nothing in the app
// ever calls Frankfurter directly.
//
// Deliberately uses its own Supabase admin client (service-role key read
// straight from the `env` object the scheduled handler receives) instead of
// the shared `supabaseAdmin` in src/integrations/supabase/client.server.ts,
// which reads `process.env` — that's populated for request-scoped `fetch()`
// calls in this app, but scheduled() has a separate invocation path, so this
// avoids relying on that populating the same way here.
//
// Failure handling: on any error (network, bad response shape, DB write
// failure) this just logs and returns without writing — the app keeps
// serving whatever rate was cached most recently, it does not break.

const FRANKFURTER_URL =
  "https://api.frankfurter.dev/v1/latest?base=SGD&symbols=GBP,USD,EUR,AUD,HKD,JPY,CNY,MYR,THB,CAD,NZD";

type FxCronEnv = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

type FrankfurterResponse = {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
};

function isFrankfurterResponse(value: unknown): value is FrankfurterResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.base === "string" &&
    typeof v.date === "string" &&
    typeof v.rates === "object" &&
    v.rates !== null
  );
}

export async function runFxRateFetch(env: FxCronEnv): Promise<void> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[fx-cron] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — skipping fetch.");
    return;
  }

  let payload: unknown;
  try {
    const response = await fetch(FRANKFURTER_URL);
    if (!response.ok) {
      console.error(
        `[fx-cron] Frankfurter returned HTTP ${response.status} — keeping last cached rate.`,
      );
      return;
    }
    payload = await response.json();
  } catch (error) {
    console.error("[fx-cron] Frankfurter fetch failed — keeping last cached rate.", error);
    return;
  }

  if (!isFrankfurterResponse(payload)) {
    console.error(
      "[fx-cron] Unexpected Frankfurter response shape — keeping last cached rate.",
      payload,
    );
    return;
  }

  // Untyped client on purpose: fx_rates was just added via raw SQL and isn't
  // in the generated types.ts yet, and this file only ever touches this one
  // table — not worth making every insert in the app wait on a types.ts
  // regeneration step.
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin
    .from("fx_rates")
    .upsert(
      {
        rate_date: payload.date,
        base_currency: payload.base,
        rates: payload.rates,
      },
      { onConflict: "rate_date,base_currency" },
    )
    .select("id")
    .maybeSingle();

  if (error || !data) {
    console.error("[fx-cron] Failed to write fx_rates row — keeping last cached rate.", error);
    return;
  }

  console.log(`[fx-cron] Cached SGD rates for ${payload.date}.`);
}
