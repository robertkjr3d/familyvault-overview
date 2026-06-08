import { AddRecordFab } from "@/components/AddRecordFab";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMembers } from "@/hooks/useMembers";
import { useAppStore } from "@/lib/store";
import { MemberFilterBar } from "@/components/MemberFilterBar";
import { RecordCard, Section } from "@/components/RecordCard";
import { useStatusMutation, useDeleteMutation } from "@/lib/mutations";
import { sortByStatus } from "@/lib/sort";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { NotesEditor } from "@/components/loan/NotesEditor";
import { HistoryLog } from "@/components/loan/HistoryLog";
import { DocumentsList } from "@/components/loan/DocumentsList";
import { useEditRecord } from "@/components/EditRecordButton";
import { ReminderButton } from "@/components/loan/ReminderButton";
import { RemindersList } from "@/components/loan/RemindersList";

export const Route = createFileRoute("/health")({
  component: HealthPage,
  head: () => ({ meta: [{ title: "Health — FamilyVault" }] }),
});

function HealthPage() {
  const memberFilter = useAppStore((s) => s.memberFilter);
  const status = useStatusMutation("health_conditions", "health");
  const del = useDeleteMutation("health_conditions", "health");
  const { data: members = [] } = useMembers();

  const { data: items = [] } = useQuery({
    queryKey: ["health", memberFilter],
    queryFn: async () => {
      let q = supabase.from("health_conditions").select("*");
      if (memberFilter !== "all") q = q.eq("member_id", memberFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Health</h1>
      <MemberFilterBar table="health_conditions" />
      {members.map((m) => {
        const conditions = items.filter((c: any) => c.member_id === m.id);
        if (conditions.length === 0) return null;
        return (
          <section key={m.id}>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider" style={{ color: m.color }}>
              {m.name}
            </h2>
            <div className="space-y-3">
              {sortByStatus(conditions).map((c: any) => (
                <HealthRow
                  key={c.id}
                  c={c}
                  onStatus={(s) => status.mutate({ id: c.id, status: s })}
                  onDelete={() => del.mutate(c.id)}
                />
              ))}
            </div>
          </section>
        );
      })}
      <AddRecordFab configKey="health_conditions" />
    </div>
  );
}

function HealthRow({ c, onStatus, onDelete }: { c: any; onStatus: (s: any) => void; onDelete: () => void }) {
  const edit = useEditRecord("health_conditions", c);
  return (
    <>
      <RecordCard
        title={c.name}
        memberId={c.member_id}
        status={c.status}
        onStatusChange={onStatus}
        onEdit={edit.open}
        onDelete={onDelete}
        hasNotes={!!c.notes}
      >
        {(c.supplements?.length || 0) > 0 && (
          <Section title="Take">
            <div className="flex flex-wrap gap-1.5">
              {c.supplements.map((s: string) => (
                <span key={s} className="rounded-full bg-accent px-2.5 py-1 text-xs font-medium">{s}</span>
              ))}
            </div>
          </Section>
        )}
        {(c.actions?.length || 0) > 0 && (
          <Section title="Do">
            <div className="flex flex-wrap gap-1.5">
              {c.actions.map((s: string) => (
                <span key={s} className="rounded-full bg-settled-soft px-2.5 py-1 text-xs font-medium text-settled">{s}</span>
              ))}
            </div>
          </Section>
        )}
        {c.details && (
          <Section title="Details">
            <p className="text-sm text-foreground/80">{c.details}</p>
          </Section>
        )}
        <CollapsibleSection icon={<span>📝</span>} title="Notes">
          <NotesEditor table="health_conditions" queryKey="health" id={c.id} value={c.notes} />
        </CollapsibleSection>
        <CollapsibleSection icon={<span>🔄</span>} title="Add an Update">
          <HistoryLog entityType="health" entityId={c.id} />
        </CollapsibleSection>
        <CollapsibleSection icon={<span>📎</span>} title="Documents">
          <DocumentsList entityType="health" entityId={c.id} />
        </CollapsibleSection>

        <RemindersList entityType="health" entityId={c.id} />
        <div className="flex justify-end pt-1">
          <ReminderButton entityType="health" entityId={c.id} />
        </div>
      </RecordCard>
      {edit.element}
    </>
  );
}
