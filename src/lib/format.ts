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
// foreign currency present — used for every tab's "total" section so
// foreign-currency amounts are never silently added into the SGD figure.
// A record with no currency value is legacy/default SGD.
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
// its own", not as an error to surface to the user.
export function convertToSgd(
  amount: number,
  currency: string,
  fx: FxRates | null | undefined,
): number | null {
  if (!fx) return null;
  const rate = fx.rates[currency];
  if (!rate || !isFinite(rate) || rate <= 0) return null;
  return amount / rate;
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
