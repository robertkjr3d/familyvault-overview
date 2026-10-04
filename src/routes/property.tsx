import { useState } from "react";
import { HistoryLog } from "@/components/HistoryLog";
import { AuditTrail } from "@/components/AuditTrail";
import { AddRecordFab } from "@/components/AddRecordFab";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAppStore } from "@/lib/store";
import { MemberFilterBar } from "@/components/MemberFilterBar";
import { RecordCard, FieldRow, Section } from "@/components/RecordCard";
import { useStatusMutation, useDeleteMutation } from "@/lib/mutations";
import { sortByStatus } from "@/lib/sort";
import {
  fmtMoney,
  fmtDate,
  fmtPct,
  groupByCurrency,
  totalWithFx,
  type FxRates,
} from "@/lib/format";
import { useFxRates } from "@/hooks/useFxRates";
import { ForeignCurrencyTotals } from "@/components/ForeignCurrencyTotals";
import { FxInfoNote } from "@/components/FxInfoNote";
import { HashHighlight } from "@/components/HashHighlight";
import { useEditRecord, useDuplicateRecord } from "@/components/EditRecordButton";
import { PROPERTY_PURPOSE_LABEL } from "@/lib/options";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { NotesEditor } from "@/components/NotesEditor";
import { DocumentsList } from "@/components/DocumentsList";
import { ReminderButton } from "@/components/ReminderButton";
import { RemindersList } from "@/components/RemindersList";
import { useEntityCounts } from "@/lib/useEntityCounts";
import { loansLinkedTo, mortgageTotals } from "@/lib/propertyMortgage";
import { PropertyMortgageSection } from "@/components/PropertyMortgageSection";

export const Route = createFileRoute("/property")({
  component: PropertyPage,
  head: () => ({ meta: [{ title: "Property — FamilyHub SG" }] }),
});

function totalCosts(p: any) {
  return (
    [
      "cost_management",
      "cost_property_tax",
      "cost_fire_insurance",
      "cost_maintenance",
      "cost_other",
    ].reduce((s, k) => s + (Number(p[k]) || 0), 0) ||
    Number(p.monthly_costs) ||
    0
  );
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
  const del = useDeleteMutation("properties", "properties", "property");
  const counts = useEntityCounts("property", activeHouseholdId);

  const { data: loans = [] } = useQuery({
    queryKey: ["loans", activeHouseholdId],
    enabled: !!activeHouseholdId,
    queryFn: async () => {
      if (!activeHouseholdId) return [];
      const { data } = await supabase
        .from("loans")
        .select(
          "id, property_id, member_id, bank, purpose, balance, currency, monthly_payment, original_amount, term_years, rate, rate_label, reprice_date, loan_end_date",
        )
        .eq("household_id", activeHouseholdId);
      return data ?? [];
    },
  });

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
  const { data: fxRates } = useFxRates();
  // Net of mortgage = value minus the balance of the loans linked to each
  // property (Loans tab), converted into the property's own currency.
  const grossTotals = groupByCurrency(properties, (p: any) => p.current_value);
  const netTotals = groupByCurrency(
    properties,
    (p: any) =>
      (Number(p.current_value) || 0) -
      mortgageTotals(p.currency, loansLinkedTo(p.id, loans), fxRates).owed,
  );

  return (
    <div className="space-y-4 pb-24">
      <h1 className="text-2xl font-bold tracking-tight">Property</h1>
      <MemberFilterBar table="properties" />

      <div className="space-y-3">
        {sortByStatus(investments).map((p: any) => (
          <PropertyRow
            key={p.id}
            p={p}
            loans={loans}
            fx={fxRates}
            onStatus={(s) => status.mutate({ id: p.id, status: s })}
            onDelete={() => del.mutate(p.id)}
            reminderCount={counts.reminderCounts[p.id] || 0}
            historyCount={counts.historyCounts[p.id] || 0}
            auditCount={counts.auditCounts[p.id] || 0}
            documentsCount={counts.documentsCounts[p.id] || 0}
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
                fx={fxRates}
                onStatus={(s) => status.mutate({ id: p.id, status: s })}
                onDelete={() => del.mutate(p.id)}
                reminderCount={counts.reminderCounts[p.id] || 0}
                historyCount={counts.historyCounts[p.id] || 0}
                auditCount={counts.auditCounts[p.id] || 0}
                documentsCount={counts.documentsCounts[p.id] || 0}
              />
            ))}
          </div>
        </details>
      )}
      {properties.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              Total gross value{grossTotals.foreign.length > 0 && <FxInfoNote fx={fxRates} />}
            </span>
            <span className="font-bold">{fmtMoney(totalWithFx(grossTotals, fxRates))}</span>
          </div>
          <ForeignCurrencyTotals foreign={grossTotals.foreign} fx={fxRates} />
          <div className="mt-2 flex justify-between">
            <span className="text-muted-foreground">
              Net of mortgage{netTotals.foreign.length > 0 && <FxInfoNote fx={fxRates} />}
            </span>
            <span className="font-bold">{fmtMoney(totalWithFx(netTotals, fxRates))}</span>
          </div>
          <ForeignCurrencyTotals foreign={netTotals.foreign} fx={fxRates} />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Net of mortgage uses the loans linked to each property. Add or update a mortgage in the
            Loans tab to keep this accurate.
          </p>
        </div>
      )}
      <AddRecordFab configKey="properties" />
    </div>
  );
}

function PropertyRow({
  p,
  loans,
  fx,
  onStatus,
  onDelete,
  reminderCount,
  historyCount,
  auditCount,
  documentsCount,
}: {
  p: any;
  loans: any[];
  fx?: FxRates | null;
  onStatus: (s: any) => void;
  onDelete: () => void;
  reminderCount: number;
  historyCount: number;
  auditCount: number;
  documentsCount: number;
}) {
  const edit = useEditRecord("properties", p);
  const dup = useDuplicateRecord("properties", p);
  const setMemberFilter = useAppStore((s) => s.setMemberFilter);
  // The mortgage lives in the Loans tab; this card only displays the loans
  // linked to it (a property can have more than one).
  const linked = loansLinkedTo(p.id, loans);
  const mortgage = mortgageTotals(p.currency, linked, fx);
  const costs = totalCosts(p);
  const gainPa = capitalGainPa(p);
  const target = parseTargetPct(p.strategy);
  const gainColor =
    gainPa == null || target == null
      ? ""
      : gainPa >= target
        ? "text-settled"
        : gainPa >= target - 1
          ? "text-review"
          : "text-urgent";
  const grossYield =
    p.current_value && p.monthly_rent ? ((p.monthly_rent * 12) / p.current_value) * 100 : null;
  const netRent = (Number(p.monthly_rent) || 0) - costs;
  const netYield = p.current_value ? ((netRent * 12) / p.current_value) * 100 : null;
  const cashFlow = netRent - mortgage.payment;

  const [cardOpen, setCardOpen] = useState(false);
  const [section, setSection] = useState<
    "notes" | "reminders" | "history" | "audit" | "documents" | null
  >(null);

  function openSection(target: "notes" | "reminders" | "history" | "audit" | "documents") {
    setCardOpen(true);
    setSection(target);
    setTimeout(() => {
      document
        .getElementById(`${target}-${p.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  }

  return (
    <HashHighlight id={`record-${p.id}`}>
      <RecordCard
        title={p.name}
        subtitle={`${PROPERTY_PURPOSE_LABEL[p.purpose] ?? "Other"} · ${p.currency}`}
        memberId={p.member_id}
        secondaryMemberId={p.joint_member_id ?? null}
        status={p.status}
        onStatusChange={onStatus}
        action={p.action_note}
        externalUrl={p.external_url}
        onEdit={edit.open}
        onDuplicate={dup.open}
        onDelete={onDelete}
        hasNotes={!!p.notes}
        updatedAt={p.updated_at}
        createdAt={p.created_at}
        open={cardOpen}
        onOpenChange={setCardOpen}
        reminderCount={reminderCount}
        historyCount={historyCount}
        auditCount={auditCount}
        documentsCount={documentsCount}
        onNotesClick={() => openSection("notes")}
        onReminderClick={() => openSection("reminders")}
        onHistoryClick={() => openSection("history")}
        onAuditClick={() => openSection("audit")}
        onDocumentsClick={() => openSection("documents")}
        rightMeta={
          <div className="text-right text-xs">
            <div className="text-muted-foreground">Value (est.)</div>
            <div className="font-bold">{fmtMoney(p.current_value, p.currency)}</div>
            {p.monthly_rent && (
              <>
                <div className="mt-1 text-muted-foreground">Rental</div>
                <div className="font-semibold text-settled">
                  +{fmtMoney(p.monthly_rent, p.currency)}/mo
                </div>
              </>
            )}
          </div>
        }
      >
        <Section title="Strategy">
          <p className="text-sm text-foreground/80">{p.strategy || "—"}</p>
          {p.beneficiary && <FieldRow label="Beneficiary / intended for" value={p.beneficiary} />}
        </Section>
        <Section title="Financials">
          <FieldRow label="Purchase price" value={fmtMoney(p.purchase_price, p.currency)} />
          <FieldRow label="Purchase date" value={fmtDate(p.purchase_date)} />
          <FieldRow label="Current value" value={fmtMoney(p.current_value, p.currency)} />
          <FieldRow
            label="Capital gain"
            value={fmtMoney((p.current_value || 0) - (p.purchase_price || 0), p.currency)}
          />
          <FieldRow
            label="Capital gain p.a."
            value={
              gainPa == null ? (
                "—"
              ) : (
                <span className={`font-semibold ${gainColor}`}>{gainPa.toFixed(1)}%</span>
              )
            }
          />
          <FieldRow label="Monthly rent" value={fmtMoney(p.monthly_rent, p.currency)} />
        </Section>

        <PropertyMortgageSection
          linked={linked}
          totals={mortgage}
          currency={p.currency}
          onOpenLoan={(l) => setMemberFilter(l.member_id ?? "all")}
        />

        <Section title="Monthly Costs">
          <FieldRow label="Management fee" value={fmtMoney(p.cost_management, p.currency)} />
          <FieldRow label="Property tax" value={fmtMoney(p.cost_property_tax, p.currency)} />
          <FieldRow label="Fire insurance" value={fmtMoney(p.cost_fire_insurance, p.currency)} />
          <FieldRow
            label="Maintenance / repairs"
            value={fmtMoney(p.cost_maintenance, p.currency)}
          />
          <FieldRow
            label={p.cost_other_label || "Other"}
            value={fmtMoney(p.cost_other, p.currency)}
          />
          <FieldRow
            label={(<span className="font-bold">Total monthly costs</span>) as any}
            value={<span className="font-bold">{fmtMoney(costs, p.currency)}</span>}
          />
          <FieldRow label="Gross yield %" value={grossYield != null ? fmtPct(grossYield) : "—"} />
          <FieldRow label="Net yield %" value={netYield != null ? fmtPct(netYield) : "—"} />
          <FieldRow
            label="Monthly cash flow"
            value={
              <span className={cashFlow >= 0 ? "text-settled" : "text-urgent"}>
                {fmtMoney(cashFlow, p.currency)}
              </span>
            }
          />
          <FieldRow
            label="Loan vs Value %"
            value={
              p.current_value && mortgage.owed
                ? fmtPct((mortgage.owed / p.current_value) * 100)
                : "—"
            }
          />
        </Section>

        <CollapsibleSection
          id={`notes-${p.id}`}
          icon={<span>📝</span>}
          title="Notes"
          open={section === "notes"}
          onOpenChange={(o) => setSection(o ? "notes" : null)}
        >
          <NotesEditor table="properties" queryKey="properties" id={p.id} value={p.notes} />
        </CollapsibleSection>
        <CollapsibleSection
          id={`reminders-${p.id}`}
          icon={<span>🔔</span>}
          title="Reminders"
          open={section === "reminders"}
          onOpenChange={(o) => setSection(o ? "reminders" : null)}
        >
          <RemindersList entityType="property" entityId={p.id} />
          <div className="flex justify-end pt-1">
            <ReminderButton entityType="property" entityId={p.id} />
          </div>
        </CollapsibleSection>
        <CollapsibleSection
          id={`history-${p.id}`}
          icon={<span>🔄</span>}
          title="Add an Update"
          count={historyCount}
          open={section === "history"}
          onOpenChange={(o) => setSection(o ? "history" : null)}
        >
          <HistoryLog entityType="property" entityId={p.id} />
        </CollapsibleSection>

        <CollapsibleSection
          id={`audit-${p.id}`}
          icon={<span>🛡️</span>}
          title="Audit Trail"
          count={auditCount}
          open={section === "audit"}
          onOpenChange={(o) => setSection(o ? "audit" : null)}
        >
          <AuditTrail tableName="properties" recordId={p.id} />
        </CollapsibleSection>
        <CollapsibleSection
          id={`documents-${p.id}`}
          icon={<span>📎</span>}
          title="Documents"
          count={documentsCount}
          open={section === "documents"}
          onOpenChange={(o) => setSection(o ? "documents" : null)}
        >
          <DocumentsList entityType="property" entityId={p.id} />
        </CollapsibleSection>
      </RecordCard>
      {edit.element}
      {dup.element}
    </HashHighlight>
  );
}
