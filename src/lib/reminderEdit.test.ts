import { describe, it, expect } from "vitest";
import { buildReminderEditPatch, reminderDateInputValue } from "./reminderRecurrence";

const orig = {
  what: "Reprice loan",
  remind_at: new Date("2027-03-10T12:00:00").toISOString(),
  recurrence: null as string | null,
  recurrence_end_of_month: false,
};
const same = { what: "Reprice loan", date: "2027-03-10", recurrence: "", endOfMonth: false };

describe("reminder edit patch", () => {
  it("round-trips the stored date", () => {
    expect(reminderDateInputValue(orig.remind_at)).toBe("2027-03-10");
    expect(reminderDateInputValue(null)).toBe("");
    expect(reminderDateInputValue("garbage")).toBe("");
  });
  it("no change -> null", () => {
    expect(buildReminderEditPatch(orig, same)).toBeNull();
  });
  it("text-only edit never rewrites remind_at", () => {
    expect(buildReminderEditPatch(orig, { ...same, what: "  Reprice home loan " })).toEqual({
      what: "Reprice home loan",
    });
  });
  it("date change only sends remind_at", () => {
    const p = buildReminderEditPatch(orig, { ...same, date: "2027-04-01" })!;
    expect(Object.keys(p)).toEqual(["remind_at"]);
    expect(reminderDateInputValue(p.remind_at as string)).toBe("2027-04-01");
  });
  it("one-off -> monthly last day", () => {
    expect(
      buildReminderEditPatch(orig, { ...same, recurrence: "monthly", endOfMonth: true }),
    ).toEqual({ recurrence: "monthly", recurrence_end_of_month: true });
  });
  it("switching away from monthly clears end-of-month", () => {
    const o = { ...orig, recurrence: "monthly", recurrence_end_of_month: true };
    expect(buildReminderEditPatch(o, { ...same, recurrence: "weekly", endOfMonth: true })).toEqual({
      recurrence: "weekly",
      recurrence_end_of_month: false,
    });
  });
  it("only ever touches the four editable columns", () => {
    const p = buildReminderEditPatch(orig, {
      what: "x",
      date: "2030-01-01",
      recurrence: "yearly",
      endOfMonth: true,
    })!;
    for (const k of Object.keys(p))
      expect(["what", "remind_at", "recurrence", "recurrence_end_of_month"]).toContain(k);
  });
});
