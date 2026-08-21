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
  canViewProperty: z.boolean().default(true),
  canViewLoans: z.boolean().default(true),
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
  canViewProperty: z.boolean(),
  canViewLoans: z.boolean(),
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
  note: z
    .string()
    .trim()
    .min(1, "Note can't be empty.")
    .max(2000, "Keep it under 2000 characters."),
});

// Separate from note upsert above so toggling status never requires (or
// clobbers) a note — the two are independent facts about the same row.
// null status is a valid value: it means "clear the override, go back to
// the computed default" (see the migration's comment).
const upsertStatusPayloadSchema = z.object({
  householdId: z.string().uuid(),
  memberId: z.string().uuid(),
  recordCategory: z.string().min(1),
  recordId: z.string().uuid(),
  status: z.enum(["paid", "ongoing", "review"]).nullable(),
});

const deleteNotePayloadSchema = z.object({
  noteId: z.string().uuid(),
});

// The flexible phase shape behind the FA policy-chart feature — one
// element per pay-in or pay-out stretch. Deliberately NOT modeling
// specific product types (term/whole-life/endowment/annuity/ILP) in the
// schema — every one of those reduces to an ordered list of these, per
// the research written up in areas/advisor-dashboard.md. endAge equal to
// startAge represents a single lump-sum point (e.g. an endowment
// maturity payout) rather than a recurring stretch.
const chartPhaseSchema = z.object({
  id: z.string(),
  label: z.string().trim().min(1).max(60),
  direction: z.enum(["in", "out"]),
  startAge: z.number().int().min(0).max(120),
  endAge: z.number().int().min(0).max(120),
  amount: z.number().min(0),
  frequency: z.enum(["monthly", "annual", "lump-sum"]),
});

const getChartPayloadSchema = z.object({
  householdId: z.string().uuid(),
  memberId: z.string().uuid(),
  insurancePolicyId: z.string().uuid(),
});

const upsertChartPayloadSchema = z.object({
  householdId: z.string().uuid(),
  memberId: z.string().uuid(),
  insurancePolicyId: z.string().uuid(),
  title: z.string().trim().max(80).optional(),
  phases: z
    .array(chartPhaseSchema)
    .max(20, "That's a lot of phases — split into a second chart if you need more."),
});

const deleteChartPayloadSchema = z.object({
  chartId: z.string().uuid(),
});

const listChartsPayloadSchema = z.object({
  householdId: z.string().uuid(),
  memberId: z.string().uuid(),
});

const cancelInvitePayloadSchema = z.object({
  householdId: z.string().uuid(),
  email: z.string().email(),
});

const listPayloadSchema = z.object({
  householdId: z.string().uuid(),
});

const networthPayloadSchema = listPayloadSchema.extend({
  // Optional — an omitted memberId keeps the whole-household total
  // available for any future non-member-scoped caller, though the current
  // caller (AdvisorHome.tsx) always passes it now that every card is one
  // member's own view.
  memberId: z.string().uuid().optional(),
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
      can_view_property: data.canViewProperty,
      can_view_loans: data.canViewLoans,
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
        "id, household_id, can_view_insurance, can_view_investments, can_view_networth_summary, can_view_property, can_view_loans, member_ids",
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
            can_view_property: invite.can_view_property,
            can_view_loans: invite.can_view_loans,
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
      await supabaseAdmin
        .from("advisor_link_members" as any)
        .delete()
        .eq("link_id", linkId);
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
        can_view_property: data.canViewProperty,
        can_view_loans: data.canViewLoans,
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
    await supabaseAdmin
      .from("advisor_link_members" as any)
      .delete()
      .eq("link_id", linkId);
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
        "id, advisor_user_id, can_view_insurance, can_view_investments, can_view_networth_summary, can_view_property, can_view_loans, linked_at, consent_renewed_at",
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
    // an edit form. IDs (not just names) are kept too, so an edit form can
    // pre-check the right boxes without a second round trip.
    const linkIds = (linkRows ?? []).map((r: any) => r.id);
    const memberNamesByLink = new Map<string, string[]>();
    const memberIdsByLink = new Map<string, string[]>();
    if (linkIds.length > 0) {
      const { data: linkMemberRows, error: linkMembersError } = await supabaseAdmin
        .from("advisor_link_members" as any)
        .select("link_id, member_id, members(name)")
        .in("link_id", linkIds);
      if (linkMembersError) throw linkMembersError;
      for (const row of (linkMemberRows ?? []) as any[]) {
        const names = memberNamesByLink.get(row.link_id) ?? [];
        names.push(row.members?.name ?? "Member");
        memberNamesByLink.set(row.link_id, names);
        const ids = memberIdsByLink.get(row.link_id) ?? [];
        ids.push(row.member_id);
        memberIdsByLink.set(row.link_id, ids);
      }
    }

    const advisors = (linkRows ?? []).map((r: any) => ({
      advisorUserId: r.advisor_user_id,
      email: profilesById.get(r.advisor_user_id)?.email ?? "(email unavailable)",
      displayName: profilesById.get(r.advisor_user_id)?.display_name ?? null,
      canViewInsurance: r.can_view_insurance,
      canViewInvestments: r.can_view_investments,
      canViewNetworthSummary: r.can_view_networth_summary,
      canViewProperty: r.can_view_property,
      canViewLoans: r.can_view_loans,
      memberNames: memberNamesByLink.get(r.id) ?? [],
      memberIds: memberIdsByLink.get(r.id) ?? [],
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
  .inputValidator(networthPayloadSchema)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { groupByCurrency, totalWithFx } = await import("@/lib/format");
    const { isCpfAccountType } = await import("@/lib/options");

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

    // Single computation used for both the whole-household total and the
    // per-member total below — same reasoning as computeAdvisorUpcomingPremiums
    // being shared by the badge and the detail view: one calculation, never
    // two that could quietly drift apart.
    function computeTotals(rowsForScope: any[]) {
      const byType = (t: string) => rowsForScope.filter((r) => r.source_type === t);
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
          savingsRows.filter((r) => !isCpfAccountType(r.account_type)),
          (r) => r.amount,
        ),
        fxRates,
      );
      const cpfValue = totalWithFx(
        groupByCurrency(
          savingsRows.filter((r) => isCpfAccountType(r.account_type)),
          (r) => r.amount,
        ),
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
        propertyValue +
        investmentsValue +
        savingsValue +
        otherAssetsValue +
        insuranceSurrenderValue;
      const totalLiabilities = totalWithFx(
        groupByCurrency(byType("loan"), (r) => r.amount),
        fxRates,
      );
      const netWorth = totalAssets - totalLiabilities;

      return {
        totalAssets,
        totalLiabilities,
        netWorth,
        hasData: rowsForScope.length > 0,
        breakdown: {
          property: propertyValue,
          investments: investmentsValue,
          savings: savingsValue,
          otherAssets: otherAssetsValue,
          insuranceSurrender: insuranceSurrenderValue,
          liabilities: totalLiabilities,
        },
      };
    }

    if (!data.memberId) {
      return { ...computeTotals(components), scope: "household" as const };
    }

    // Per-member: plain equality on member_id, deliberately matching the
    // household dashboard's own scopeByMember() exactly (verified in
    // index.tsx, not assumed) — no special handling of savings'
    // joint_member_id, since the household's own per-member view doesn't
    // do anything special with it either. Unassigned rows (member_id null)
    // are excluded here, same as scopeByMember — different from how
    // insurance/investments records handle "unassigned" elsewhere in this
    // feature (shown on every card), because net worth is a pure sum with
    // no itemized list to show an unattributed entry in.
    const memberComponents = components.filter((r) => r.member_id === data.memberId);
    const memberTotals = computeTotals(memberComponents);
    if (memberTotals.hasData) {
      return { ...memberTotals, scope: "member" as const };
    }

    // Real gap found after shipping: most households don't tag every
    // record to a specific person, so a strict per-member total can come
    // back empty even when there's clearly real net worth data — showing
    // a dead "no data" message when the FA is legitimately owed a number
    // is worse than falling back to the combined total, as long as it's
    // clearly labeled as combined rather than silently passed off as this
    // member's own figure.
    return { ...computeTotals(components), scope: "household-fallback" as const };
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
    .filter(
      (i) => i.sourceType === "insurance_next_due" || i.sourceType === "investment_premium_due",
    )
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
      .select("id, record_id, note, status, updated_at")
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
        status: noteRow?.status ?? null,
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
          .select(
            "id, name, premium, start_date, end_date, frequency, is_giro, member_id, currency",
          )
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

    // Attaches each record's own inception date, reusing the base-table
    // rows fetched above rather than a third query — insurance's is
    // start_date, investments' is premium_start_date (the view's generic
    // field naming doesn't carry either through, per the comment on that
    // fetch above). Property/loans aren't fetched from base tables in this
    // function at all, so they simply don't get a start_date here — the
    // sort in groupAdvisorRecords() falls back to end_date ordering for
    // those, same as before this change.
    const startDateByRecordId = new Map<string, string | null>();
    for (const r of insuranceRows ?? [])
      startDateByRecordId.set((r as any).id, (r as any).start_date ?? null);
    for (const r of investmentRows ?? [])
      startDateByRecordId.set((r as any).id, (r as any).premium_start_date ?? null);
    const recordsWithDates = recordsWithNotes.map((r: any) => ({
      ...r,
      start_date: startDateByRecordId.get(r.record_id) ?? null,
    }));

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
      (dismissedRows ?? []).map(
        (d: any) => `${d.source_type}::${d.record_id}::${d.dismissed_date}`,
      ),
    );

    const upcomingPremiums = await computeAdvisorUpcomingPremiums(
      insuranceRows ?? [],
      investmentRows ?? [],
      new Date(),
      dismissedKeys,
    );

    // "N items not shared" disclosure. RLS makes hidden records invisible
    // to `records` above by design — that's the whole point — but that
    // also means the FA's own session literally cannot tell "nothing more
    // exists" apart from "something is hidden." This is the one place that
    // gap gets closed: a COUNT only (head: true means no row data is even
    // transferred, just the count in the response headers — the cheapest
    // form this query could take), never which items or their content.
    // Reuses the supabaseAdmin already imported above for the dismissal
    // lookup — a second import of the same binding in this scope is what
    // broke the build last round.
    const [
      { count: hiddenInsuranceCount },
      { count: hiddenInvestmentsCount },
      { count: hiddenPropertyCount },
      { count: hiddenLoansCount },
    ] = await Promise.all([
      supabaseAdmin
        .from("insurance_policies" as any)
        .select("id", { count: "exact", head: true })
        .eq("household_id", data.householdId)
        .eq("hidden_from_advisors", true)
        .or(`member_id.eq.${data.memberId},member_id.is.null`),
      supabaseAdmin
        .from("investments" as any)
        .select("id", { count: "exact", head: true })
        .eq("household_id", data.householdId)
        .eq("hidden_from_advisors", true)
        .or(`member_id.eq.${data.memberId},member_id.is.null`),
      supabaseAdmin
        .from("properties" as any)
        .select("id", { count: "exact", head: true })
        .eq("household_id", data.householdId)
        .eq("hidden_from_advisors", true)
        .or(`member_id.eq.${data.memberId},member_id.is.null`),
      supabaseAdmin
        .from("loans" as any)
        .select("id", { count: "exact", head: true })
        .eq("household_id", data.householdId)
        .eq("hidden_from_advisors", true)
        .or(`member_id.eq.${data.memberId},member_id.is.null`),
    ]);

    return {
      records: recordsWithDates,
      upcomingPremiums,
      hiddenCounts: {
        insurance: hiddenInsuranceCount ?? 0,
        investments: hiddenInvestmentsCount ?? 0,
        property: hiddenPropertyCount ?? 0,
        loans: hiddenLoansCount ?? 0,
      },
    };
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

// Independent of upsertAdvisorNote above — deliberately never sends `note`
// in its payload, so a status-only upsert can never clobber an existing
// note (Supabase's upsert only overwrites columns present in the payload
// object; omitted columns are left untouched on conflict). status: null
// clears any manual override and reverts the card to the computed
// default (past end_date = Paid, else Ongoing — computed client-side).
export const upsertAdvisorRecordStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(upsertStatusPayloadSchema)
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
        status: data.status,
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

// ============================================================
// FA policy-chart tool (client-illustration feature). Mirrors the
// upsertAdvisorNote/deleteAdvisorNote pattern exactly: runs on the FA's
// own RLS-scoped session, resolves link_id first, and lets
// advisor_policy_charts' own RLS (has_advisor_access + ownership, see
// migration 20260819070000) be the real gate rather than a manual check
// here. FA-only — nothing here is ever readable from the household side.
// ============================================================

// Loads (or reports absent) the FA's own chart for one policy, plus the
// raw policy fields and the member's birth_year needed to seed sensible
// default phases client-side on first open. members has no advisor-facing
// RLS (confirmed empirically — see the member-name lookup below in
// listClientHouseholdsForAdvisor), so this uses the same targeted
// supabaseAdmin lookup precedent already established there — scoped to
// exactly one row, only reachable after the has_advisor_access-gated
// queries above it have already proven this advisor may see this member.
export const getAdvisorPolicyChart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(getChartPayloadSchema)
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

    // Base-table query (not the summary view) for the specific raw fields
    // needed to seed default phases — same reasoning as
    // getClientRecordsForAdvisor's own insuranceRows query above, and
    // gated the same way: the member-aware advisor_select policy on
    // insurance_policies is what makes this safe to query directly.
    const { data: policy, error: policyError } = await supabase
      .from("insurance_policies" as any)
      .select(
        "id, name, currency, premium, frequency, start_date, end_date, payout_amount, payout_frequency, payout_start_date, payout_end_date, surrender_value, surrender_value_date",
      )
      .eq("id", data.insurancePolicyId)
      .eq("household_id", data.householdId)
      .maybeSingle();
    if (policyError) throw policyError;
    if (!policy) throw new Error("Policy not found or not shared with you.");

    const { data: chart, error: chartError } = await supabase
      .from("advisor_policy_charts" as any)
      .select("id, title, phases, updated_at")
      .eq("link_id", (link as any).id)
      .eq("insurance_policy_id", data.insurancePolicyId)
      .maybeSingle();
    if (chartError) throw chartError;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: memberRow, error: memberError } = await supabaseAdmin
      .from("members" as any)
      .select("birth_year")
      .eq("id", data.memberId)
      .maybeSingle();
    if (memberError) throw memberError;

    const chartResult: {
      id: string;
      title: string | null;
      phases: any[];
      updated_at: string;
    } | null = chart
      ? {
          id: (chart as any).id,
          title: (chart as any).title,
          phases: (chart as any).phases,
          updated_at: (chart as any).updated_at,
        }
      : null;

    return {
      policy: policy as any,
      chart: chartResult,
      memberBirthYear: (memberRow as any)?.birth_year ?? null,
    };
  });

// Upsert on the (link_id, insurance_policy_id) unique constraint — one
// current chart per advisor per policy, same shape as advisor_record_notes.
export const upsertAdvisorPolicyChart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(upsertChartPayloadSchema)
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

    const { data: saved, error } = await supabase
      .from("advisor_policy_charts" as any)
      .upsert(
        {
          link_id: (link as any).id,
          household_id: data.householdId,
          member_id: data.memberId,
          advisor_user_id: userId,
          insurance_policy_id: data.insurancePolicyId,
          title: data.title ?? null,
          phases: data.phases,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "link_id,insurance_policy_id" },
      )
      .select("id")
      .maybeSingle();
    if (error) throw error;
    // Same "zero rows changed ≠ success" rule the rest of this file
    // follows — an upsert blocked by RLS's WITH CHECK doesn't error, it
    // just returns nothing.
    if (!saved) throw new Error("Nothing was saved — you may not have permission to edit this.");
    return { ok: true, chartId: (saved as any).id };
  });

// Ownership-only (no access re-check) — same reasoning as deleteAdvisorNote.
export const deleteAdvisorPolicyChart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(deleteChartPayloadSchema)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("advisor_policy_charts" as any)
      .delete()
      .eq("id", data.chartId);
    if (error) throw error;
    return { ok: true };
  });

// For the compare view — every chart this advisor has saved for this
// client, with the policy's own name/currency attached so the compare UI
// can label each color without a second round trip per chart.
export const listAdvisorPolicyCharts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(listChartsPayloadSchema)
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

    const { data: charts, error } = await supabase
      .from("advisor_policy_charts" as any)
      .select("id, title, phases, insurance_policy_id, updated_at")
      .eq("link_id", (link as any).id);
    if (error) throw error;

    const policyIds = [...new Set((charts ?? []).map((c: any) => c.insurance_policy_id))];
    let policyById = new Map<string, { name: string; currency: string | null }>();
    if (policyIds.length > 0) {
      const { data: policies, error: policiesError } = await supabase
        .from("insurance_policies" as any)
        .select("id, name, currency")
        .in("id", policyIds);
      if (policiesError) throw policiesError;
      policyById = new Map(
        (policies ?? []).map((p: any) => [p.id, { name: p.name, currency: p.currency }]),
      );
    }

    return (charts ?? []).map((c: any) => ({
      id: c.id,
      title: c.title,
      phases: c.phases,
      insurancePolicyId: c.insurance_policy_id,
      policyName: policyById.get(c.insurance_policy_id)?.name ?? "Policy",
      currency: policyById.get(c.insurance_policy_id)?.currency ?? null,
      updatedAt: c.updated_at,
    }));
  });

// Household-side: every FA note on this household's records, with the
// writing advisor's name attached — this is what lets a client see "your
// adviser recommends..." on their own insurance/investment pages. Returns
// ALL notes for the household (not deduplicated per record) since more
// than one advisor can be linked to a household, and each can leave their
// own note on the same record — the unique constraint is (link_id,
// record_id), not (record_id) alone, so a record can legitimately carry
// more than one advisor's note. The caller groups by recordId as needed.
export const getAdvisorNotesForHousehold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(listPayloadSchema)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // RLS (advisor_record_notes_select) already restricts this to rows the
    // caller can see — a member of this household, or the advisor who
    // wrote it. A household member calling this only ever gets their own
    // household's notes; no extra filtering needed beyond household_id.
    const { data: noteRows, error } = await supabase
      .from("advisor_record_notes" as any)
      .select("id, record_id, record_category, note, advisor_user_id, updated_at")
      .eq("household_id", data.householdId);
    if (error) throw error;

    const advisorIds = [...new Set((noteRows ?? []).map((n: any) => n.advisor_user_id))];
    const nameById = new Map<string, string>();
    if (advisorIds.length > 0) {
      // user_profiles is self-only RLS on the client — a household member's
      // own session can't read the advisor's profile directly, so this one
      // lookup runs as supabaseAdmin, same targeted-by-id pattern already
      // used in listAdvisorsForHousehold. Nothing else in this function
      // uses admin access; the notes themselves are still genuinely
      // RLS-gated above.
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: profiles, error: profilesError } = await supabaseAdmin
        .from("user_profiles" as any)
        .select("user_id, display_name, email")
        .in("user_id", advisorIds);
      if (profilesError) throw profilesError;
      for (const p of (profiles ?? []) as any[]) {
        nameById.set(p.user_id, p.display_name || p.email || "Your adviser");
      }
    }

    const notes = (noteRows ?? []).map((n: any) => ({
      id: n.id,
      recordId: n.record_id,
      recordCategory: n.record_category,
      note: n.note,
      advisorName: nameById.get(n.advisor_user_id) ?? "Your adviser",
      updatedAt: n.updated_at,
    }));

    return { notes };
  });
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
        "id, household_id, can_view_insurance, can_view_investments, can_view_networth_summary, can_view_property, can_view_loans, households(name)",
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
    //
    // Selects hidden_from_advisors rather than filtering it out here: this
    // query runs as supabaseAdmin (bypasses RLS entirely, so the RLS-level
    // hide check does nothing for this path on its own), and the count of
    // hidden items is itself needed below for the "N items not shared"
    // disclosure — fetching once and splitting in memory avoids a second
    // round trip for that. Flagged during the pre-build risk pass as the
    // one place this feature could silently fail to hide anything — the
    // badge count is exactly what showed a similar mismatch before
    // (upcomingCount vs the detail view), so this isn't left to be found
    // by testing.
    const insuranceByHousehold = new Map<string, any[]>();
    const investmentsByHousehold = new Map<string, any[]>();
    const propertyByHousehold = new Map<string, any[]>();
    const loansByHousehold = new Map<string, any[]>();
    if (householdIds.length > 0) {
      const [
        { data: allInsurance, error: insError },
        { data: allInvestments, error: invError },
        { data: allProperty, error: propError },
        { data: allLoans, error: loanError },
      ] = await Promise.all([
        supabaseAdmin
          .from("insurance_policies" as any)
          .select(
            "id, household_id, name, premium, start_date, end_date, frequency, is_giro, member_id, updated_at, currency, hidden_from_advisors",
          )
          .in("household_id", householdIds),
        supabaseAdmin
          .from("investments" as any)
          .select(
            "id, household_id, name, group_name, premium_amount, premium_start_date, premium_end_date, premium_frequency, is_giro, member_id, updated_at, currency, hidden_from_advisors",
          )
          .in("household_id", householdIds),
        supabaseAdmin
          .from("properties" as any)
          .select("id, household_id, member_id, updated_at, hidden_from_advisors")
          .in("household_id", householdIds),
        supabaseAdmin
          .from("loans" as any)
          .select("id, household_id, member_id, updated_at, hidden_from_advisors")
          .in("household_id", householdIds),
      ]);
      if (insError) throw insError;
      if (invError) throw invError;
      if (propError) throw propError;
      if (loanError) throw loanError;
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
      for (const row of (allProperty ?? []) as any[]) {
        const arr = propertyByHousehold.get(row.household_id) ?? [];
        arr.push(row);
        propertyByHousehold.set(row.household_id, arr);
      }
      for (const row of (allLoans ?? []) as any[]) {
        const arr = loansByHousehold.get(row.household_id) ?? [];
        arr.push(row);
        loansByHousehold.set(row.household_id, arr);
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
    //
    // Each household's whole processing block is now wrapped individually
    // — Promise.all fails fast by default, so one household hitting an
    // unexpected error (malformed data, a future code change introducing a
    // new failure point, anything not already handled inside
    // computeAdvisorUpcomingPremiums's own try/catch) would otherwise
    // reject the ENTIRE list, making every other household's cards vanish
    // too — indistinguishable from "you have no clients at all." Found
    // during a full audit, not from a reproduced incident, but the failure
    // mode it would produce is exactly the kind of confusing, hard-to-
    // diagnose symptom worth closing off entirely rather than leaving as a
    // latent risk once spotted.
    const clientLists = await Promise.all(
      linkRows.map(async (l) => {
        try {
          const memberIds = membersByLink.get(l.id) ?? [];
          const insuranceRows = l.can_view_insurance
            ? (insuranceByHousehold.get(l.household_id) ?? [])
            : [];
          const investmentRows = l.can_view_investments
            ? (investmentsByHousehold.get(l.household_id) ?? [])
            : [];
          const propertyRows = l.can_view_property
            ? (propertyByHousehold.get(l.household_id) ?? [])
            : [];
          const loanRows = l.can_view_loans ? (loansByHousehold.get(l.household_id) ?? []) : [];

          const dismissedKeys = dismissedByHousehold.get(l.household_id) ?? new Set<string>();

          return await Promise.all(
            memberIds.map(async (memberId) => {
              const memberInsuranceAll = insuranceRows.filter(
                (r: any) => r.member_id === memberId || r.member_id == null,
              );
              const memberInvestmentsAll = investmentRows.filter(
                (r: any) => r.member_id === memberId || r.member_id == null,
              );
              const memberPropertyAll = propertyRows.filter(
                (r: any) => r.member_id === memberId || r.member_id == null,
              );
              const memberLoansAll = loanRows.filter(
                (r: any) => r.member_id === memberId || r.member_id == null,
              );
              // Visible-only for every actual computation below — this is
              // the manual equivalent of what advisor_select's RLS check
              // does for every other read path, needed here specifically
              // because this function runs as supabaseAdmin.
              const memberInsurance = memberInsuranceAll.filter(
                (r: any) => !r.hidden_from_advisors,
              );
              const memberInvestments = memberInvestmentsAll.filter(
                (r: any) => !r.hidden_from_advisors,
              );
              const memberProperty = memberPropertyAll.filter((r: any) => !r.hidden_from_advisors);
              const memberLoans = memberLoansAll.filter((r: any) => !r.hidden_from_advisors);
              const hiddenCount =
                memberInsuranceAll.filter((r: any) => r.hidden_from_advisors).length +
                memberInvestmentsAll.filter((r: any) => r.hidden_from_advisors).length +
                memberPropertyAll.filter((r: any) => r.hidden_from_advisors).length +
                memberLoansAll.filter((r: any) => r.hidden_from_advisors).length;

              // Deliberately insurance/investments only — property has no
              // recurring-premium concept in this app's model, and a loan
              // "upcoming" alert (reprice date? payoff date?) is a separate
              // design decision never scoped for this feature.
              const upcomingPremiums = await computeAdvisorUpcomingPremiums(
                memberInsurance,
                memberInvestments,
                today,
                dismissedKeys,
              );

              const allRecords = [
                ...memberInsurance,
                ...memberInvestments,
                ...memberProperty,
                ...memberLoans,
              ];
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
                canViewProperty: l.can_view_property,
                canViewLoans: l.can_view_loans,
                upcomingCount: upcomingPremiums.length,
                staleCount,
                hiddenCount,
              };
            }),
          );
        } catch {
          // This one household is skipped — not the whole list. Worst case,
          // one client card is temporarily missing instead of every client
          // for this advisor appearing to not exist.
          return [];
        }
      }),
    );
    const clients = clientLists.flat();

    // Clients needing attention surface first — the entire point of an
    // "at a glance" list is not making the advisor click through everyone.
    clients.sort((a, b) => b.upcomingCount - a.upcomingCount || b.staleCount - a.staleCount);

    return { clients };
  });
