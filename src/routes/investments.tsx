import { useState } from "react";
import { Info } from "lucide-react";
import { AddRecordFab } from "@/components/AddRecordFab";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { differenceInDays, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAppStore } from "@/lib/store";
import { MemberFilterBar } from "@/components/MemberFilterBar";
import { RecordCard, FieldRow, Section } from "@/components/RecordCard";
import { useStatusMutation, useDeleteMutation } from "@/lib/mutations";
import { sortByStatus } from "@/lib/sort";
import { fmtMoney, fmtPct, fmtDate, groupByCurrency, totalWithFx } from "@/lib/format";
import { ForeignCurrencyTotals } from "@/components/ForeignCurrencyTotals";
import { FxInfoNote } from "@/components/FxInfoNote";
import { freqLabel } from "@/lib/options";
import { HashHighlight } from "@/components/HashHighlight";
import { useEditRecord, useDuplicateRecord } from "@/components/EditRecordButton";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { NotesEditor } from "@/components/NotesEditor";
import { HistoryLog } from "@/components/HistoryLog";
import { DocumentsList } from "@/components/DocumentsList";
import { ReminderButton } from "@/components/ReminderButton";
import { RemindersList } from "@/components/RemindersList";
import { useEntityCounts } from "@/lib/useEntityCounts";
import { useFxRates } from "@/hooks/useFxRates";
import { getAdvisorNotesForHousehold } from "@/lib/advisorAccess";

export const Route = createFileRoute("/investments")({
  component: InvestmentsPage,
  head: () => ({ meta: [{ title: "Investments — FamilyHub SG" }] }),
});

function staleDays(lastUpdated: string | null | undefined) {
  if (!lastUpdated) return null;
  try { return differenceInDays(new Date(), parseISO(lastUpdated)); } catch { return null; }
}

function UpdateValueInline({ id, current }: { id: string; current: number | null | undefined }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(current?.toString() ?? "");
  const qc = useQueryClient();

  async function save() {
    const num = Number(val.replace(/,/g, ""));
    if (isNaN(num)) { toast.error("Enter a valid number"); return; }
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase.from("investments").update({ current_value: num, last_updated: today } as any).eq("id", id).select("id").maybeSingle();
    if (error) toast.error(error.message);
    else if (!data) toast.error("Nothing was updated — you may not have permission to edit this.");
    else {
      toast.success("Value updated");
      qc.invalidateQueries({ queryKey: ["investments"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setEditing(false);
    }
  }

  if (!editing) {
    return (
      <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs"
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}>
        Update
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <Input type="text" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} className="h-7 w-24 text-xs" autoFocus />
      <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={save}>Save</Button>
      <Button type="button" size="sm" variant="ghost" className="h-7 px-1.5 text-xs" onClick={() => setEditing(false)}>✕</Button>
    </div>
  );
}

function InvestmentsPage() {
  const memberFilter = useAppStore((s) => s.memberFilter);
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
  const status = useStatusMutation("investments", "investments");
  const del = useDeleteMutation("investments", "investments", "investment");
  const counts = useEntityCounts("investment", activeHouseholdId);
  const { data: fxRates } = useFxRates();

  const { data: items = [] } = useQuery({
    queryKey: ["investments", memberFilter, activeHouseholdId],
    enabled: !!activeHouseholdId,
    queryFn: async () => {
      if (!activeHouseholdId) return [];
      let q = supabase.from("investments").select("*").eq("household_id", activeHouseholdId);
      if (memberFilter !== "all") q = q.eq("member_id", memberFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  // Separate query, deliberately independent of `items` above — if this
  // fails or is slow, the actual investments list must still render
  // normally. Every existing calculation below is untouched and only ever
  // reads `items`.
  const { data: advisorNotesData } = useQuery({
    queryKey: ["advisor-notes", activeHouseholdId],
    enabled: !!activeHouseholdId,
    queryFn: () => getAdvisorNotesForHousehold({ data: { householdId: activeHouseholdId! } }),
  });
  const advisorNotesByRecordId = new Map<string, NonNullable<typeof advisorNotesData>["notes"]>();
  for (const n of advisorNotesData?.notes ?? []) {
    if (n.recordCategory !== "investments") continue;
    const arr = advisorNotesByRecordId.get(n.recordId) ?? [];
    arr.push(n);
    advisorNotesByRecordId.set(n.recordId, arr);
  }

  const groups = Array.from(new Set(items.map((i: any) => i.group_name)));
  const costTotals = groupByCurrency(items, (i: any) => i.cost_basis);
  const valueTotals = groupByCurrency(items, (i: any) => i.current_value);
  const gainTotals = groupByCurrency(items, (i: any) => (Number(i.current_value) || 0) - (Number(i.cost_basis) || 0));
  const totalCost = totalWithFx(costTotals, fxRates);
  const totalValue = totalWithFx(valueTotals, fxRates);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Investments</h1>
      <MemberFilterBar table="investments" />
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No investments yet.</p>
        </div>
      ) : (
        <>
          {groups.map((g) => (
            <section key={g}>
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">{g}</h2>
              <div className="space-y-3">
                {sortByStatus(items.filter((i: any) => i.group_name === g)).map((inv: any) => (
                  <InvestmentRow
                    key={inv.id}
                    inv={inv}
                    onStatus={(s) => status.mutate({ id: inv.id, status: s })}
                    onDelete={() => del.mutate(inv.id)}
                    reminderCount={counts.reminderCounts[inv.id] || 0}
                    historyCount={counts.historyCounts[inv.id] || 0}
                    documentsCount={counts.documentsCounts[inv.id] || 0}
                    advisorNotes={advisorNotesByRecordId.get(inv.id) ?? []}
                  />
                ))}
              </div>
            </section>
          ))}
          <div className="rounded-2xl border border-border bg-card p-4 text-sm">
            <div className="flex justify-between">
              <span>
                Total invested{costTotals.foreign.length > 0 && <FxInfoNote fx={fxRates} />}
              </span>
              <span className="font-bold">{fmtMoney(totalCost)}</span>
            </div>
            <ForeignCurrencyTotals foreign={costTotals.foreign} fx={fxRates} />
            <div className="mt-2 flex justify-between">
              <span>
                Current value{valueTotals.foreign.length > 0 && <FxInfoNote fx={fxRates} />}
              </span>
              <span className="font-bold">{fmtMoney(totalValue)}</span>
            </div>
            <ForeignCurrencyTotals foreign={valueTotals.foreign} fx={fxRates} />
            <div className="mt-2 flex justify-between">
              <span>Gain / Loss{gainTotals.foreign.length > 0 && <FxInfoNote fx={fxRates} />}</span>
              <span
                className={`font-bold ${totalValue - totalCost >= 0 ? "text-settled" : "text-urgent"}`}
              >
                {fmtMoney(totalValue - totalCost)}
              </span>
            </div>
            <ForeignCurrencyTotals foreign={gainTotals.foreign} fx={fxRates} />
          </div>
        </>
      )}
      <AddRecordFab configKey="investments" />
    </div>
  );
}

function InvestmentRow({
  inv, onStatus, onDelete, reminderCount, historyCount, documentsCount, advisorNotes,
}: {
  inv: any; onStatus: (s: any) => void; onDelete: () => void;
  reminderCount: number; historyCount: number; documentsCount: number;
  advisorNotes: any[];
}) {
  const edit = useEditRecord("investments", inv);
  const dup = useDuplicateRecord("investments", inv);
  const gain = (inv.current_value || 0) - (inv.cost_basis || 0);
  // Uses a dedicated last_updated field (stamped only when the value itself is
  // changed via Update, or edited on the form) rather than the system updated_at
  // timestamp — updated_at resets on ANY edit (e.g. tweaking the strategy notes),
  // which would silently clear the staleness warning without the value actually
  // having been refreshed. Same reasoning savings_accounts already uses.
  const stale = staleDays(inv.last_updated);
  const isStale = stale != null && stale >= 90;
  const isILPOrEndowment = inv.group_name === "ILP (Investment-Linked Policy)" || inv.group_name === "Endowment";
  const staleTitle = "Updated " + stale + "d ago";
  const staleIndicator = isStale ? <span className="ml-1 text-review" title={staleTitle}>⚠</span> : null;

  // Premium shown on the collapsed card in its actual frequency — e.g. $3,600/yr
  // not converted to a monthly estimate (that was confusing). Monthly equivalent
  // still feeds the dashboard cash flow via investmentPremiumMonthly().
  const premiumDisplay = (() => {
    if (!isILPOrEndowment || !inv.premium_amount) return null;
    const amt = Number(inv.premium_amount);
    const freq = (inv.premium_frequency || "annual").toLowerCase();
    if (freq === "one-off" || freq === "one_off") return null;
    const suffix =
      freq === "monthly" ? "/mo" :
      freq === "quarterly" ? "/qtr" :
      freq === "semi-annual" ? "/6mo" :
      "/yr";
    return { amt, suffix };
  })();

  const [cardOpen, setCardOpen] = useState(false);
  const [section, setSection] = useState<"notes" | "reminders" | "history" | "documents" | null>(null);

  function openSection(target: "notes" | "reminders" | "history" | "documents") {
    setCardOpen(true);
    setSection(target);
    setTimeout(() => {
      document.getElementById(`${target}-${inv.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  }

  return (
    <HashHighlight id={`record-${inv.id}`}>
      <RecordCard
        title={inv.name}
        memberId={inv.member_id}
        isGiro={!!inv.is_giro}
        status={inv.status}
        onStatusChange={onStatus}
        action={inv.strategy}
        externalUrl={inv.external_url}
        onEdit={edit.open}
        onDuplicate={dup.open}
        onDelete={onDelete}
        hasNotes={!!inv.notes}
        hasAdvisorNote={advisorNotes.length > 0}
        updatedAt={inv.updated_at}
        createdAt={inv.created_at}
        open={cardOpen}
        onOpenChange={setCardOpen}
        reminderCount={reminderCount}
        historyCount={historyCount}
        documentsCount={documentsCount}
        onNotesClick={() => openSection("notes")}
        onAdvisorNoteClick={() => setCardOpen(true)}
        onReminderClick={() => openSection("reminders")}
        onHistoryClick={() => openSection("history")}
        onDocumentsClick={() => openSection("documents")}
        rightMeta={
          <div className="text-right text-xs">
            <div className="text-muted-foreground">
              Value (est.){staleIndicator}
            </div>
            <div className="font-bold">{fmtMoney(inv.current_value, inv.currency)}</div>
            <div className={gain >= 0 ? "text-settled" : "text-urgent"}>{fmtMoney(gain, inv.currency)}</div>
            <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
              {isStale && (
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "hsl(38 95% 55%)" }} aria-label="Value is stale" />
              )}
              <span>{inv.last_updated ? `Updated: ${fmtDate(inv.last_updated)}` : "Never updated"}</span>
            </div>
            {premiumDisplay != null && (
              <div className="mt-1 font-semibold text-urgent">
                −{fmtMoney(premiumDisplay.amt, inv.currency)}{premiumDisplay.suffix}
              </div>
            )}
          </div>
        }
      >
        <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-border/60 px-3 py-2">
          <div className="text-xs">
            {isStale ? (
              <span className="font-medium" style={{ color: "hsl(38 95% 35%)" }}>● Current value is {stale} days old — update it</span>
            ) : (
              <span className="text-muted-foreground">Update current value</span>
            )}
          </div>
          <UpdateValueInline id={inv.id} current={inv.current_value} />
        </div>
        <Section title="Holding">
          <FieldRow label="Amount invested" value={fmtMoney(inv.cost_basis, inv.currency)} />
          <FieldRow label="Current value (est.)" value={fmtMoney(inv.current_value, inv.currency)} />
          <FieldRow label="Value as of" value={fmtDate(inv.last_updated)} />
          <FieldRow
            label={<span className="inline-flex items-center">Projected return<InfoNote text="This rate is for your own reference only. The Lifetime Net Worth chart uses one global growth rate set in Settings → Projection Assumptions, not this field." /></span>}
            value={fmtPct(inv.projected_return_pct)}
          />
          {isILPOrEndowment && inv.coverage && <FieldRow label="Coverage" value={inv.coverage} />}
          {isILPOrEndowment && inv.premium_amount && <FieldRow label="Premium amount" value={fmtMoney(inv.premium_amount, inv.currency)} />}
          {isILPOrEndowment && inv.premium_start_date && <FieldRow label="Premium start" value={fmtDate(inv.premium_start_date)} />}
          {isILPOrEndowment && inv.premium_frequency && <FieldRow label="Premium frequency" value={freqLabel(inv.premium_frequency)} />}
          {isILPOrEndowment && inv.premium_end_date && <FieldRow label="Premium end" value={fmtDate(inv.premium_end_date)} />}
          {isILPOrEndowment && inv.payout_amount && <FieldRow label="Payout amount (est.)" value={fmtMoney(inv.payout_amount, inv.currency)} />}
          {isILPOrEndowment && inv.payout_start_date && <FieldRow label="Payout start" value={fmtDate(inv.payout_start_date)} />}
          {isILPOrEndowment && inv.payout_frequency && <FieldRow label="Payout frequency" value={freqLabel(inv.payout_frequency)} />}
          {isILPOrEndowment && inv.payout_end_date && <FieldRow label="Payout end" value={fmtDate(inv.payout_end_date)} />}
        </Section>

        <CollapsibleSection
          id={`notes-${inv.id}`}
          icon={<span>📝</span>}
          title="Notes"
          open={section === "notes"}
          onOpenChange={(o) => setSection(o ? "notes" : null)}
        >
          <NotesEditor
            table="investments"
            queryKey="investments"
            id={inv.id}
            value={inv.notes}
          />
        </CollapsibleSection>

        {advisorNotes.length > 0 && (
          <CollapsibleSection
            icon={<span>💬</span>}
            title="Adviser's Note"
            count={advisorNotes.length}
            defaultOpen
          >
            <div className="space-y-3">
              {advisorNotes.map((n) => (
                <div key={n.id} className="rounded-lg border border-primary/15 bg-primary/5 p-2.5">
                  <p className="text-[10px] font-semibold text-primary/80">{n.advisorName}</p>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{n.note}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">Updated {fmtDate(n.updatedAt)}</p>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        <CollapsibleSection
          id={`reminders-${inv.id}`}
          icon={<span>🔔</span>}
          title="Reminders"
          open={section === "reminders"}
          onOpenChange={(o) => setSection(o ? "reminders" : null)}
        >
          <RemindersList entityType="investment" entityId={inv.id} />
          <div className="flex justify-end pt-1">
            <ReminderButton entityType="investment" entityId={inv.id} />
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          id={`history-${inv.id}`}
          icon={<span>🔄</span>}
          title="Add an Update"
          count={historyCount}
          open={section === "history"}
          onOpenChange={(o) => setSection(o ? "history" : null)}
        >
          <HistoryLog entityType="investment" entityId={inv.id} />
        </CollapsibleSection>

        <CollapsibleSection
          id={`documents-${inv.id}`}
          icon={<span>📎</span>}
          title="Documents"
          count={documentsCount}
          open={section === "documents"}
          onOpenChange={(o) => setSection(o ? "documents" : null)}
        >
          <DocumentsList entityType="investment" entityId={inv.id} />
        </CollapsibleSection>
      </RecordCard>
      {edit.element}
      {dup.element}
    </HashHighlight>
  );
}

function InfoNote({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onPointerDown={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        aria-label="More info"
      >
        <Info className="h-3 w-3" />
      </button>
      {open && (
        <span className="absolute left-0 top-5 z-10 w-56 rounded-lg border border-border bg-card p-2 text-[11px] font-normal normal-case leading-snug text-muted-foreground shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}
