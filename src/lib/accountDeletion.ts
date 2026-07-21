import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const deleteAccountPayloadSchema = z.object({
  confirmEmail: z.string().email(),
});

// Tables that BLOCK deletion of a household until their household-scoped
// rows are cleared first (confirmed July 2026 via a live foreign-key
// introspection query against the actual database - none of these have
// ON DELETE CASCADE set on their household_id column, so Postgres refuses
// to delete a household row while any of these still reference it).
//
// Order does not matter between these tables: every relationship BETWEEN
// them (member_id, property_id, loan_id, folder_id, etc.) is either
// ON DELETE CASCADE or ON DELETE SET NULL - never blocking. The only
// blocking relationship each of these has is its own household_id column
// pointing at households(id).
const HOUSEHOLD_BLOCKING_TABLES = [
  "app_settings",
  "gobag_items",
  "health_conditions",
  "inventory_folders",
  "inventory_items",
  "insurance_policies",
  "investments",
  "loan_rate_schedule",
  "loans",
  "members",
  "properties",
  "property_rate_schedule",
  "record_documents",
  "record_history",
  "reminders",
  "savings_accounts",
] as const;

// These tables ALSO reference households(id), but all have ON DELETE CASCADE
// (confirmed via the same introspection query) - deleting the household row
// cleans these up automatically, no code needed:
// dismissed_dashboard_items, estate_checklist, household_invites,
// household_users, other_assets, travel_checklist_items

const STORAGE_BUCKETS = ["vault-docs", "inventory-photos"] as const;

// Every upload in this app is stored under a "<household_id>/..." path
// (confirmed by reading the exact path-construction code in DocumentsList.tsx
// and inventory.tsx) - so recursively deleting everything under that prefix
// in both buckets removes every real file, not just ones a DB row happens
// to still reference.
async function deleteStorageFolder(supabaseAdmin: any, bucket: string, path: string): Promise<void> {
  const { data: entries, error } = await supabaseAdmin.storage.from(bucket).list(path, { limit: 1000 });
  if (error || !entries) return;

  const filePaths: string[] = [];
  for (const entry of entries as Array<{ name: string; id: string | null }>) {
    const entryPath = `${path}/${entry.name}`;
    // Supabase Storage: real files have an id; folder-like prefixes don't.
    if (entry.id) {
      filePaths.push(entryPath);
    } else {
      await deleteStorageFolder(supabaseAdmin, bucket, entryPath);
    }
  }
  if (filePaths.length > 0) {
    await supabaseAdmin.storage.from(bucket).remove(filePaths);
  }
}

async function deleteHouseholdCompletely(supabaseAdmin: any, householdId: string): Promise<void> {
  // Storage cleanup is best-effort: a failure here is a leftover-cost issue,
  // not a data-integrity or security one, so it should never block the
  // actual data deletion below.
  for (const bucket of STORAGE_BUCKETS) {
    try {
      await deleteStorageFolder(supabaseAdmin, bucket, householdId);
    } catch (e) {
      console.error(`Storage cleanup failed for household ${householdId} in ${bucket}:`, e);
    }
  }

  for (const table of HOUSEHOLD_BLOCKING_TABLES) {
    const { error } = await supabaseAdmin.from(table).delete().eq("household_id", householdId);
    if (error) throw new Error(`Failed clearing ${table} for household ${householdId}: ${error.message}`);
  }

  // Safe now - cascades automatically to dismissed_dashboard_items,
  // estate_checklist, household_invites, household_users, other_assets,
  // travel_checklist_items.
  const { error: householdError } = await supabaseAdmin.from("households").delete().eq("id", householdId);
  if (householdError) throw new Error(`Failed deleting household ${householdId}: ${householdError.message}`);
}

export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(deleteAccountPayloadSchema)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Confirm the typed email actually matches this account - never trust
    // client-side validation alone for something irreversible.
    const { data: authUserData, error: authUserError } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (authUserError) throw authUserError;
    const actualEmail = authUserData?.user?.email?.trim().toLowerCase();
    if (!actualEmail || actualEmail !== data.confirmEmail.trim().toLowerCase()) {
      throw new Error("That email doesn't match your account. Nothing was deleted.");
    }

    const { data: memberships, error: membershipsError } = await supabase
      .from("household_users" as any)
      .select("household_id, role")
      .eq("user_id", userId);

    if (membershipsError) throw membershipsError;

    for (const m of (memberships ?? []) as unknown as Array<{ household_id: string; role: string }>) {
      if (m.role === "owner") {
        // Owner: deletes the entire household for everyone in it, no
        // ownership-transfer step required (explicit user decision).
        await deleteHouseholdCompletely(supabaseAdmin, m.household_id);
      } else {
        // Member or viewer: only removes this person's own access to that
        // household. Every shared record stays exactly as it was, even
        // ones tagged with this person's member_id.
        const { error } = await supabaseAdmin
          .from("household_users" as any)
          .delete()
          .eq("household_id", m.household_id)
          .eq("user_id", userId);
        if (error) throw error;
      }
    }

    const { error: deleteUserError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteUserError) throw deleteUserError;

    return { ok: true };
  });
