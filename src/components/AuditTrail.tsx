import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { getAuditTrailForRecord, type AuditedTable } from "@/lib/auditLog";
import { recordConfigs } from "@/lib/recordConfigs";
import { fmtMoney } from "@/lib/format";

const ACTION_LABEL: Record<string, string> = {
  INSERT: "Created",
  UPDATE: "Updated",
  DELETE: "Deleted",
};

function fieldLabel(tableName: string, fieldKey: string): string {
  const field = recordConfigs[tableName]?.fields.find((f) => f.key === fieldKey);
  if (field) return field.label;
  // Fallback for a column with no form field (e.g. an internal/system column) —
  // still readable, just not pulled from the real form label.
  return fieldKey.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function formatValue(
  tableName: string,
  fieldKey: string,
  value: unknown,
  currency: string | null,
): string {
  if (value === null || value === undefined || value === "") return "(empty)";
  const field = recordConfigs[tableName]?.fields.find((f) => f.key === fieldKey);
  if (field?.money && typeof value === "number") return fmtMoney(value, currency);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const str = String(value);
  return str.length > 60 ? str.slice(0, 60) + "…" : str;
}

/**
 * Read-only — deliberately no add/edit/delete here, unlike HistoryLog.tsx's
 * user-written updates. This is the automatic, tamper-resistant trail from
 * the audit_log trigger (see migration 20260910130000); showing it as
 * editable would misrepresent what it actually is. Reuses recordConfigs.ts's
 * own field labels (fieldLabel above) instead of a generic humanizer, so
 * "current_value" reads as "Current value" exactly like it does on the form
 * itself, not a re-invented label that could drift out of sync with it.
 */
export function AuditTrail({ tableName, recordId }: { tableName: AuditedTable; recordId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["audit-trail", tableName, recordId],
    queryFn: () => getAuditTrailForRecord({ data: { tableName, recordId } }),
  });

  const entries = data?.entries ?? [];

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">Loading…</p>;
  }

  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground">No changes recorded yet.</p>;
  }

  return (
    <ul className="space-y-1.5">
      {entries.map((e) => {
        const currency =
          (e.newData?.currency as string | undefined) ??
          (e.oldData?.currency as string | undefined) ??
          null;
        return (
          <li key={e.id} className="rounded-md bg-muted/40 px-2 py-1.5 text-sm">
            <div>
              <span className="font-semibold text-primary">
                {ACTION_LABEL[e.action] ?? e.action}
              </span>{" "}
              <span className="text-xs text-muted-foreground">
                {format(new Date(e.createdAt), "dd MMM yyyy, h:mma")} — {e.changedBy ?? "System"}
              </span>
            </div>
            {e.action === "UPDATE" && e.changedFields.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-foreground/80">
                {e.changedFields.map((f) => (
                  <li key={f}>
                    {fieldLabel(tableName, f)}:{" "}
                    {formatValue(tableName, f, e.oldData?.[f], currency)} →{" "}
                    {formatValue(tableName, f, e.newData?.[f], currency)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
