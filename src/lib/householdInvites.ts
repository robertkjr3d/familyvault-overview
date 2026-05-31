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

    const { error: completeError } = await supabaseAdmin
      .from("household_invites" as any)
      .update({ accepted_at: new Date().toISOString(), accepted_by_user_id: userId })
      .eq("id", invite.id);

    if (completeError) throw completeError;

    return { householdId: invite.household_id as string };
  });
