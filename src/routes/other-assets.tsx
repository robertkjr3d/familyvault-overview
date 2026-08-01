import { useState } from "react";
import { AddRecordFab } from "@/components/AddRecordFab";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAppStore } from "@/lib/store";
import { MemberFilterBar } from "@/components/MemberFilterBar";
import { RecordCard, FieldRow, Section } from "@/components/RecordCard";
import { useStatusMutation, useDeleteMutation } from "@/lib/mutations";
import { sortByStatus } from "@/lib/sort";
import { fmtMoney, fmtDate, groupByCurrency, totalWithFx } from "@/lib/format";
import { FxInfoNote } from "@/components/FxInfoNote";
import { ForeignCurrencyTotals } from "@/components/ForeignCurrencyTotals";
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

export const Route = createFileRoute("/other-assets")({
  component: OtherAssetsPage,
  head: () => ({ meta: [{ title: "Other Assets — FamilyHub SG" }] }),
});

function OtherAssetsPage() {
  const memberFilter = useAppStore((s) => s.memberFilter);
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
  const status = useStatusMutation("other_assets", "other_assets");
  const del = useDeleteMutation("other_assets", "other_assets", "other_asset");
  const counts = useEntityCounts("other_asset", activeHouseholdId);
  const { data: fxRates } = useFxRates();

  const { data: items = [] } = useQuery({
    queryKey: ["other_assets", memberFilter, activeHouseholdId],
    enabled: !!activeHouseholdId,
    queryFn: async () => {
      if (!activeHouseholdId) return [];
      let q = supabase.from("other_assets").select("*").eq("household_id", activeHouseholdId);
      if (memberFilter !== "all") q = q.eq("member_id", memberFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const groups = Array.from(new Set(items.map((i: any) => i.category)));
  const valueTotals = groupByCurrency(items, (i: any) => i.estimated_value);
  const totalValue = totalWithFx(valueTotals, fxRates);

  return (
    <div className="space-y-4 pb-24">
      <h1 className="text-2xl font-bold tracking-tight">Other Assets</h1>
      <MemberFilterBar table="other_assets" />
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No assets yet. Tap + to add one.</p>
        </div>
      ) : (
        <>
          {groups.map((g) => (
            <section key={g}>
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">{g}</h2>
              <div className="space-y-3">
                {sortByStatus(items.filter((i: any) => i.category === g)).map((asset: any) => (
                  <AssetRow
                    key={asset.id}
                    asset={asset}
                    onStatus={(s) => status.mutate({ id: asset.id, status: s })}
                    onDelete={() => del.mutate(asset.id)}
                    reminderCount={counts.reminderCounts[asset.id] || 0}
                    historyCount={counts.historyCounts[asset.id] || 0}
                    documentsCount={counts.documentsCounts[asset.id] || 0}
                  />
                ))}
              </div>
            </section>
          ))}
          <div className="rounded-2xl border border-border bg-card p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Total estimated value{valueTotals.foreign.length > 0 && <FxInfoNote fx={fxRates} />}
              </span>
              <span className="font-bold">{fmtMoney(totalValue)} <span className="text-xs font-normal text-muted-foreground">(est.)</span></span>
            </div>
            <ForeignCurrencyTotals foreign={valueTotals.foreign} fx={fxRates} />
            <p className="mt-1 text-[11px] text-muted-foreground">Values are manually entered estimates. Check "Value as of" dates.</p>
          </div>
        </>
      )}
      <AddRecordFab configKey="other_assets" />
    </div>
  );
}

function AssetRow({
  asset, onStatus, onDelete, reminderCount, historyCount, documentsCount,
}: {
  asset: any; onStatus: (s: any) => void; onDelete: () => void;
  reminderCount: number; historyCount: number; documentsCount: number;
}) {
  const edit = useEditRecord("other_assets", asset);
  const dup = useDuplicateRecord("other_assets", asset);

  const [cardOpen, setCardOpen] = useState(false);
  const [section, setSection] = useState<"notes" | "reminders" | "history" | "documents" | null>(null);

  function openSection(target: "notes" | "reminders" | "history" | "documents") {
    setCardOpen(true);
    setSection(target);
    setTimeout(() => {
      document.getElementById(`${target}-${asset.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  }

  return (
    <HashHighlight id={`record-${asset.id}`}>
      <RecordCard
        title={asset.name}
        memberId={asset.member_id}
        status={asset.status}
        onStatusChange={onStatus}
        action={asset.action}
        onEdit={edit.open}
        onDuplicate={dup.open}
        onDelete={onDelete}
        hasNotes={!!asset.notes}
        updatedAt={asset.updated_at}
        createdAt={asset.created_at}
        open={cardOpen}
        onOpenChange={setCardOpen}
        reminderCount={reminderCount}
        historyCount={historyCount}
        documentsCount={documentsCount}
        onNotesClick={() => openSection("notes")}
        onReminderClick={() => openSection("reminders")}
        onHistoryClick={() => openSection("history")}
        onDocumentsClick={() => openSection("documents")}
        rightMeta={
          asset.estimated_value ? (
            <div className="text-right text-xs">
              <div className="font-bold">{fmtMoney(asset.estimated_value, asset.currency)}</div>
              <div className="text-muted-foreground">(est.)</div>
            </div>
          ) : null
        }
      >
        <Section title="Details">
          <FieldRow label="Estimated value" value={asset.estimated_value ? `${fmtMoney(asset.estimated_value, asset.currency)} (est.)` : "—"} />
          <FieldRow label="Value as of" value={asset.last_updated ? fmtDate(asset.last_updated) : "—"} />
          {asset.action && <FieldRow label="Action" value={asset.action} />}
        </Section>

        <CollapsibleSection
          id={`notes-${asset.id}`}
          icon={<span>📝</span>}
          title="Notes"
          open={section === "notes"}
          onOpenChange={(o) => setSection(o ? "notes" : null)}
        >
          <NotesEditor
            table="other_assets"
            queryKey="other_assets"
            id={asset.id}
            value={asset.notes}
          />
        </CollapsibleSection>

        <CollapsibleSection
          id={`reminders-${asset.id}`}
          icon={<span>🔔</span>}
          title="Reminders"
          open={section === "reminders"}
          onOpenChange={(o) => setSection(o ? "reminders" : null)}
        >
          <RemindersList entityType="other_asset" entityId={asset.id} />
          <div className="flex justify-end pt-1">
            <ReminderButton entityType="other_asset" entityId={asset.id} />
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          id={`history-${asset.id}`}
          icon={<span>🔄</span>}
          title="Add an Update"
          count={historyCount}
          open={section === "history"}
          onOpenChange={(o) => setSection(o ? "history" : null)}
        >
          <HistoryLog entityType="other_asset" entityId={asset.id} />
        </CollapsibleSection>

        <CollapsibleSection
          id={`documents-${asset.id}`}
          icon={<span>📎</span>}
          title="Documents"
          count={documentsCount}
          open={section === "documents"}
          onOpenChange={(o) => setSection(o ? "documents" : null)}
        >
          <DocumentsList entityType="other_asset" entityId={asset.id} />
        </CollapsibleSection>
      </RecordCard>
      {edit.element}
      {dup.element}
    </HashHighlight>
  );
}
