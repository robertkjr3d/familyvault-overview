import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

// Must match the 6 tables the audit_log trigger is actually attached to
// (see migration 20260910130000_financial_audit_log.sql) — kept as a real
// enum, not a bare string, so a typo'd table name fails validation instead
// of silently returning an empty/wrong result.
const AUDITED_TABLES = [
  "insurance_policies",
  "investments",
  "savings_accounts",
  "loans",
  "properties",
  "other_assets",
] as const;
export type AuditedTable = (typeof AUDITED_TABLES)[number];

const auditTrailPayloadSchema = z.object({
  tableName: z.enum(AUDITED_TABLES),
  recordId: z.string().uuid(),
});

// Household-side: a single record's audit trail, with each changed_by user id
// resolved to a display name. Same shape as getAdvisorNotesForHousehold in
// advisorAccess.ts — RLS (audit_log_select) already restricts the raw rows to
// the caller's own household, so the only reason this needs a server function
// at all (rather than a plain client query) is that user_profiles is
// self-only RLS on the client, same reasoning already established there.
export const getAuditTrailForRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(auditTrailPayloadSchema)
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: rows, error } = await supabase
      .from("audit_log" as any)
      .select("id, action, changed_by, changed_fields, old_data, new_data, created_at")
      .eq("table_name", data.tableName)
      .eq("record_id", data.recordId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message ?? "Something went wrong on the server.");

    const userIds = [...new Set((rows ?? []).map((r: any) => r.changed_by).filter(Boolean))];
    const nameById = new Map<string, string>();
    if (userIds.length > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: profiles, error: profilesError } = await supabaseAdmin
        .from("user_profiles" as any)
        .select("user_id, display_name, email")
        .in("user_id", userIds);
      if (profilesError)
        throw new Error(profilesError.message ?? "Something went wrong on the server.");
      for (const p of (profiles ?? []) as any[]) {
        nameById.set(p.user_id, p.display_name || p.email || "A household member");
      }
    }

    return {
      entries: (rows ?? []).map((r: any) => ({
        id: String(r.id),
        action: r.action as "INSERT" | "UPDATE" | "DELETE",
        // A NULL changed_by means the edit came through the admin/service-role
        // client (bypasses RLS, so auth.uid() has nothing to return) — not
        // pretending that's a specific person. See the migration's own
        // comment for why this is a known, deliberately-unsolved limitation.
        changedBy: r.changed_by ? (nameById.get(r.changed_by) ?? "A household member") : null,
        changedFields: (r.changed_fields ?? []) as string[],
        // Record<string, Json> (Supabase's own generated type), not
        // Record<string, unknown> — TanStack Start's createServerFn validates
        // return types are provably serializable at compile time, and caught
        // exactly this: `unknown` isn't provable as serializable even though
        // jsonb values obviously are at runtime. Found via a real tsc error,
        // not guessed.
        oldData: r.old_data as Record<string, Json> | null,
        newData: r.new_data as Record<string, Json> | null,
        createdAt: r.created_at as string,
      })),
    };
  });
