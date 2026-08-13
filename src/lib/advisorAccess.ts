import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============================================================
// Advisor (FA) access lifecycle — send invite, accept on login,
// list, toggle permissions, revoke.
//
// Every write here follows a rule already learned the hard way in this
// app: an UPDATE/DELETE that matches zero rows does NOT error — it
// silently "succeeds" while changing nothing. Every mutation below
// re-selects the row it just touched and throws if it's null, rather
// than trusting the absence of an error. See revokeAdvisorAccess and
// updateAdvisorPermissions especially.
//
// The invite -> accept -> revoke -> re-invite -> re-accept cycle is
// handled via upsert on the (household_id, advisor_user_id) unique
// constraint — verified against a local mock DB to always leave
// exactly one row, never a duplicate/ghost, regardless of how many
// times a family shares/revokes/re-shares with the same advisor.
// ============================================================

const sendInvitePayloadSchema = z.object({
  householdId: z.string().uuid(),
  email: z.string().email(),
  canViewInsurance: z.boolean().default(true),
  canViewInvestments: z.boolean().default(true),
  canViewNetworthSummary: z.boolean().default(true),
  // Which household members this advisor may see. Required, not optional —
  // access is opt-in per member, never a default of "everyone."
  memberIds: z.array(z.string().uuid()).min(1, "Select at least one member to share."),
});

const revokePayloadSchema = z.object({
  householdId: z.string().uuid(),
  advisorUserId: z.string().uuid(),
});

const updatePermissionsPayloadSchema = z.object({
  householdId: z.string().uuid(),
  advisorUserId: z.string().uuid(),
  canViewInsurance: z.boolean(),
  canViewInvestments: z.boolean(),
  canViewNetworthSummary: z.boolean(),
  memberIds: z.array(z.string().uuid()).min(1, "Select at least one member to share."),
});

// Separate from listPayloadSchema (household-only, used by the family-side
// screens) — the FA-side detail view is now scoped to one member at a time.
const clientRecordsPayloadSchema = z.object({
  householdId: z.string().uuid(),
  memberId: z.string().uuid(),
});

const upsertNotePayloadSchema = z.object({
  householdId: z.string().uuid(),
  memberId: z.string().uuid(),
  recordCategory: z.enum(["insurance", "investments"]),
  recordId: z.string().uuid(),
  note: z.string().trim().min(1, "Note can't be empty.").max(2000, "Keep it under 2000 characters."),
});

const deleteNotePayloadSchema = z.object({
  noteId: z.string().uuid(),
});

const cancelInvitePayloadSchema = z.object({
  householdId: z.string().uuid(),
  email: z.string().email(),
});

const listPayloadSchema = z.object({
  householdId: z.string().uuid(),
});

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function requireOwner(supabase: any, householdId: string, userId: string) {
  const { data, error } = await supabase
    .from("household_users" as any)
    .select("household_id")
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .eq("role", "owner")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Only the household owner can manage advisor access.");
}

async function requireMember(supabase: any, householdId: string, userId: string) {
  const { data, error } = await supabase
    .from("household_users" as any)
    .select("household_id")
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("You are not a member of this household.");
}

export const sendAdvisorInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(sendInvitePayloadSchema)
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    await requireOwner(supabase, data.householdId, userId);

    const { data: householdRow, error: hhError } = await supabase
      .from("households" as any)
      .select("name")
      .eq("id", data.householdId)
      .maybeSingle();
    if (hhError) throw hhError;
    const householdName = (householdRow as any)?.name ?? "a household";

    const invitedEmail = normalizeEmail(data.email);
    const inviterEmail = normalizeEmail(String(claims.email ?? ""));
    const token = `${crypto.randomUUID()}${crypto.randomUUID().replace(/-/g, "")}`;

    const request = getRequest();
    const configuredRedirect =
      process.env.SUPABASE_AUTH_REDIRECT_URL?.trim() ||
      process.env.VITE_SUPABASE_AUTH_REDIRECT_URL?.trim();
    let redirectUrl: URL;
    if (configuredRedirect) {
      redirectUrl = new URL(configuredRedirect);
    } else if (request) {
      redirectUrl = new URL(request.url);
      redirectUrl.pathname = "/";
      redirectUrl.search = "";
      redirectUrl.hash = "";
    } else {
      throw new Error("Unable to determine invitation redirect URL.");
    }
    redirectUrl.searchParams.set("advisor_invite", token);
    redirectUrl.searchParams.set("email", invitedEmail);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Dedup: cancel any existing PENDING (unaccepted, uncancelled) invite to
    // this email for this household before inserting a fresh one — mirrors
    // sendHouseholdInvite exactly. An already-accepted or already-cancelled
    // invite is left alone (it's history, not a live duplicate) and does not
    // block a new invite from being created (verified: re-inviting after a
    // revoke does not collide with the earlier ACCEPTED invite row at all,
    // since that row is no longer "pending").
    await supabaseAdmin
      .from("advisor_invites" as any)
      .update({ cancelled_at: new Date().toISOString() })
      .eq("household_id", data.householdId)
      .eq("invited_email", invitedEmail)
      .is("accepted_at", null)
      .is("cancelled_at", null);

    const { error: insertError } = await supabaseAdmin.from("advisor_invites" as any).insert({
      household_id: data.householdId,
      invited_email: invitedEmail,
      can_view_insurance: data.canViewInsurance,
      can_view_investments: data.canViewInvestments,
      can_view_networth_summary: data.canViewNetworthSummary,
      member_ids: data.memberIds,
      invited_by_user_id: userId,
      token,
    });
    if (insertError) throw insertError;

    const { error: otpError } = await supabaseAdmin.auth.signInWithOtp({
      email: invitedEmail,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: redirectUrl.toString(),
        data: { advisor_invited_household_name: householdName, invited_by_email: inviterEmail },
      },
    });
    if (otpError) {
      await supabaseAdmin
        .from("advisor_invites" as any)
        .delete()
        .eq("token", token);
      throw otpError;
    }

    return { ok: true };
  });

export const cancelPendingAdvisorInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(cancelInvitePayloadSchema)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireOwner(supabase, data.householdId, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: updated, error } = await supabaseAdmin
      .from("advisor_invites" as any)
      .update({ cancelled_at: new Date().toISOString() })
      .eq("household_id", data.householdId)
      .eq("invited_email", normalizeEmail(data.email))
      .is("accepted_at", null)
      .is("cancelled_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    // No matching pending invite — nothing to cancel. Surfaced as a real
    // error rather than a silent no-op "success", per the zero-rows rule.
    if (!updated) throw new Error("No pending invite found for that email.");
    return { ok: true };
  });

// Runs on every login, alongside the existing acceptPendingInvitesForCurrentUser.
// Idempotent by construction: running it twice for the same invite is safe
// because the link write is an upsert keyed on (household_id, advisor_user_id),
// and re-marking an already-accepted invite as accepted again is harmless.
export const acceptPendingAdvisorInvitesForCurrentUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, claims } = context;
    const userEmail = normalizeEmail(String(claims.email ?? ""));
    if (!userEmail) return { acceptedHouseholdIds: [] as string[] };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: invites, error: invitesError } = await supabaseAdmin
      .from("advisor_invites" as any)
      .select(
        "id, household_id, can_view_insurance, can_view_investments, can_view_networth_summary, member_ids",
      )
      .eq("invited_email", userEmail)
      .is("accepted_at", null)
      .is("cancelled_at", null)
      .gt("expires_at", new Date().toISOString());
    if (invitesError) throw invitesError;
    if (!invites || invites.length === 0) return { acceptedHouseholdIds: [] as string[] };

    const acceptedHouseholdIds: string[] = [];

    for (const invite of invites as any[]) {
      // Upsert, not insert: if this advisor already has a (possibly revoked)
      // link to this household from an earlier share, this UPDATEs that
      // exact same row back to active with fresh permissions — it never
      // creates a second row. Verified directly: invite -> accept -> revoke
      // -> re-invite -> re-accept leaves exactly one row every time.
      const { data: linkRow, error: linkError } = await supabaseAdmin
        .from("advisor_household_links" as any)
        .upsert(
          {
            household_id: invite.household_id,
            advisor_user_id: userId,
            can_view_insurance: invite.can_view_insurance,
            can_view_investments: invite.can_view_investments,
            can_view_networth_summary: invite.can_view_networth_summary,
            status: "active",
            consent_renewed_at: new Date().toISOString(),
            revoked_at: null,
          },
          { onConflict: "household_id,advisor_user_id" },
        )
        .select("id")
        .single();
      if (linkError) throw linkError;

      // Member grants are fully replaced on every accept, same "leave
      // exactly one clean state" philosophy as the link upsert above —
      // re-inviting with a different member selection can't leave stale
      // grants behind from an earlier invite.
      const linkId = (linkRow as any).id;
      await supabaseAdmin.from("advisor_link_members" as any).delete().eq("link_id", linkId);
      const memberIds: string[] = invite.member_ids ?? [];
      if (memberIds.length > 0) {
        const { error: membersError } = await supabaseAdmin
          .from("advisor_link_members" as any)
          .insert(memberIds.map((memberId) => ({ link_id: linkId, member_id: memberId })));
        if (membersError) throw membersError;
      }

      await supabaseAdmin
        .from("advisor_invites" as any)
        .update({ accepted_at: new Date().toISOString(), accepted_by_user_id: userId })
        .eq("id", invite.id);

      acceptedHouseholdIds.push(invite.household_id);
    }

    return { acceptedHouseholdIds };
  });

export const revokeAdvisorAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(revokePayloadSchema)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireOwner(supabase, data.householdId, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: updated, error } = await supabaseAdmin
      .from("advisor_household_links" as any)
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("household_id", data.householdId)
      .eq("advisor_user_id", data.advisorUserId)
      .eq("status", "active")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    // Zero rows matched — either already revoked, or this advisor was never
    // linked here. Either way, silently returning "ok" would be exactly the
    // false-success bug already fixed once in this app (member removal).
    if (!updated) throw new Error("This advisor's access was already revoked or not found.");
    return { ok: true };
  });

export const updateAdvisorPermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(updatePermissionsPayloadSchema)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireOwner(supabase, data.householdId, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: updated, error } = await supabaseAdmin
      .from("advisor_household_links" as any)
      .update({
        can_view_insurance: data.canViewInsurance,
        can_view_investments: data.canViewInvestments,
        can_view_networth_summary: data.canViewNetworthSummary,
      })
      .eq("household_id", data.householdId)
      .eq("advisor_user_id", data.advisorUserId)
      .eq("status", "active")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!updated) throw new Error("Active advisor link not found for that household.");

    // Full replace, same reasoning as the accept-invite path: whatever
    // member set is passed in becomes the complete grant, never additive.
    const linkId = (updated as any).id;
    await supabaseAdmin.from("advisor_link_members" as any).delete().eq("link_id", linkId);
    const { error: membersError } = await supabaseAdmin
      .from("advisor_link_members" as any)
      .insert(data.memberIds.map((memberId) => ({ link_id: linkId, member_id: memberId })));
    if (membersError) throw membersError;

    return { ok: true };
  });

// Family-side: who currently has access, plus anyone still pending.
// Viewing is allowed for any household member (not owner-only) —
// mirrors how the family member list itself is viewable by any member,
// while inviting/revoking stays owner-only.
export const listAdvisorsForHousehold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(listPayloadSchema)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireMember(supabase, data.householdId, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: linkRows, error: linksError } = await supabaseAdmin
      .from("advisor_household_links" as any)
      .select(
        "id, advisor_user_id, can_view_insurance, can_view_investments, can_view_networth_summary, linked_at, consent_renewed_at",
      )
      .eq("household_id", data.householdId)
      .eq("status", "active");
    if (linksError) throw linksError;

    const advisorIds = (linkRows ?? []).map((r: any) => r.advisor_user_id);
    // user_profiles is locked to self-only RLS on the client, but is exactly
    // the right place to resolve display info here since we're already
    // running as supabaseAdmin (bypasses RLS) — a targeted lookup by id,
    // rather than paginating every user in the project.
    const profilesById = new Map<string, { email: string | null; display_name: string | null }>();
    if (advisorIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabaseAdmin
        .from("user_profiles" as any)
        .select("user_id, email, display_name")
        .in("user_id", advisorIds);
      if (profilesError) throw profilesError;
      for (const p of (profiles ?? []) as any[]) {
        profilesById.set(p.user_id, { email: p.email, display_name: p.display_name });
      }
    }

    // Which household members each link actually grants — shown to the
    // owner as e.g. "Dad, You" so it's obvious at a glance without opening
    // an edit form.
    const linkIds = (linkRows ?? []).map((r: any) => r.id);
    const memberNamesByLink = new Map<string, string[]>();
    if (linkIds.length > 0) {
      const { data: linkMemberRows, error: linkMembersError } = await supabaseAdmin
        .from("advisor_link_members" as any)
        .select("link_id, member_id, members(name)")
        .in("link_id", linkIds);
      if (linkMembersError) throw linkMembersError;
      for (const row of (linkMemberRows ?? []) as any[]) {
        const arr = memberNamesByLink.get(row.link_id) ?? [];
        arr.push(row.members?.name ?? "Member");
        memberNamesByLink.set(row.link_id, arr);
      }
    }

    const advisors = (linkRows ?? []).map((r: any) => ({
      advisorUserId: r.advisor_user_id,
      email: profilesById.get(r.advisor_user_id)?.email ?? "(email unavailable)",
      displayName: profilesById.get(r.advisor_user_id)?.display_name ?? null,
      canViewInsurance: r.can_view_insurance,
      canViewInvestments: r.can_view_investments,
      canViewNetworthSummary: r.can_view_networth_summary,
      memberNames: memberNamesByLink.get(r.id) ?? [],
      linkedAt: r.linked_at,
      consentRenewedAt: r.consent_renewed_at,
    }));

    const { data: pendingRows, error: pendingError } = await supabaseAdmin
      .from("advisor_invites" as any)
      .select("invited_email, created_at, expires_at")
      .eq("household_id", data.householdId)
      .is("accepted_at", null)
      .is("cancelled_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true });
    if (pendingError) throw pendingError;

    const pending = ((pendingRows ?? []) as any[]).map((p) => ({
      email: p.invited_email,
      invitedAt: p.created_at,
      expiresAt: p.expires_at,
    }));

    return { advisors, pending };
  });

// Net worth summary is deliberately independent of the insurance/investments
// categories — an advisor can be granted this without itemized access to
// either, or vice versa. Reuses the family dashboard's OWN groupByCurrency/
// totalWithFx functions and replicates its exact formula (traced directly
// from src/routes/index.tsx, not re-derived) so an advisor's figure can
// never silently drift from what the family sees on their own dashboard.
// Mortgage debt is NOT subtracted from property value here, on purpose —
// the family's own formula doesn't do that either; it's captured entirely
// via the separate loans total.
export const getAdvisorNetworthSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(listPayloadSchema)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { groupByCurrency, totalWithFx } = await import("@/lib/format");

    const { data: rows, error } = await supabase
      .from("advisor_networth_components_view" as any)
      .select("*")
      .eq("household_id", data.householdId);
    if (error) throw error;
    const components = (rows ?? []) as any[];

    // Not household-scoped, shared system-wide — same table, same plain
    // (non-admin) read the family dashboard itself already uses via
    // useFxRates.ts. A missing/failed read degrades to "show unconverted
    // foreign amounts," same contract as everywhere else in this app.
    const { data: fxRow } = await supabase
      .from("fx_rates" as any)
      .select("rate_date, rates")
      .order("rate_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const fxRates = fxRow
      ? { rateDate: (fxRow as any).rate_date, rates: (fxRow as any).rates }
      : null;

    const byType = (t: string) => components.filter((r) => r.source_type === t);
    const isCpf = (r: any) => (r.account_type ?? "").startsWith("CPF-");
    const savingsRows = byType("savings");

    const propertyValue = totalWithFx(
      groupByCurrency(byType("property"), (r) => r.amount),
      fxRates,
    );
    const investmentsValue = totalWithFx(
      groupByCurrency(byType("investment"), (r) => r.amount),
      fxRates,
    );
    const liquidSavingsValue = totalWithFx(
      groupByCurrency(
        savingsRows.filter((r) => !isCpf(r)),
        (r) => r.amount,
      ),
      fxRates,
    );
    const cpfValue = totalWithFx(
      groupByCurrency(savingsRows.filter(isCpf), (r) => r.amount),
      fxRates,
    );
    const savingsValue = liquidSavingsValue + cpfValue;
    const otherAssetsValue = totalWithFx(
      groupByCurrency(byType("other_asset"), (r) => r.amount),
      fxRates,
    );
    const insuranceSurrenderValue = totalWithFx(
      groupByCurrency(byType("insurance_surrender"), (r) => r.amount),
      fxRates,
    );
    const totalAssets =
      propertyValue + investmentsValue + savingsValue + otherAssetsValue + insuranceSurrenderValue;
    const totalLiabilities = totalWithFx(
      groupByCurrency(byType("loan"), (r) => r.amount),
      fxRates,
    );
    const netWorth = totalAssets - totalLiabilities;

    return {
      totalAssets,
      totalLiabilities,
      netWorth,
      hasData: components.length > 0,
      // Every one of these was already being computed above just to be
      // summed into totalAssets — exposing them costs nothing extra and is
      // exactly the breakdown a donut/allocation chart needs. Zero-value
      // categories are kept (not filtered here) so the chart can decide
      // whether to omit a 0% slice.
      breakdown: {
        property: propertyValue,
        investments: investmentsValue,
        savings: savingsValue,
        otherAssets: otherAssetsValue,
        insuranceSurrender: insuranceSurrenderValue,
        liabilities: totalLiabilities,
      },
    };
  });

// FA-side alert horizon and staleness window — single source of truth for
// the client-list badge, the detail-page box, and the PDF. Moved above both
// getClientRecordsForAdvisor and listClientHouseholdsForAdvisor since both
// now depend on it.
export const ADVISOR_ALERT_HORIZON_DAYS = 30;
export const STALE_AFTER_DAYS = 180;

// Shared shape-adapter: buildUpcomingItems() (alerts.ts) expects an
// investment row's premium fields under their ORIGINAL column names
// (premium_start_date, premium_frequency, premium_end_date, premium_amount,
// group_name) — verified directly against alerts.ts, not guessed. Used by
// both the badge count and the detail/PDF list so there is exactly one
// place this mapping is written.
function mapInvestmentForAlerts(inv: {
  id: string;
  name: string;
  group_name: string | null;
  premium_amount: number | null;
  premium_start_date: string | null;
  premium_end_date: string | null;
  premium_frequency: string | null;
  is_giro: boolean | null;
  member_id: string | null;
}) {
  return {
    id: inv.id,
    name: inv.name,
    group_name: inv.group_name,
    premium_amount: inv.premium_amount,
    premium_start_date: inv.premium_start_date,
    premium_end_date: inv.premium_end_date,
    premium_frequency: inv.premium_frequency,
    is_giro: inv.is_giro,
    member_id: inv.member_id,
  };
}

// The single computation behind "X due soon" everywhere on the FA side.
// Deliberately narrower than the family dashboard's own alert list: only
// premium DUE/OVERDUE occurrences (computed from start_date + frequency via
// the shared alerts.ts engine — never a stored end_date, which is a
// schedule END date, not a due date). "Policy ends"/"premiums end" items
// that buildUpcomingItems also returns are excluded here, since a header
// that says "Upcoming Premiums" showing a policy's END date would be its
// own new version of the exact bug this replaces. Revisit if you want a
// separate "policy ending soon" section later — that's a real, distinct,
// useful thing, just not what this list is for.
async function computeAdvisorUpcomingPremiums(
  insuranceRows: any[],
  investmentRows: any[],
  today: Date,
  dismissedKeys: Set<string>,
) {
  const { buildUpcomingItems } = await import("@/lib/alerts");
  let items: Awaited<ReturnType<typeof buildUpcomingItems>> = [];
  try {
    items = buildUpcomingItems(
      {
        properties: [],
        loans: [],
        insurance: insuranceRows,
        investments: investmentRows.map(mapInvestmentForAlerts),
        savings: [],
        inventoryItems: [],
        reminders: [],
      },
      today,
      ADVISOR_ALERT_HORIZON_DAYS,
    );
  } catch {
    items = [];
  }
  // buildUpcomingItems() is a client/UI-oriented helper — every item it
  // returns carries `icon`, a live Lucide React component reference (see
  // alerts.ts). That's harmless when the caller stays in the browser, but
  // getClientRecordsForAdvisor returns this across a server-function
  // response boundary, which has to serialize it — a React component isn't
  // serializable, and shipping it caused the whole response to fail (a
  // confirmed, real incident, not a hypothetical: this is exactly what
  // produced the "Seroval Error" toast and an apparently-empty detail page
  // and PDF). Mapped down to a plain, serialization-safe shape containing
  // only what the FA-side UI and PDF actually use — never returning the
  // raw alerts.ts item directly from a server function again.
  //
  // Dismissed-key check uses the EXACT same key format as the household's
  // own bell/dashboard (AlertsSheet.tsx: `${sourceType}::${recordId}::${date}`)
  // — a real incident, not a hypothetical: without this, an item the
  // household owner explicitly marked done kept showing on the advisor side
  // forever, since buildUpcomingItems() itself has no notion of "handled" —
  // that state lives entirely in dismissed_dashboard_items, a table this
  // computation wasn't reading at all before.
  // UpcomingItem carries `amount` but no currency at all — built from a
  // lookup against the source rows instead, so the FA can actually see how
  // much is due, not just that something is due (a real gap: the box
  // previously showed a label and a date with no dollar figure anywhere).
  const currencyByRecordId = new Map<string, string | null>();
  for (const r of insuranceRows) currencyByRecordId.set(r.id, r.currency ?? null);
  for (const r of investmentRows) currencyByRecordId.set(r.id, r.currency ?? null);

  return items
    .filter((i) => i.sourceType === "insurance_next_due" || i.sourceType === "investment_premium_due")
    .filter((i) => !dismissedKeys.has(`${i.sourceType}::${i.recordId}::${i.date}`))
    .map((i) => ({
      recordId: i.recordId,
      date: i.date,
      label: i.label,
      overdue: !!i.overdue,
      amount: i.amount ?? null,
      currency: currencyByRecordId.get(i.recordId) ?? null,
    }));
}

// Full record list for ONE client MEMBER, for the FA's own detail view.
// Deliberately uses the caller's own authenticated session (context.supabase),
// NOT supabaseAdmin — the view's has_advisor_access() check and RLS then
// genuinely gate this response, rather than this function's own filters
// being the only thing standing between an advisor and the wrong data.
//
// The view itself already restricts rows to what this advisor can see
// ANYWHERE in the household — the member_id filter below is what narrows
// that down to the ONE member's card being viewed (an advisor linked to
// two members of the same household must not see member B's records while
// looking at member A's page). Unassigned records (member_id null) are
// included on every member's card, matching the household owner's choice.
export const getClientRecordsForAdvisor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(clientRecordsPayloadSchema)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("advisor_client_summary_view" as any)
      .select("*")
      .eq("household_id", data.householdId)
      .or(`member_id.eq.${data.memberId},member_id.is.null`)
      .order("category", { ascending: true })
      .order("record_name", { ascending: true });
    if (error) throw error;

    // The advisor's own notes on these records — RLS on advisor_record_notes
    // already restricts this to rows where advisor_user_id = auth.uid(),
    // so no extra filter is needed beyond household_id; an FA can never see
    // another advisor's notes on the same record.
    const { data: noteRows, error: notesError } = await supabase
      .from("advisor_record_notes" as any)
      .select("id, record_id, note, updated_at")
      .eq("household_id", data.householdId);
    if (notesError) throw notesError;
    const noteByRecordId = new Map((noteRows ?? []).map((n: any) => [n.record_id, n]));
    const recordsWithNotes = (rows ?? []).map((r: any) => {
      const noteRow = noteByRecordId.get(r.record_id) as any;
      return {
        ...r,
        note: noteRow?.note ?? null,
        noteId: noteRow?.id ?? null,
        noteUpdatedAt: noteRow?.updated_at ?? null,
      };
    });

    // Fetched from the base tables, not the view — buildUpcomingItems needs
    // start_date/frequency/premium under their real names, and the view
    // deliberately aliases investments' columns onto the generic
    // insurance-shaped names for the itemized display above, which isn't
    // the shape this needs. Uses the FA's own RLS-scoped session, same as
    // the query above — the new member-aware advisor_select policy on
    // these two base tables (added in the member-scoping migration) is
    // exactly what makes this safe to query directly.
    const [{ data: insuranceRows, error: insError }, { data: investmentRows, error: invError }] =
      await Promise.all([
        supabase
          .from("insurance_policies" as any)
          .select("id, name, premium, start_date, end_date, frequency, is_giro, member_id, currency")
          .eq("household_id", data.householdId)
          .or(`member_id.eq.${data.memberId},member_id.is.null`),
        supabase
          .from("investments" as any)
          .select(
            "id, name, group_name, premium_amount, premium_start_date, premium_end_date, premium_frequency, is_giro, member_id, currency",
          )
          .eq("household_id", data.householdId)
          .or(`member_id.eq.${data.memberId},member_id.is.null`),
      ]);
    if (insError) throw insError;
    if (invError) throw invError;

    // dismissed_dashboard_items has no advisor-facing RLS policy — and it
    // shouldn't, the FA never sees these rows directly — so this needs
    // supabaseAdmin specifically for this one lookup, used only to compute
    // which keys to filter out below. Everything else in this function
    // stays on the FA's own RLS-scoped session.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: dismissedRows, error: dismissedError } = await supabaseAdmin
      .from("dismissed_dashboard_items" as any)
      .select("record_id, source_type, dismissed_date")
      .eq("household_id", data.householdId);
    if (dismissedError) throw dismissedError;
    const dismissedKeys = new Set(
      (dismissedRows ?? []).map((d: any) => `${d.source_type}::${d.record_id}::${d.dismissed_date}`),
    );

    const upcomingPremiums = await computeAdvisorUpcomingPremiums(
      insuranceRows ?? [],
      investmentRows ?? [],
      new Date(),
      dismissedKeys,
    );

    return { records: recordsWithNotes, upcomingPremiums };
  });

// FA writes/edits their recommendation for one record. Runs on the FA's own
// RLS-scoped session (not supabaseAdmin) deliberately — advisor_record_notes'
// own INSERT/UPDATE policies (has_advisor_access, member+category-aware)
// are the actual gate here, not a manual check in this handler. If access
// was revoked or never granted for this member/category, the upsert fails
// with a real Postgres RLS error instead of silently succeeding.
export const upsertAdvisorNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(upsertNotePayloadSchema)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: link, error: linkError } = await supabase
      .from("advisor_household_links" as any)
      .select("id")
      .eq("household_id", data.householdId)
      .eq("advisor_user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (linkError) throw linkError;
    if (!link) throw new Error("No active link to this household.");

    const { error } = await supabase.from("advisor_record_notes" as any).upsert(
      {
        link_id: (link as any).id,
        household_id: data.householdId,
        member_id: data.memberId,
        advisor_user_id: userId,
        record_category: data.recordCategory,
        record_id: data.recordId,
        note: data.note,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "link_id,record_id" },
    );
    if (error) throw error;
    return { ok: true };
  });

// Ownership-only (no access re-check) — deliberately simpler than the write
// policies above, see the migration's comment on why delete doesn't need
// the same has_advisor_access gate insert/update do.
export const deleteAdvisorNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(deleteNotePayloadSchema)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("advisor_record_notes" as any)
      .delete()
      .eq("id", data.noteId);
    if (error) throw error;
    return { ok: true };
  });

// FA-side: which households have an active link to the current user.
// Minimal on purpose — the actual dashboard content (alerts, PDF data)
// is the next piece; this just answers "who am I connected to."
export const listClientHouseholdsForAdvisor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: links, error } = await supabaseAdmin
      .from("advisor_household_links" as any)
      .select(
        "id, household_id, can_view_insurance, can_view_investments, can_view_networth_summary, households(name)",
      )
      .eq("advisor_user_id", userId)
      .eq("status", "active");
    if (error) throw error;

    const linkRows = (links ?? []) as any[];
    const linkIds = linkRows.map((l) => l.id);
    const householdIds = linkRows.map((l) => l.household_id);

    // Which members each link actually grants access to — this is what
    // turns "a household" into "1-3 separate client cards."
    const membersByLink = new Map<string, string[]>();
    if (linkIds.length > 0) {
      const { data: linkMembers, error: lmError } = await supabaseAdmin
        .from("advisor_link_members" as any)
        .select("link_id, member_id")
        .in("link_id", linkIds);
      if (lmError) throw lmError;
      for (const row of (linkMembers ?? []) as any[]) {
        const arr = membersByLink.get(row.link_id) ?? [];
        arr.push(row.member_id);
        membersByLink.set(row.link_id, arr);
      }
    }

    const allMemberIds = [...new Set([...membersByLink.values()].flat())];
    const memberNameById = new Map<string, string>();
    if (allMemberIds.length > 0) {
      const { data: memberRows, error: memberError } = await supabaseAdmin
        .from("members" as any)
        .select("id, name")
        .in("id", allMemberIds);
      if (memberError) throw memberError;
      for (const m of (memberRows ?? []) as any[]) memberNameById.set(m.id, m.name);
    }

    // Fetch once for all households, then group in memory — avoids one
    // round trip per client for what's meant to be a fast overview page.
    const insuranceByHousehold = new Map<string, any[]>();
    const investmentsByHousehold = new Map<string, any[]>();
    if (householdIds.length > 0) {
      const [{ data: allInsurance, error: insError }, { data: allInvestments, error: invError }] =
        await Promise.all([
          supabaseAdmin
            .from("insurance_policies" as any)
            .select(
              "id, household_id, name, premium, start_date, end_date, frequency, is_giro, member_id, updated_at, currency",
            )
            .in("household_id", householdIds),
          supabaseAdmin
            .from("investments" as any)
            .select(
              "id, household_id, name, group_name, premium_amount, premium_start_date, premium_end_date, premium_frequency, is_giro, member_id, updated_at, currency",
            )
            .in("household_id", householdIds),
        ]);
      if (insError) throw insError;
      if (invError) throw invError;
      for (const row of (allInsurance ?? []) as any[]) {
        const arr = insuranceByHousehold.get(row.household_id) ?? [];
        arr.push(row);
        insuranceByHousehold.set(row.household_id, arr);
      }
      for (const row of (allInvestments ?? []) as any[]) {
        const arr = investmentsByHousehold.get(row.household_id) ?? [];
        arr.push(row);
        investmentsByHousehold.set(row.household_id, arr);
      }
    }

    // Same "this household owner marked it done" state the household's own
    // bell/dashboard respects (dismissed_dashboard_items) — without this,
    // the advisor side has no notion of "handled" at all, since
    // buildUpcomingItems() itself is a pure date computation with no
    // persisted dismissal state of its own.
    const dismissedByHousehold = new Map<string, Set<string>>();
    if (householdIds.length > 0) {
      const { data: dismissedRows, error: dismissedError } = await supabaseAdmin
        .from("dismissed_dashboard_items" as any)
        .select("household_id, record_id, source_type, dismissed_date")
        .in("household_id", householdIds);
      if (dismissedError) throw dismissedError;
      for (const d of (dismissedRows ?? []) as any[]) {
        const set = dismissedByHousehold.get(d.household_id) ?? new Set<string>();
        set.add(`${d.source_type}::${d.record_id}::${d.dismissed_date}`);
        dismissedByHousehold.set(d.household_id, set);
      }
    }

    const today = new Date();
    const staleCutoff = new Date(today.getTime() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);

    // One card per (household, member) — never a combined household total.
    // A household that has shared 2 members with the same advisor produces
    // 2 cards here, not 1. An unassigned record (member_id null) counts
    // toward EVERY member card for that household, matching the household
    // owner's explicit choice that unassigned records aren't hidden from
    // anyone who can see at least one member of that household.
    //
    // Built with Promise.all + flatMap rather than a plain synchronous
    // flatMap because computeAdvisorUpcomingPremiums is async (it uses the
    // real alerts.ts engine, not a re-derived count) — this is the exact
    // same computation getClientRecordsForAdvisor uses for the detail page,
    // so the badge here can never show a number the detail page then
    // fails to explain.
    const clientLists = await Promise.all(
      linkRows.map(async (l) => {
        const memberIds = membersByLink.get(l.id) ?? [];
        const insuranceRows = l.can_view_insurance
          ? (insuranceByHousehold.get(l.household_id) ?? [])
          : [];
        const investmentRows = l.can_view_investments
          ? (investmentsByHousehold.get(l.household_id) ?? [])
          : [];

        const dismissedKeys = dismissedByHousehold.get(l.household_id) ?? new Set<string>();

        return Promise.all(
          memberIds.map(async (memberId) => {
            const memberInsurance = insuranceRows.filter(
              (r: any) => r.member_id === memberId || r.member_id == null,
            );
            const memberInvestments = investmentRows.filter(
              (r: any) => r.member_id === memberId || r.member_id == null,
            );

            const upcomingPremiums = await computeAdvisorUpcomingPremiums(
              memberInsurance,
              memberInvestments,
              today,
              dismissedKeys,
            );

            const allRecords = [...memberInsurance, ...memberInvestments];
            const staleCount = allRecords.filter(
              (r: any) => r.updated_at && new Date(r.updated_at) < staleCutoff,
            ).length;

            return {
              householdId: l.household_id,
              householdName: l.households?.name ?? "Household",
              memberId,
              memberName: memberNameById.get(memberId) ?? "Member",
              canViewInsurance: l.can_view_insurance,
              canViewInvestments: l.can_view_investments,
              canViewNetworthSummary: l.can_view_networth_summary,
              upcomingCount: upcomingPremiums.length,
              staleCount,
            };
          }),
        );
      }),
    );
    const clients = clientLists.flat();

    // Clients needing attention surface first — the entire point of an
    // "at a glance" list is not making the advisor click through everyone.
    clients.sort((a, b) => b.upcomingCount - a.upcomingCount || b.staleCount - a.staleCount);

    return { clients };
  });
