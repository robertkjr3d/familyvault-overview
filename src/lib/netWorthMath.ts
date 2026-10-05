// STATUS (since 3 Oct 2026): everything below about a mortgage being recorded "in
// two places" is HISTORY. A mortgage is now ONLY a row in the Loans tab linked to its
// property (loans.property_id). The Property tab has no mortgage fields any more,
// nothing writes properties.mortgage_balance / monthly_payment / interest_rate /
// rate_type / fixed_rate_end / mortgage_end_date / mortgage_bank, and the live values
// were cleared on 4 Oct 2026. The fallbacks that still read those columns (here, in
// lifetimeChartMath.ts, the dashboard, the Word summary and the adviser SQL view) do
// nothing on current data. They are kept ON PURPOSE as a safety net: if an old value
// ever reappears (e.g. a property restored from the Recycle Bin), the debt is still
// counted instead of silently vanishing. Do not extend them or copy the pattern.
// When and how to remove them (two checks must return 0 first):
// docs/AUDIT-LEDGER.md, "Old mortgage columns".
//
// Shared helpers for the "which mortgages count as a liability" rule, used by
// every place that totals liabilities (dashboard Net Worth, the Asset &
// Liability Summary Word export, ...) so they can never drift apart again.
//
// THE RULE (fixed Sep 28 2026): a mortgage can be recorded in two places — a
// row in the Loans tab (linked to a property via loans.property_id) and/or the
// property's own mortgage_balance field on the Property tab. Loans-tab rows
// always count as liabilities. A property's own mortgage_balance counts ONLY
// when no Loans-tab row is linked to that property, so one debt is never
// counted twice and a debt entered only on the Property tab is never missed.
// (The adviser dashboard applies the same rule in SQL: see
// supabase/schema.sql: view advisor_networth_components_view.)

type PropertyLike = { id?: string | null; mortgage_balance?: number | string | null };
type LoanLike = { property_id?: string | null };

/** IDs of properties that have at least one Loans-tab row linked to them. */
export function linkedPropertyIds(loans: LoanLike[]): Set<string> {
  const ids = new Set<string>();
  for (const l of loans) if (l.property_id) ids.add(l.property_id);
  return ids;
}

/**
 * Properties whose own mortgage_balance should be added as a liability:
 * a positive balance and no Loans-tab row linked to the property.
 * Pass the FULL loans list for the household (not a per-person subset) so a
 * linked loan owned by someone else still prevents a double count.
 */
export function unlinkedMortgageProperties<P extends PropertyLike>(
  properties: P[],
  loans: LoanLike[],
): P[] {
  const linked = linkedPropertyIds(loans);
  return properties.filter(
    (p) => !(p.id && linked.has(p.id)) && (Number(p.mortgage_balance) || 0) > 0,
  );
}
