import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { FxRates } from "@/lib/format";

// Reads the single most recent row from fx_rates (populated once a day by
// the Cloudflare Cron Trigger — see src/lib/fxRateCron.ts). This hook never
// calls the external FX provider itself, and is not household-scoped — the
// cached rate is shared system-wide, same as it's fetched system-wide.
//
// Returns `null` (not an error) if the cache is empty or the read fails —
// every consumer of this hook must treat a null/undefined result as "show
// the foreign amount without a conversion", never as something to block on
// or show an error for.
export function useFxRates() {
  return useQuery({
    queryKey: ["fx-rates-latest"],
    queryFn: async (): Promise<FxRates | null> => {
      const { data, error } = await supabase
        .from("fx_rates" as any)
        .select("rate_date, rates")
        .order("rate_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("[useFxRates] Failed to load cached FX rates.", error);
        return null;
      }
      if (!data) return null;

      const row = data as unknown as { rate_date: string; rates: Record<string, number> };
      return { rateDate: row.rate_date, rates: row.rates };
    },
    // This data only changes once a day (the cron job's daily write) —
    // no need to refetch aggressively.
    staleTime: 60 * 60 * 1000,
  });
}
