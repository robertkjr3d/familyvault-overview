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
 * `whitespace-nowrap` is applied so the date can never split mid-value the
 * way it used to when the right column was a fixed, too-narrow width.
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
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return (
    <span className="whitespace-nowrap text-[10px] text-muted-foreground">
      Last updated: {dateStr}
    </span>
  );
}
