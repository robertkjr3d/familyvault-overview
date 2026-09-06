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
import { fmtMoney, fmtDate } from "@/lib/format";
import { HashHighlight } from "@/components/HashHighlight";
import { useEditRecord, useDuplicateRecord } from "@/components/EditRecordButton";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { NotesEditor } from "@/components/NotesEditor";
import { HistoryLog } from "@/components/HistoryLog";
import { DocumentsList } from "@/components/DocumentsList";
import { ReminderButton } from "@/components/ReminderButton";
import { RemindersList } from "@/components/RemindersList";
import { useEntityCounts } from "@/lib/useEntityCounts";

export const Route = createFileRoute("/cards")({
  component: CardsPage,
  head: () => ({ meta: [{ title: "Cards — FamilyHub SG" }] }),
});

function CardsPage() {
  const memberFilter = useAppStore((s) => s.memberFilter);
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
  const status = useStatusMutation("credit_cards", "credit_cards");
  const del = useDeleteMutation("credit_cards", "credit_cards", "credit_card");
  const counts = useEntityCounts("credit_card", activeHouseholdId);

  const { data: items = [] } = useQuery({
    queryKey: ["credit_cards", memberFilter, activeHouseholdId],
    enabled: !!activeHouseholdId,
    queryFn: async () => {
      if (!activeHouseholdId) return [];
      let q = supabase.from("credit_cards" as any).select("*").eq("household_id", activeHouseholdId);
      if (memberFilter !== "all") q = q.eq("member_id", memberFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // Active cards first (same status-based grouping every other tab uses), then
  // Cancelled kept visible below rather than hidden — the user's own real example
  // (a cancelled card whose points moved elsewhere) is a record worth keeping, not
  // deleting, same reasoning already established for other tabs' historical rows.
  const activeCards = sortByStatus(items.filter((c: any) => c.card_status !== "Cancelled"));
  const cancelledCards = sortByStatus(items.filter((c: any) => c.card_status === "Cancelled"));

  return (
    <div className="space-y-4 pb-24">
      <h1 className="text-2xl font-bold tracking-tight">Cards</h1>
      <MemberFilterBar table="credit_cards" />
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No cards yet. Tap + to add one.</p>
        </div>
      ) : (
        <>
          {activeCards.length > 0 && (
            <section>
              <div className="space-y-3">
                {activeCards.map((card: any) => (
                  <CardRow
                    key={card.id}
                    card={card}
                    onStatus={(s) => status.mutate({ id: card.id, status: s })}
                    onDelete={() => del.mutate(card.id)}
                    reminderCount={counts.reminderCounts[card.id] || 0}
                    historyCount={counts.historyCounts[card.id] || 0}
                    documentsCount={counts.documentsCounts[card.id] || 0}
                  />
                ))}
              </div>
            </section>
          )}
          {cancelledCards.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Cancelled</h2>
              <div className="space-y-3">
                {cancelledCards.map((card: any) => (
                  <CardRow
                    key={card.id}
                    card={card}
                    onStatus={(s) => status.mutate({ id: card.id, status: s })}
                    onDelete={() => del.mutate(card.id)}
                    reminderCount={counts.reminderCounts[card.id] || 0}
                    historyCount={counts.historyCounts[card.id] || 0}
                    documentsCount={counts.documentsCounts[card.id] || 0}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
      <AddRecordFab configKey="credit_cards" />
    </div>
  );
}

function CardRow({
  card, onStatus, onDelete, reminderCount, historyCount, documentsCount,
}: {
  card: any; onStatus: (s: any) => void; onDelete: () => void;
  reminderCount: number; historyCount: number; documentsCount: number;
}) {
  const edit = useEditRecord("credit_cards", card);
  const dup = useDuplicateRecord("credit_cards", card);

  const [cardOpen, setCardOpen] = useState(false);
  const [section, setSection] = useState<"notes" | "reminders" | "history" | "documents" | null>(null);

  function openSection(target: "notes" | "reminders" | "history" | "documents") {
    setCardOpen(true);
    setSection(target);
    setTimeout(() => {
      document.getElementById(`${target}-${card.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  }

  const subtitleParts = [card.issuer, card.network, card.last4 ? `••${card.last4}` : null].filter(Boolean);

  return (
    <HashHighlight id={`record-${card.id}`}>
      <RecordCard
        title={card.name}
        subtitle={subtitleParts.length > 0 ? subtitleParts.join(" · ") : undefined}
        memberId={card.member_id}
        status={card.status}
        onStatusChange={onStatus}
        action={card.action}
        externalUrl={card.external_url}
        onEdit={edit.open}
        onDuplicate={dup.open}
        onDelete={onDelete}
        hasNotes={!!card.notes}
        updatedAt={card.updated_at}
        createdAt={card.created_at}
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
          card.points_balance ? (
            <div className="text-right text-xs">
              <div className="font-bold">{Number(card.points_balance).toLocaleString()}</div>
              <div className="text-muted-foreground">{card.reward_type === "Cashback" ? "cashback" : "points"}</div>
            </div>
          ) : null
        }
      >
        <Section title="Details">
          {card.card_status === "Cancelled" && <FieldRow label="Status" value="Cancelled" />}
          {card.reward_type && <FieldRow label="Reward type" value={card.reward_type} />}
          {card.min_spend != null && <FieldRow label="Min. spend to qualify" value={fmtMoney(card.min_spend)} />}
          {card.annual_fee != null && <FieldRow label="Annual fee" value={fmtMoney(card.annual_fee)} />}
          {card.points_expiry_date && <FieldRow label="Points/rewards expiry" value={fmtDate(card.points_expiry_date)} />}
          {card.action && <FieldRow label="Action" value={card.action} />}
        </Section>

        <CollapsibleSection
          id={`notes-${card.id}`}
          icon={<span>📝</span>}
          title="Notes"
          open={section === "notes"}
          onOpenChange={(o) => setSection(o ? "notes" : null)}
        >
          <NotesEditor
            table="credit_cards"
            queryKey="credit_cards"
            id={card.id}
            value={card.notes}
          />
        </CollapsibleSection>

        <CollapsibleSection
          id={`reminders-${card.id}`}
          icon={<span>🔔</span>}
          title="Reminders"
          open={section === "reminders"}
          onOpenChange={(o) => setSection(o ? "reminders" : null)}
        >
          <RemindersList entityType="credit_card" entityId={card.id} />
          <div className="flex justify-end pt-1">
            <ReminderButton entityType="credit_card" entityId={card.id} />
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          id={`history-${card.id}`}
          icon={<span>🔄</span>}
          title="Add an Update"
          count={historyCount}
          open={section === "history"}
          onOpenChange={(o) => setSection(o ? "history" : null)}
        >
          <HistoryLog entityType="credit_card" entityId={card.id} />
        </CollapsibleSection>

        <CollapsibleSection
          id={`documents-${card.id}`}
          icon={<span>📎</span>}
          title="Documents"
          count={documentsCount}
          open={section === "documents"}
          onOpenChange={(o) => setSection(o ? "documents" : null)}
        >
          <DocumentsList entityType="credit_card" entityId={card.id} />
        </CollapsibleSection>
      </RecordCard>
      {edit.element}
      {dup.element}
    </HashHighlight>
  );
}
