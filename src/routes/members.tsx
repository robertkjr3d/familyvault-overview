import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Trash2, Save, UserPlus } from "lucide-react";

export const Route = createFileRoute("/members")({
  component: MembersPage,
  head: () => ({ meta: [{ title: "Members - FamilyVault" }] }),
});

type MemberRow = {
  id: string;
  name: string;
  short_name: string | null;
  color: string;
  emoji: string;
  sort_order: number;
  birth_year: number | null;
};

const MEMBER_COLORS = [
  "hsl(345 83% 47%)",
  "hsl(221 83% 53%)",
  "hsl(164 73% 35%)",
  "hsl(40 95% 45%)",
  "hsl(262 83% 58%)",
  "hsl(12 76% 50%)",
];

const THIS_YEAR = new Date().getFullYear();

function MembersPage() {
  const qc = useQueryClient();
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
  const memberFilter = useAppStore((s) => s.memberFilter);
  const setMemberFilter = useAppStore((s) => s.setMemberFilter);

  const [newName, setNewName] = useState("");
  const [newShortName, setNewShortName] = useState("");
  const [newEmoji, setNewEmoji] = useState("👤");
  const [newColor, setNewColor] = useState(MEMBER_COLORS[0]);
  const [newBirthYear, setNewBirthYear] = useState<string>("");
  const [savingNew, setSavingNew] = useState(false);

  const [editing, setEditing] = useState<Record<string, Partial<MemberRow>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: members = [] } = useQuery({
    queryKey: ["members-manage", activeHouseholdId],
    enabled: !!activeHouseholdId,
    queryFn: async () => {
      if (!activeHouseholdId) return [];
      const { data, error } = await supabase
        .from("members" as any)
        .select("id, name, short_name, color, emoji, sort_order, birth_year")
        .eq("household_id", activeHouseholdId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as MemberRow[];
    },
  });

  const nextSortOrder = useMemo(() => {
    if (members.length === 0) return 0;
    return Math.max(...members.map((m) => m.sort_order ?? 0)) + 1;
  }, [members]);

  async function addMember() {
    if (!activeHouseholdId) { toast.error("Select a household first."); return; }
    const name = newName.trim();
    if (!name) { toast.error("Member name is required."); return; }
    const parsedBirthYear = newBirthYear ? parseInt(newBirthYear) : null;

    setSavingNew(true);
    try {
      const payload = {
        household_id: activeHouseholdId,
        name,
        short_name: newShortName.trim() || null,
        emoji: (newEmoji.trim() || "👤").slice(0, 2),
        color: newColor,
        sort_order: nextSortOrder,
        birth_year: parsedBirthYear,
      };
      const { error } = await supabase.from("members" as any).insert(payload as any);
      if (error) throw error;
      setNewName(""); setNewShortName(""); setNewEmoji("👤"); setNewBirthYear("");
      setNewColor(MEMBER_COLORS[(nextSortOrder + 1) % MEMBER_COLORS.length]);
      toast.success("Member added.");
      void qc.invalidateQueries({ queryKey: ["members"] });
      void qc.invalidateQueries({ queryKey: ["members-manage", activeHouseholdId] });
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Unable to add member.");
    } finally {
      setSavingNew(false);
    }
  }

  async function saveMember(member: MemberRow) {
    const draft = editing[member.id] ?? {};
    const name = (draft.name ?? member.name).trim();
    if (!name) { toast.error("Member name is required."); return; }
    const birthYearRaw = draft.birth_year ?? member.birth_year;
    const parsedBirthYear = birthYearRaw ? Number(birthYearRaw) : null;

    setSavingId(member.id);
    try {
      const { error } = await supabase
        .from("members" as any)
        .update({
          name,
          short_name: (draft.short_name ?? member.short_name ?? "").trim() || null,
          emoji: ((draft.emoji ?? member.emoji ?? "👤").trim() || "👤").slice(0, 2),
          color: draft.color ?? member.color,
          birth_year: parsedBirthYear,
        } as any)
        .eq("id", member.id);
      if (error) throw error;
      toast.success("Member updated.");
      setEditing((prev) => { const next = { ...prev }; delete next[member.id]; return next; });
      void qc.invalidateQueries({ queryKey: ["members"] });
      void qc.invalidateQueries({ queryKey: ["members-manage", activeHouseholdId] });
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Unable to update member.");
    } finally {
      setSavingId(null);
    }
  }

  async function deleteMember(member: MemberRow) {
    if (members.length <= 1) { toast.error("At least one member is required."); return; }
    if (!confirm(`Delete member "${member.name}"?`)) return;
    setDeletingId(member.id);
    try {
      const { error } = await supabase.from("members" as any).delete().eq("id", member.id);
      if (error) throw error;
      if (memberFilter === member.id) setMemberFilter("all");
      toast.success("Member deleted.");
      void qc.invalidateQueries({ queryKey: ["members"] });
      void qc.invalidateQueries({ queryKey: ["members-manage", activeHouseholdId] });
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Unable to delete member.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4 pb-24">
      <h1 className="text-2xl font-bold tracking-tight">Members</h1>

      {!activeHouseholdId ? (
        <div className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
          Select a household to manage members.
        </div>
      ) : (
        <>
          <section className="space-y-3 rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Add member</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Alex" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Short name</Label>
                <Input value={newShortName} onChange={(e) => setNewShortName(e.target.value)} placeholder="e.g. AL" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Birth year</Label>
                <Input
                  type="number" min="1920" max={THIS_YEAR}
                  value={newBirthYear}
                  onChange={(e) => setNewBirthYear(e.target.value)}
                  placeholder="e.g. 1985"
                />
                <p className="text-[10px] text-muted-foreground">Used for CPF and retirement projections</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Emoji</Label>
                <Input value={newEmoji} onChange={(e) => setNewEmoji(e.target.value)} placeholder="👤" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">Color</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {MEMBER_COLORS.map((c) => (
                    <button
                      key={c} type="button" aria-label={`Pick color ${c}`}
                      onClick={() => setNewColor(c)}
                      className={`h-7 w-7 rounded-full border ${newColor === c ? "border-foreground" : "border-border"}`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <Button onClick={addMember} disabled={savingNew}>
              <UserPlus className="mr-1.5 h-4 w-4" />
              {savingNew ? "Adding..." : "Add member"}
            </Button>
          </section>

          <section className="space-y-3">
            {members.length > 0 && (
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Current members</h2>
            )}
            {members.length === 0 && (
              <div className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
                No members yet.
              </div>
            )}
            {members.map((member) => {
              const draft = editing[member.id] ?? {};
              const currentColor = draft.color ?? member.color;
              const currentBirthYear = draft.birth_year !== undefined ? draft.birth_year : member.birth_year;
              const currentAge = currentBirthYear ? THIS_YEAR - Number(currentBirthYear) : null;

              return (
                <div key={member.id} className="space-y-3 rounded-xl border border-border bg-card p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Name</Label>
                      <Input
                        value={draft.name ?? member.name}
                        onChange={(e) => setEditing((prev) => ({ ...prev, [member.id]: { ...prev[member.id], name: e.target.value } }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Short name</Label>
                      <Input
                        value={draft.short_name ?? member.short_name ?? ""}
                        onChange={(e) => setEditing((prev) => ({ ...prev, [member.id]: { ...prev[member.id], short_name: e.target.value } }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">
                        Birth year {currentAge !== null && <span className="text-muted-foreground">(age {currentAge})</span>}
                      </Label>
                      <Input
                        type="number" min="1920" max={THIS_YEAR}
                        value={currentBirthYear ?? ""}
                        onChange={(e) => setEditing((prev) => ({ ...prev, [member.id]: { ...prev[member.id], birth_year: e.target.value ? parseInt(e.target.value) : null } }))}
                        placeholder="e.g. 1985"
                      />
                      <p className="text-[10px] text-muted-foreground">Used for CPF and retirement projections</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Emoji</Label>
                      <Input
                        value={draft.emoji ?? member.emoji}
                        onChange={(e) => setEditing((prev) => ({ ...prev, [member.id]: { ...prev[member.id], emoji: e.target.value } }))}
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-xs">Color</Label>
                      <div className="flex flex-wrap items-center gap-2">
                        {MEMBER_COLORS.map((c) => (
                          <button
                            key={`${member.id}-${c}`} type="button" aria-label={`Pick color ${c}`}
                            onClick={() => setEditing((prev) => ({ ...prev, [member.id]: { ...prev[member.id], color: c } }))}
                            className={`h-7 w-7 rounded-full border ${currentColor === c ? "border-foreground" : "border-border"}`}
                            style={{ background: c }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button onClick={() => saveMember(member)} disabled={savingId === member.id}>
                      <Save className="mr-1.5 h-4 w-4" />
                      {savingId === member.id ? "Saving..." : "Save"}
                    </Button>
                    <Button
                      variant="outline" className="text-urgent"
                      onClick={() => deleteMember(member)}
                      disabled={deletingId === member.id || savingId === member.id}
                    >
                      <Trash2 className="mr-1.5 h-4 w-4" />
                      {deletingId === member.id ? "Deleting..." : "Delete"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
