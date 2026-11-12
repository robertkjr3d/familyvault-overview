// Caps how many invitation emails the app will send.
//
// Every invite sends an email through the project's shared email allowance (Supabase auth
// emails, about 30 an hour, on top of Resend's free tier) and can create an account for any
// address. Without a cap, one account (or one hijacked account) could use up that allowance
// for everybody, which would block sign-in codes, or send mail to strangers under the app's
// sender name. The per-minute limiter on household invites stops a runaway loop; this cap
// stops slow abuse, and it also covers adviser invites, which had no limit at all.
//
// This file never touches the admin key: the caller passes a counting function in.

export const MAX_INVITES_PER_HOUSEHOLD_PER_DAY = 10;
export const MAX_INVITES_PER_HOUR_ALL_HOUSEHOLDS = 15;

export type InviteTable = "household_invites" | "advisor_invites";

/** Counts invite rows created since `sinceIso`, optionally for one household only. */
export type InviteCounter = (
  table: InviteTable,
  sinceIso: string,
  householdId?: string,
) => Promise<number>;

const TABLES: InviteTable[] = ["household_invites", "advisor_invites"];

export async function assertInviteCapacity(
  count: InviteCounter,
  householdId: string,
  now: Date = new Date(),
): Promise<void> {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

  const [householdToday, everyoneThisHour] = await Promise.all([
    Promise.all(TABLES.map((t) => count(t, dayAgo, householdId))),
    Promise.all(TABLES.map((t) => count(t, hourAgo))),
  ]);

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  if (sum(householdToday) >= MAX_INVITES_PER_HOUSEHOLD_PER_DAY) {
    throw new Error(
      "You have sent a lot of invites today. Please try again tomorrow, or email support@familyhubsg.com if you need more.",
    );
  }
  if (sum(everyoneThisHour) >= MAX_INVITES_PER_HOUR_ALL_HOUSEHOLDS) {
    throw new Error("Invites are very busy right now. Please try again in an hour.");
  }
}

type CountResult = { count: number | null; error: unknown };
type CountQuery = PromiseLike<CountResult> & { eq(column: string, value: string): CountQuery };
interface CountClient {
  from(table: string): {
    select(
      columns: string,
      options: { count: "exact"; head: true },
    ): { gte(column: string, value: string): CountQuery };
  };
}

/** Builds a counter from a Supabase client that is passed in (so this file never imports the admin key). */
export function makeInviteCounter(client: unknown): InviteCounter {
  const db = client as CountClient;
  return async (table, sinceIso, householdId) => {
    let query = db
      .from(table)
      .select("id", { count: "exact", head: true })
      .gte("created_at", sinceIso);
    if (householdId) query = query.eq("household_id", householdId);
    const { count, error } = await query;
    if (error) throw new Error("Could not check the invite limit. Please try again.");
    return count ?? 0;
  };
}
