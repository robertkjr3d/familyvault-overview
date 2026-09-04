/**
 * The single, shared "value last confirmed" line shown under an amount in a
 * record card's right-hand column — e.g. under an investment's estimated
 * value, or a savings account's balance.
 *
 * This is intentionally separate from RecordCard's own built-in
 * "Updated/Added {date}" footer line: that one tracks when the RECORD was
 * last edited (any field, any reason). This one tracks when the DOLLAR
 * FIGURE itself was last confirmed accurate — a household might edit a
 * record's notes today without having actually re-checked the balance.
 * Both are legitimate, different pieces of information; this component only
 * standardizes the wording/formatting of the second one, since it was
 * previously hand-written separately on each tab ("Updated: X" on one,
 * "Last updated: X" on another) with no shared source of truth.
 *
 * Kept deliberately short — "Updated: 26/07/26" rather than "Last updated:
 * 26 Jul 2026" — because this line lives in the same narrow right-hand
 * column as the Action text on the left; every character here is width the
 * Action text doesn't get. `whitespace-nowrap` still applies so the date
 * itself can never split mid-value.
 */
export function LastUpdatedLine({
  date,
  neverLabel = "Never updated",
}: {
  date: string | null | undefined;
  /** Shown when there's no date at all yet — wording can differ slightly by
   * context (e.g. a not-yet-vested insurance policy vs. a plain missing date). */
  neverLabel?: string;
}) {
  if (!date) {
    return (
      <span className="whitespace-nowrap text-[10px] text-muted-foreground">{neverLabel}</span>
    );
  }
  const dateStr = new Date(date).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
  return (
    <span className="whitespace-nowrap text-[10px] text-muted-foreground">
      Updated: {dateStr}
    </span>
  );
}
