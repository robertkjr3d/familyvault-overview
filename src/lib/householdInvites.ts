import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const invitePayloadSchema = z.object({
  householdId: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(["member", "viewer"]).default("member"),
});

const acceptPayloadSchema = z.object({
  token: z.string().min(16),
});

const listPeoplePayloadSchema = z.object({
  householdId: z.string().uuid(),
});

const transferOwnershipPayloadSchema = z.object({
  householdId: z.string().uuid(),
  email: z.string().email(),
});

const removeMemberPayloadSchema = z.object({
  householdId: z.string().uuid(),
  email: z.string().email(),
});

const cancelInvitePayloadSchema = z.object({
  householdId: z.string().uuid(),
  email: z.string().email(),
});

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const sendHouseholdInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(invitePayloadSchema)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: ownerMembership, error: ownerError } = await supabase
      .from("household_users" as any)
      .select("household_id")
      .eq("household_id", data.householdId)
      .eq("user_id", userId)
      .eq("role", "owner")
      .maybeSingle();

    if (ownerError) throw ownerError;
    if (!ownerMembership) {
      throw new Error("Only household owners can send invites.");
    }

    const invitedEmail = normalizeEmail(data.email);
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

    redirectUrl.searchParams.set("invite", token);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Prevent duplicate pending invites: if this email already has an
    // unaccepted, uncancelled, unexpired invite to this household, cancel
    // that old row first instead of leaving two "pending" rows for the same
    // person. The insert below then proceeds exactly as before - this reuses
    // the existing, already-correct insert path rather than trying to guess
    // the table's default expires_at duration.
    await supabaseAdmin
      .from("household_invites" as any)
      .update({ cancelled_at: new Date().toISOString() })
      .eq("household_id", data.householdId)
      .eq("invited_email", invitedEmail)
      .is("accepted_at", null)
      .is("cancelled_at", null);

    const { error: insertError } = await supabaseAdmin
      .from("household_invites" as any)
      .insert({
        household_id: data.householdId,
        invited_email: invitedEmail,
        role: data.role,
        invited_by_user_id: userId,
        token,
      });

    if (insertError) throw insertError;

    const { error: otpError } = await supabaseAdmin.auth.signInWithOtp({
      email: invitedEmail,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: redirectUrl.toString(),
      },
    });

    if (otpError) {
      await supabaseAdmin.from("household_invites" as any).delete().eq("token", token);
      throw otpError;
    }

    return { ok: true };
  });

export const acceptHouseholdInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(acceptPayloadSchema)
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;
    const userEmail = normalizeEmail(String(claims.email ?? ""));

    if (!userEmail) {
      throw new Error("Your account does not have a verified email.");
    }

    const token = data.token.trim();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: invite, error: inviteError } = await supabaseAdmin
      .from("household_invites" as any)
      .select("id, household_id, invited_email, role, invited_by_user_id, accepted_at, cancelled_at, expires_at")
      .eq("token", token)
      .is("accepted_at", null)
      .is("cancelled_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (inviteError) throw inviteError;
    if (!invite) {
      throw new Error("Invite link is invalid or expired.");
    }

    const invitedEmail = normalizeEmail(String(invite.invited_email ?? ""));
    if (invitedEmail !== userEmail) {
      throw new Error("This invite is for a different email account.");
    }

    const { error: membershipError } = await supabaseAdmin
      .from("household_users" as any)
      .upsert(
        {
          household_id: invite.household_id,
          user_id: userId,
          role: invite.role,
          invited_by: invite.invited_by_user_id,
        },
        { onConflict: "household_id,user_id" },
      );

    if (membershipError) throw membershipError;

    const { data: completeData, error: completeError } = await supabaseAdmin
      .from("household_invites" as any)
      .update({ accepted_at: new Date().toISOString(), accepted_by_user_id: userId })
      .eq("id", invite.id)
      .select("id")
      .maybeSingle();

    if (completeError) throw completeError;
    if (!completeData) throw new Error("This invite could not be marked accepted — it may have been cancelled.");

    return { householdId: invite.household_id as string };
  });

export const transferHouseholdOwnership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(transferOwnershipPayloadSchema)
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { error } = await supabase.rpc("transfer_household_ownership_by_email", {
      p_household_id: data.householdId,
      p_email: normalizeEmail(data.email),
    });

    if (error) throw error;
    return { ok: true };
  });

export const removeHouseholdMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(removeMemberPayloadSchema)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: ownerCheck, error: ownerError } = await supabase
      .from("household_users" as any)
      .select("household_id")
      .eq("household_id", data.householdId)
      .eq("user_id", userId)
      .eq("role", "owner")
      .maybeSingle();

    if (ownerError) throw ownerError;
    if (!ownerCheck) throw new Error("Only the household owner can remove members.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) throw listError;

    const targetUser = listData.users.find(
      (u) => normalizeEmail(u.email ?? "") === normalizeEmail(data.email)
    );
    if (!targetUser) throw new Error("No account found for that email.");
    if (targetUser.id === userId) throw new Error("You cannot remove yourself.");

    const { data: targetMembership, error: membershipError } = await supabaseAdmin
      .from("household_users" as any)
      .select("role")
      .eq("household_id", data.householdId)
      .eq("user_id", targetUser.id)
      .maybeSingle();

    if (membershipError) throw membershipError;
    if (!targetMembership) throw new Error("That person is not a member of this household.");
    if ((targetMembership as any).role === "owner") throw new Error("Cannot remove another owner. Transfer ownership first.");

    const { error: deleteError } = await supabaseAdmin
      .from("household_users" as any)
      .delete()
      .eq("household_id", data.householdId)
      .eq("user_id", targetUser.id);

    if (deleteError) throw deleteError;
    return { ok: true };
  });

export const cancelHouseholdInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(cancelInvitePayloadSchema)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: ownerCheck, error: ownerError } = await supabase
      .from("household_users" as any)
      .select("household_id")
      .eq("household_id", data.householdId)
      .eq("user_id", userId)
      .eq("role", "owner")
      .maybeSingle();

    if (ownerError) throw ownerError;
    if (!ownerCheck) throw new Error("Only household owners can cancel invites.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: cancelData, error: cancelError } = await supabaseAdmin
      .from("household_invites" as any)
      .update({ cancelled_at: new Date().toISOString() })
      .eq("household_id", data.householdId)
      .eq("invited_email", normalizeEmail(data.email))
      .is("accepted_at", null)
      .is("cancelled_at", null)
      .select("id")
      .maybeSingle();

    if (cancelError) throw cancelError;
    if (!cancelData) throw new Error("No pending invite found for that email — it may already be cancelled or accepted.");
    return { ok: true };
  });

export const listHouseholdPeople = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(listPeoplePayloadSchema)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: membership, error: membershipError } = await supabase
      .from("household_users" as any)
      .select("household_id")
      .eq("household_id", data.householdId)
      .eq("user_id", userId)
      .maybeSingle();

    if (membershipError) throw membershipError;
    if (!membership) throw new Error("You are not a member of this household.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: memberRows, error: memberError } = await supabaseAdmin
      .from("household_users" as any)
      .select("user_id, role, created_at")
      .eq("household_id", data.householdId)
      .order("created_at", { ascending: true });

    if (memberError) throw memberError;

    const typedMemberRows = (memberRows ?? []) as Array<{ user_id: string; role: string; created_at: string }>;

    // Look up all emails with ONE admin.listUsers() call instead of one
    // getUserById() call per member. Firing N concurrent admin-API calls
    // (the old approach) risks a transient failure/rate-limit on any
    // single call, which silently showed "(email unavailable)" next to
    // an unrelated, perfectly fine member — this removes that failure
    // mode for household sizes this app targets.
    // perPage covers this app's target scale (~200-300 households); if
    // total platform users ever exceed it, pagination would need handling.
    const { data: userList, error: userListError } = await supabaseAdmin.auth.admin.listUsers({
      perPage: 10000,
    });
    if (userListError) throw userListError;

    const emailByUserId = new Map((userList?.users ?? []).map((u) => [u.id, u.email ?? null]));

    const members = typedMemberRows.map((m) => ({
      email: emailByUserId.get(m.user_id) ?? "(email unavailable)",
      role: m.role as "owner" | "member" | "viewer",
      joinedAt: m.created_at,
      isYou: m.user_id === userId,
    }));

    const { data: inviteRows, error: inviteError } = await supabaseAdmin
      .from("household_invites" as any)
      .select("invited_email, role, created_at, expires_at")
      .eq("household_id", data.householdId)
      .is("accepted_at", null)
      .is("cancelled_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true });

    if (inviteError) throw inviteError;

    const pending = ((inviteRows ?? []) as Array<{ invited_email: string; role: string; created_at: string; expires_at: string }>).map(
      (i) => ({
        email: i.invited_email,
        role: i.role as "member" | "viewer",
        invitedAt: i.created_at,
        expiresAt: i.expires_at,
      })
    );

    return { members, pending };
  });

export const createDemoHousehold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existingMemberships } = await supabaseAdmin
      .from("household_users" as any)
      .select("household_id, households(id, name)")
      .eq("user_id", userId);

    const existing = (existingMemberships ?? []).find(
      (m: any) => m.households?.name === "Demo Household — FamilyHub SG"
    );
    if (existing) {
      const existingHhId = existing.households.id as string;
      // Bug fix: a previous attempt can have failed partway through (e.g. a
      // transient PostgREST schema-cache miss on the properties insert),
      // leaving a household+owner+member row behind with NO financial
      // records. Reusing it by name alone used to hand back that empty
      // shell as if it were a real, populated demo household. Verify it
      // actually has data before reusing; if not, wipe the stale shell and
      // fall through to a full rebuild below.
      const { count: propCount } = await supabaseAdmin
        .from("properties" as any)
        .select("id", { count: "exact", head: true })
        .eq("household_id", existingHhId);

      if ((propCount ?? 0) > 0) {
        return { householdId: existingHhId };
      }

      // households has no cascade to household_users/members (see
      // accountDeletion.ts notes) — clear those first, same order used
      // by the account-deletion flow, or this delete just trades one
      // FK-violation error for another.
      await supabaseAdmin.from("household_users" as any).delete().eq("household_id", existingHhId);
      await supabaseAdmin.from("members" as any).delete().eq("household_id", existingHhId);
      await supabaseAdmin.from("households" as any).delete().eq("id", existingHhId);
    }

    const { data: hh, error: hhErr } = await supabaseAdmin
      .from("households" as any)
      .insert({ name: "Demo Household — FamilyHub SG" })
      .select("id")
      .single();
    if (hhErr) throw new Error(`Could not create household: ${hhErr.message}`);
    const hhId = (hh as any).id as string;

    const { error: huErr } = await supabaseAdmin
      .from("household_users" as any)
      .insert({ household_id: hhId, user_id: userId, role: "owner" });
    if (huErr) throw new Error(`Could not add owner: ${huErr.message}`);

    const { data: member, error: mErr } = await supabaseAdmin
      .from("members" as any)
      .insert({ household_id: hhId, name: "Alex Tan", emoji: "👨", color: "#4F8EF7" })
      .select("id")
      .single();
    if (mErr) throw new Error(`Could not create member: ${mErr.message}`);
    const memberId = (member as any).id as string;

    const today = new Date();
    const nextYear = today.getFullYear() + 1;
    const in2Years = today.getFullYear() + 2;

    const { error: propErr } = await supabaseAdmin.from("properties" as any).insert({
      household_id: hhId, member_id: memberId, is_demo: true,
      name: "3-Room HDB, Tampines",
      purchase_price: 380000, current_value: 450000,
      monthly_rent: 0, status: "settled",
    });
    if (propErr) throw new Error(`properties: ${propErr.message}`);

    const { error: loanErr } = await supabaseAdmin.from("loans" as any).insert({
      household_id: hhId, member_id: memberId, is_demo: true,
      name: "HDB Housing Loan", loan_type: "mortgage",
      balance: 210000, monthly_payment: 1450, interest_rate: 2.6,
      repricing_date: `${nextYear}-03-01`, status: "settled",
    });
    if (loanErr) throw new Error(`loans: ${loanErr.message}`);

    const { error: ins1Err } = await supabaseAdmin.from("insurance_policies" as any).insert({
      household_id: hhId, member_id: memberId, is_demo: true,
      name: "Prudential PruLife", category: "whole_life",
      sum_assured: 200000, monthly_premium: 320,
      payment_frequency: "monthly", start_date: "2018-06-01",
      end_date: `${in2Years}-06-01`, status: "settled",
    });
    if (ins1Err) throw new Error(`insurance 1: ${ins1Err.message}`);

    const { error: ins2Err } = await supabaseAdmin.from("insurance_policies" as any).insert({
      household_id: hhId, member_id: memberId, is_demo: true,
      name: "AIA HealthShield Gold", category: "hospitalisation",
      sum_assured: 0, monthly_premium: 85,
      payment_frequency: "annual", start_date: "2020-01-01",
      end_date: `${nextYear}-01-01`, status: "settled",
    });
    if (ins2Err) throw new Error(`insurance 2: ${ins2Err.message}`);

    const { error: invErr } = await supabaseAdmin.from("investments" as any).insert({
      household_id: hhId, member_id: memberId, is_demo: true,
      name: "Manulife InvestReady III", investment_type: "ILP",
      current_value: 52000, monthly_premium: 500,
      start_date: "2019-09-01",
      maturity_date: `${today.getFullYear() + 15}-09-01`,
      status: "review",
    });
    if (invErr) throw new Error(`investments: ${invErr.message}`);

    const { error: savErr } = await supabaseAdmin.from("savings_accounts" as any).insert({
      household_id: hhId, member_id: memberId, is_demo: true,
      name: "DBS Multiplier", account_type: "savings",
      balance: 38000, interest_rate: 3.5, status: "settled",
    });
    if (savErr) throw new Error(`savings: ${savErr.message}`);

    const { error: settErr } = await supabaseAdmin.from("app_settings" as any).upsert({
      household_id: hhId,
      monthly_income: 7200, monthly_expenses: 3500,
      currency: "SGD", mortgage_days: 90, insurance_days: 60,
      fd_days: 30, warranty_days: 90, onboarding_dismissed: true,
    }, { onConflict: "household_id" });
    if (settErr) throw new Error(`app_settings: ${settErr.message}`);

    return { householdId: hhId };
  });
