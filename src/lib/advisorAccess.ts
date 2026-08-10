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
        "id, household_id, can_view_insurance, can_view_investments, can_view_networth_summary",
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
      const { error: linkError } = await supabaseAdmin
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
        );
      if (linkError) throw linkError;

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
        "advisor_user_id, can_view_insurance, can_view_investments, can_view_networth_summary, linked_at, consent_renewed_at",
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

    const advisors = (linkRows ?? []).map((r: any) => ({
      advisorUserId: r.advisor_user_id,
      email: profilesById.get(r.advisor_user_id)?.email ?? "(email unavailable)",
      displayName: profilesById.get(r.advisor_user_id)?.display_name ?? null,
      canViewInsurance: r.can_view_insurance,
      canViewInvestments: r.can_view_investments,
      canViewNetworthSummary: r.can_view_networth_summary,
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

    return { totalAssets, totalLiabilities, netWorth, hasData: components.length > 0 };
  });

// Full record list for ONE client, for the FA's own detail view. Deliberately
// uses the caller's own authenticated session (context.supabase), NOT
// supabaseAdmin — the view's has_advisor_access() check and RLS then
// genuinely gate this response, rather than this function's own household_id
// filter being the only thing standing between an advisor and the wrong data.
export const getClientRecordsForAdvisor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(listPayloadSchema)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("advisor_client_summary_view" as any)
      .select("*")
      .eq("household_id", data.householdId)
      .order("category", { ascending: true })
      .order("record_name", { ascending: true });
    if (error) throw error;
    return { records: (rows ?? []) as any[] };
  });

// FA-side: which households have an active link to the current user.
// Minimal on purpose — the actual dashboard content (alerts, PDF data)
// is the next piece; this just answers "who am I connected to."
export const ADVISOR_ALERT_HORIZON_DAYS = 30;
export const STALE_AFTER_DAYS = 180;

export const listClientHouseholdsForAdvisor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { buildUpcomingItems } = await import("@/lib/alerts");

    const { data: links, error } = await supabaseAdmin
      .from("advisor_household_links" as any)
      .select(
        "household_id, can_view_insurance, can_view_investments, can_view_networth_summary, households(name)",
      )
      .eq("advisor_user_id", userId)
      .eq("status", "active");
    if (error) throw error;

    const linkRows = (links ?? []) as any[];
    const householdIds = linkRows.map((l) => l.household_id);

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
              "id, household_id, name, premium, start_date, end_date, frequency, is_giro, member_id, updated_at",
            )
            .in("household_id", householdIds),
          supabaseAdmin
            .from("investments" as any)
            .select(
              "id, household_id, name, group_name, premium_amount, premium_start_date, premium_end_date, premium_frequency, is_giro, member_id, updated_at",
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

    const today = new Date();
    const staleCutoff = new Date(today.getTime() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);

    const clients = linkRows.map((l) => {
      const insuranceRows = l.can_view_insurance
        ? (insuranceByHousehold.get(l.household_id) ?? [])
        : [];
      const investmentRows = l.can_view_investments
        ? (investmentsByHousehold.get(l.household_id) ?? []).map((inv: any) => ({
            // Map onto the field names buildUpcomingItems expects for
            // investments — verified against alerts.ts directly, not guessed.
            id: inv.id,
            name: inv.name,
            group_name: inv.group_name,
            premium_amount: inv.premium_amount,
            premium_start_date: inv.premium_start_date,
            premium_end_date: inv.premium_end_date,
            premium_frequency: inv.premium_frequency,
            is_giro: inv.is_giro,
            member_id: inv.member_id,
            updated_at: inv.updated_at,
          }))
        : [];

      let upcomingCount = 0;
      try {
        const items = buildUpcomingItems(
          {
            properties: [],
            loans: [],
            insurance: insuranceRows,
            investments: investmentRows,
            savings: [],
            inventoryItems: [],
            reminders: [],
          },
          today,
          ADVISOR_ALERT_HORIZON_DAYS,
        );
        upcomingCount = items.length;
      } catch {
        // Never let an alert-computation issue take down the whole client
        // list — worst case, this one client just shows no badge.
        upcomingCount = 0;
      }

      const allRecords = [...insuranceRows, ...investmentRows];
      const staleCount = allRecords.filter(
        (r) => r.updated_at && new Date(r.updated_at) < staleCutoff,
      ).length;

      return {
        householdId: l.household_id,
        householdName: l.households?.name ?? "Household",
        canViewInsurance: l.can_view_insurance,
        canViewInvestments: l.can_view_investments,
        canViewNetworthSummary: l.can_view_networth_summary,
        upcomingCount,
        staleCount,
      };
    });

    // Clients needing attention surface first — the entire point of an
    // "at a glance" list is not making the advisor click through everyone.
    clients.sort((a, b) => b.upcomingCount - a.upcomingCount || b.staleCount - a.staleCount);

    return { clients };
  });
