import { AddRecordFab } from "@/components/AddRecordFab";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAppStore } from "@/lib/store";
import { MemberFilterBar } from "@/components/MemberFilterBar";
import { RecordCard, FieldRow, Section } from "@/components/RecordCard";
import { useStatusMutation, useDeleteMutation } from "@/lib/mutations";
import { sortByStatus } from "@/lib/sort";
import { fmtMoney, fmtDate } from "@/lib/format";
import { HashHighlight } from "@/components/HashHighlight";
import { useEditRecord } from "@/components/EditRecordButton";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { NotesEditor } from "@/components/loan/NotesEditor";
import { HistoryLog } from "@/components/loan/HistoryLog";
import { DocumentsList } from "@/components/loan/DocumentsList";
import { ReminderButton } from "@/components/loan/ReminderButton";
import { RemindersList } from "@/components/loan/RemindersList";

export const Route = createFileRoute("/other-assets")({
  component: OtherAssetsPage,
  head: () => ({ meta: [{ title: "Other Assets — FamilyVault" }] }),
});

function OtherAssetsPage() {
  const memberFilter = useAppStore((s) => s.memberFilter);
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
  const status = useStatusMutation("other_assets", "other_assets");
  const del = useDeleteMutation("other_assets", "other_assets", "other_asset");

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
  const totalValue = items.reduce((s: number, i: any) => s + (Number(i.estimated_value) || 0), 0);

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
                  />
                ))}
              </div>
            </section>
          ))}
          <div className="rounded-2xl border border-border bg-card p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total estimated value</span>
              <span className="font-bold">{fmtMoney(totalValue)} <span className="text-xs font-normal text-muted-foreground">(est.)</span></span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">Values are manually entered estimates. Check "Value as of" dates.</p>
          </div>
        </>
      )}
      <AddRecordFab configKey="other_assets" />
    </div>
  );
}

function AssetRow({ asset, onStatus, onDelete }: { asset: any; onStatus: (s: any) => void; onDelete: () => void }) {
  const edit = useEditRecord("other_assets", asset);
  return (
    <HashHighlight id={`record-${asset.id}`}>
      <RecordCard
        title={asset.name}
        memberId={asset.member_id}
        status={asset.status}
        onStatusChange={onStatus}
        action={asset.action}
        onEdit={edit.open}
        onDelete={onDelete}
        hasNotes={!!asset.notes}
        updatedAt={asset.updated_at}
        createdAt={asset.created_at}
        rightMeta={
          asset.estimated_value ? (
            <div className="text-right text-xs">
              <div className="font-bold">{fmtMoney(asset.estimated_value)}</div>
              <div className="text-muted-foreground">(est.)</div>
            </div>
          ) : null
        }
      >
        <Section title="Details">
          <FieldRow label="Estimated value" value={asset.estimated_value ? `${fmtMoney(asset.estimated_value)} (est.)` : "—"} />
          <FieldRow label="Value as of" value={asset.last_updated ? fmtDate(asset.last_updated) : "—"} />
          {asset.action && <FieldRow label="Action" value={asset.action} />}
        </Section>

        <CollapsibleSection icon={<span>📝</span>} title="Notes">
          <NotesEditor
            table="other_assets"
            queryKey="other_assets"
            id={asset.id}
            value={asset.notes}
          />
        </CollapsibleSection>

        <CollapsibleSection icon={<span>🔄</span>} title="Add an Update">
          <HistoryLog entityType="other_asset" entityId={asset.id} />
        </CollapsibleSection>

        <CollapsibleSection icon={<span>📎</span>} title="Documents">
          <DocumentsList entityType="other_asset" entityId={asset.id} />
        </CollapsibleSection>

        <RemindersList entityType="other_asset" entityId={asset.id} />
        <div className="flex justify-end pt-1">
          <ReminderButton entityType="other_asset" entityId={asset.id} />
        </div>
      </RecordCard>
      {edit.element}
    </HashHighlight>
  );
}
