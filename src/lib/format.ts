import { format, parseISO } from "date-fns";

export function fmtMoney(n: number | null | undefined, currency?: string | null) {
  if (n == null || isNaN(Number(n))) return "—";
  const cur = currency || "SGD";
  // Only SGD is "home currency" and keeps the "$" symbol — every other
  // currency, including GBP, shows its 3-letter code instead. A generic
  // symbol shared with SGD (or with several other currencies, like "$" for
  // USD/AUD/HKD/CAD/NZD) would be silently misleading.
  const prefix = cur === "SGD" ? "$" : cur;
  const abs = Math.abs(Number(n));
  const str =
    abs >= 1_000_000
      ? (Number(n) / 1_000_000).toFixed(2) + "M"
      : Number(n).toLocaleString("en-SG", { maximumFractionDigits: 0 });
  return `${prefix}${str}`;
}

// Splits a list of records into an SGD total plus a separate total per
// foreign currency present. On its own this never mixes currencies — pair
// it with totalWithFx() below to get one combined SGD-equivalent figure
// once a cached rate is available. A record with no currency value is
// legacy/default SGD.
export function groupByCurrency<T extends { currency?: string | null }>(
  items: T[],
  amountOf: (item: T) => number | null | undefined,
): { sgd: number; foreign: { currency: string; total: number }[] } {
  let sgd = 0;
  const foreignMap = new Map<string, number>();
  for (const item of items) {
    const amt = Number(amountOf(item)) || 0;
    const cur = item.currency || "SGD";
    if (cur === "SGD") {
      sgd += amt;
    } else {
      foreignMap.set(cur, (foreignMap.get(cur) ?? 0) + amt);
    }
  }
  const foreign = Array.from(foreignMap.entries())
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  return { sgd, foreign };
}

// FX conversion — rates are cached once a day via a Cloudflare Cron Trigger
// into the fx_rates table (base SGD: rates[currency] = how many units of
// that currency equal 1 SGD, e.g. rates.USD = 0.74). See
// src/hooks/useFxRates.ts for the read side and src/lib/fxRateCron.ts for
// the write side. Never calls the FX provider directly from here.
export type FxRates = { rateDate: string; rates: Record<string, number> };

// Returns null (never throws) when there's no cached rate for this currency
// yet — every caller must treat that as "just show the foreign amount on
// its own", not as an error to surface to the user. Handles "SGD" directly
// (returns the amount unchanged) rather than requiring every caller to
// guard for that themselves.
export function convertToSgd(
  amount: number,
  currency: string,
  fx: FxRates | null | undefined,
): number | null {
  if (currency === "SGD") return amount;
  if (!fx) return null;
  const rate = fx.rates[currency];
  if (!rate || !isFinite(rate) || rate <= 0) return null;
  return amount / rate;
}

// Combines a groupByCurrency() result into one SGD-equivalent figure,
// converting each foreign currency total using the cached daily rate.
// Any currency with no cached rate yet contributes $0 here (never counted
// at face value in the wrong currency) — same safety behavior as the
// estate-summary document export. Callers still have access to the raw
// foreign totals separately (via groupByCurrency's `foreign` array) to show
// each original amount alongside this combined figure, not instead of it.
export function totalWithFx(
  totals: { sgd: number; foreign: { currency: string; total: number }[] },
  fx: FxRates | null | undefined,
): number {
  const convertedForeign = totals.foreign.reduce(
    (s, f) => s + (convertToSgd(f.total, f.currency, fx) ?? 0),
    0,
  );
  return totals.sgd + convertedForeign;
}

export function fmtPct(n: number | null | undefined) {
  if (n == null || isNaN(Number(n))) return "—";
  return `${Number(n).toFixed(2)}%`;
}

export function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  try {
    return format(typeof d === "string" ? parseISO(d) : d, "dd MMM yyyy");
  } catch {
    return String(d);
  }
}

export function fmtMonth(d: string | Date | null | undefined) {
  if (!d) return "—";
  try {
    return format(typeof d === "string" ? parseISO(d) : d, "MMM yyyy");
  } catch {
    return String(d);
  }
}
