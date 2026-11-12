// Finds which member of ONE household has a given email address.
//
// Used when an owner removes a member. The old code listed every account in the whole
// project and searched that list, which only sees the first page of users (so it would stop
// working once the app has more users than one page) and also told the caller whether any
// email address had an account. Looking only at the household's own members fixes both:
// the work no longer grows with the total number of users, and the owner learns nothing
// about people outside the household.
//
// The email lookup is passed in, so this file never touches the admin key.

export function normalizeMemberEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findMemberByEmail(
  memberIds: string[],
  email: string,
  getEmail: (userId: string) => Promise<string | null>,
): Promise<string | null> {
  const wanted = normalizeMemberEmail(email);
  if (!wanted) return null;
  const rows = await Promise.all(
    memberIds.map(async (id) => ({ id, email: normalizeMemberEmail((await getEmail(id)) ?? "") })),
  );
  return rows.find((r) => r.email === wanted)?.id ?? null;
}
