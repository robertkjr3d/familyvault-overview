import { HistoryLog } from "@/components/loan/HistoryLog";
import { AddRecordFab } from "@/components/AddRecordFab";
import { Bell } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAppStore } from "@/lib/store";
import { MemberFilterBar } from "@/components/MemberFilterBar";
import { RecordCard, FieldRow, Section } from "@/components/RecordCard";
import { useStatusMutation, useDeleteMutation } from "@/lib/mutations";
import { sortByStatus } from "@/lib/sort";
import { fmtMoney, fmtDate, fmtPct } from "@/lib/format";
import { HashHighlight } from "@/components/HashHighlight";
import { useEditRecord } from "@/components/EditRecordButton";
import { PROPERTY_PURPOSE_LABEL } from "@/lib/options";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { NotesEditor } from "@/components/loan/NotesEditor";
import { DocumentsList } from "@/components/loan/DocumentsList";
import { ReminderButton } from "@/components/loan/ReminderButton";
import { RemindersList } from "@/components/loan/RemindersList";

export const Route = createFileRoute("/property")({
  component: PropertyPage,
  head: () => ({ meta: [{ title: "Property — FamilyVault" }] }),
});

function totalCosts(p: any) {
  return ["cost_management","cost_property_tax","cost_fire_insurance","cost_maintenance","cost_other"]
    .reduce((s, k) => s + (Number(p[k]) || 0), 0) || Number(p.monthly_costs) || 0;
}

function yearsBetween(dateStr: string | null | undefined, now = new Date()) {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  return (now.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
}

function capitalGainPa(p: any): number | null {
  const purchase = Number(p.purchase_price) || 0;
  const current = Number(p.current_value) || 0;
  const years = yearsBetween(p.purchase_date);
  if (!purchase || !years || years < 0.1) return null;
  return ((current - purchase) / purchase / years) * 100;
}

function parseTargetPct(strategy: string | null | undefined): number | null {
  if (!strategy) return null;
  const m = strategy.match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? parseFloat(m[1]) : null;
}

function PropertyPage() {
  const memberFilter = useAppStore((s) => s.memberFilter);
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
  const status = useStatusMutation("properties", "properties");
  const del = useDeleteMutation("properties", "properties");

  const { data: properties = [] } = useQuery({
    queryKey: ["properties", memberFilter, activeHouseholdId],
    enabled: !!activeHouseholdId,
    queryFn: async () => {
      if (!activeHouseholdId) return [];
      let q = supabase.from("properties").select("*").eq("household_id", activeHouseholdId);
      if (memberFilter !== "all") q = q.eq("member_id", memberFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const investments = properties.filter((p: any) => p.purpose !== "own_home");
  const homes = properties.filter((p: any) => p.purpose === "own_home");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Property</h1>
      <MemberFilterBar table="properties" />

      <div className="space-y-3">
        {sortByStatus(investments).map((p: any) => (
          <PropertyRow
            key={p.id}
            p={p}
            loans={loans}
            onStatus={(s) => status.mutate({ id: p.id, status: s })}
            onDelete={() => del.mutate(p.id)}
          />
        ))}
      </div>

      {homes.length > 0 && (
        <details className="rounded-2xl border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-bold">My Homes ▾</summary>
          <div className="mt-3 space-y-3">
            {homes.map((p: any) => (
              <PropertyRow
                key={p.id}
                p={p}
                loans={loans}
                onStatus={(s) => status.mutate({ id: p.id, status: s })}
                onDelete={() => del.mutate(p.id)}
              />
            ))}
          </div>
        </details>
      )}
      <AddRecordFab configKey="properties" />
    </div>
  );
}

function AlertLabel({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-1">
      {text}
      <Bell className="h-3 w-3 fill-yellow-500 text-yellow-500" />
    </span>
  );
}

function PropertyRow({ p, loans, onStatus, onDelete }: { p: any; loans: any[]; onStatus: (s: any) => void; onDelete: () => void }) {
  const edit = useEditRecord("properties", p);
  const linkedLoan = loans.find((l: any) => l.property_id === p.id);
  const hasMismatch = linkedLoan && Number(linkedLoan.monthly_payment) !== Number(p.monthly_payment);
  const costs = totalCosts(p);
  const gainPa = capitalGainPa(p);
  const target = parseTargetPct(p.strategy);
  const gainColor =
    gainPa == null || target == null ? "" :
    gainPa >= target ? "text-settled" :
    gainPa >= target - 1 ? "text-review" : "text-urgent";
  const grossYield = p.current_value && p.monthly_rent ? ((p.monthly_rent * 12) / p.current_value) * 100 : null;
  const netRent = (Number(p.monthly_rent) || 0) - costs;
  const netYield = p.current_value ? (netRent * 12) / p.current_value * 100 : null;
  const cashFlow = netRent - (Number(p.monthly_payment) || 0);

  return (
    <HashHighlight id={`record-${p.id}`}>
      <RecordCard
        title={p.name}
        subtitle={`${PROPERTY_PURPOSE_LABEL[p.purpose] ?? "Other"} · ${p.currency}`}
        memberId={p.member_id}
        status={p.status}
        onStatusChange={onStatus}
        action={p.action_note}
        onEdit={edit.open}
        onDelete={onDelete}
        hasNotes={!!p.notes}
        updatedAt={p.updated_at}
        rightMeta={
          <div className="text-right text-xs">
            <div className="text-muted-foreground">Value (est.)</div>
            <div className="font-bold">{fmtMoney(p.current_value, p.currency)}</div>
            {p.monthly_rent && (
              <>
                <div className="mt-1 text-muted-foreground">Rental</div>
                <div className="font-semibold">{fmtMoney(p.monthly_rent, p.currency)}/mo</div>
              </>
            )}
          </div>
        }
      >
        <Section title="Strategy">
          <p className="text-sm text-foreground/80">{p.strategy || "—"}</p>
        </Section>
        <Section title="Financials">
          <FieldRow label="Purchase price" value={fmtMoney(p.purchase_price, p.currency)} />
          <FieldRow label="Purchase date" value={fmtDate(p.purchase_date)} />
          <FieldRow label="Current value" value={fmtMoney(p.current_value, p.currency)} />
          <FieldRow label="Capital gain" value={fmtMoney((p.current_value || 0) - (p.purchase_price || 0), p.currency)} />
          <FieldRow
            label="Capital gain p.a."
            value={gainPa == null ? "—" : <span className={`font-semibold ${gainColor}`}>{gainPa.toFixed(1)}%</span>}
          />
          <FieldRow label="Mortgage" value={p.mortgage_bank ? `${p.mortgage_bank} · ${fmtMoney(p.mortgage_balance, p.currency)}` : "—"} />
          <FieldRow label="Monthly payment" value={fmtMoney(p.monthly_payment, p.currency)} />
          {hasMismatch && (
            <div className="rounded-lg border border-review/40 bg-review-soft/30 px-3 py-2 text-xs text-muted-foreground">
              ⚠ Linked loan ({linkedLoan.bank}) has a different monthly payment of {fmtMoney(linkedLoan.monthly_payment)}. The loan amount is used for cash flow calculations — update one to match.
            </div>
          )}
          <FieldRow label="Interest rate" value={fmtPct(p.interest_rate)} />
          <FieldRow label="Rate type" value={p.rate_type ?? "—"} />
         <FieldRow label={<AlertLabel text="Rate ends / Reprice" />} value={fmtDate(p.fixed_rate_end)} />
          <FieldRow label="Mortgage end date" value={p.mortgage_end_date ? fmtDate(p.mortgage_end_date) : <span className="text-muted-foreground text-xs">Not set — chart assumes ongoing</span>} />
          <FieldRow label="Monthly rent" value={fmtMoney(p.monthly_rent, p.currency)} />
        </Section>

        <Section title="Monthly Costs">
          <FieldRow label="Management fee" value={fmtMoney(p.cost_management, p.currency)} />
          <FieldRow label="Property tax" value={fmtMoney(p.cost_property_tax, p.currency)} />
          <FieldRow label="Fire insurance" value={fmtMoney(p.cost_fire_insurance, p.currency)} />
          <FieldRow label="Maintenance / repairs" value={fmtMoney(p.cost_maintenance, p.currency)} />
          <FieldRow label={p.cost_other_label || "Other"} value={fmtMoney(p.cost_other, p.currency)} />
          <FieldRow label={<span className="font-bold">Total monthly costs</span> as any} value={<span className="font-bold">{fmtMoney(costs, p.currency)}</span>} />
          <FieldRow label="Gross yield %" value={grossYield != null ? fmtPct(grossYield) : "—"} />
          <FieldRow label="Net yield %" value={netYield != null ? fmtPct(netYield) : "—"} />
          <FieldRow label="Monthly cash flow" value={<span className={cashFlow >= 0 ? "text-settled" : "text-urgent"}>{fmtMoney(cashFlow, p.currency)}</span>} />
          <FieldRow
            label="Loan vs Value %"
            value={p.current_value && p.mortgage_balance ? fmtPct((p.mortgage_balance / p.current_value) * 100) : "—"}
          />
        </Section>

        <CollapsibleSection icon={<span>📝</span>} title="Notes">
          <NotesEditor table="properties" queryKey="properties" id={p.id} value={p.notes} />
        </CollapsibleSection>
        <CollapsibleSection icon={<span>🔄</span>} title="Add an Update">
          <HistoryLog entityType="property" entityId={p.id} />
        </CollapsibleSection>
        <CollapsibleSection icon={<span>📎</span>} title="Documents">
          <DocumentsList entityType="property" entityId={p.id} />
        </CollapsibleSection>

        <RemindersList entityType="property" entityId={p.id} />
        <div className="flex justify-end pt-1">
          <ReminderButton entityType="property" entityId={p.id} />
        </div>
      </RecordCard>
      {edit.element}
    </HashHighlight>
  );
}
