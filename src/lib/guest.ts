// Sample-family guests ("Try a sample family", no email) are Supabase ANONYMOUS users.
// Their access token carries `is_anonymous: true`. The database already treats them as
// read-only viewers of ONE household (see is_guest() in supabase/schema.sql). This file
// is the app-side half of that rule: one place that decides "is this a guest?".
//
// Fail closed: anything that is not a clearly NORMAL user counts as a guest.

/** The one shared, read-only household guests can open. Must match the id in the database policies. */
export const SAMPLE_HOUSEHOLD_ID = "a750df45-c320-46fd-b2c8-82389878db07";

type MaybeClaims =
  | {
      is_anonymous?: unknown;
      app_metadata?: { provider?: unknown } | null;
    }
  | null
  | undefined;

/** Server side: look at the verified token claims. */
export function isGuestClaims(claims: MaybeClaims): boolean {
  if (!claims) return true; // no claims at all: never treat as a real user
  if (claims.is_anonymous === true) return true;
  if (claims.app_metadata?.provider === "anonymous") return true;
  return false;
}

/** Browser side: look at the signed-in user object. */
export function isGuestUser(
  user: { is_anonymous?: boolean; app_metadata?: { provider?: string } } | null | undefined,
): boolean {
  if (!user) return false; // signed out is not a guest, it is nobody
  return user.is_anonymous === true || user.app_metadata?.provider === "anonymous";
}
