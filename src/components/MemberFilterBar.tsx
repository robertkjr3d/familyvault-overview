import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMembers } from "@/hooks/useMembers";
import { useAppStore } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export function MemberFilterBar({
  className,
  table,
}: {
  className?: string;
  table?: string;
}) {
  const { data: members = [] } = useMembers();
  const { memberFilter, setMemberFilter, activeHouseholdId } = useAppStore();

  // Lightweight count query — only member_id column, only runs when table prop provided.
  // queryKey starts with [table] so it auto-invalidates when the page's main data changes.
  const { data: countRows = [] } = useQuery({
    queryKey: [table, "member-counts", activeHouseholdId],
    enabled: !!table && !!activeHouseholdId,
    queryFn: async () => {
      if (!table || !activeHouseholdId) return [];
      const { data } = await supabase.from(table as any).select("member_id").eq("household_id", activeHouseholdId);
      return data ?? [];
    },
  });

  // Build counts: "all" = total, each member_id = how many records they own.
  // Members with 0 records simply won't have a key — no badge shown for them (cleaner UI).
  const counts = useMemo<Record<string, number> | undefined>(() => {
    if (!table) return undefined;
    const map: Record<string, number> = { all: countRows.length };
    for (const row of countRows as any[]) {
      if (row.member_id) {
        map[row.member_id] = (map[row.member_id] ?? 0) + 1;
      }
    }
    return map;
  }, [table, countRows]);

  return (
    <div className={cn("flex flex-wrap gap-2", className)} data-tour="member-filter">
      <FilterChip
        active={memberFilter === "all"}
        onClick={() => setMemberFilter("all")}
        label="All"
        count={counts?.all}
      />
      {members.map((m) => (
        <FilterChip
          key={m.id}
          active={memberFilter === m.id}
          color={m.color}
          onClick={() => setMemberFilter(m.id)}
          label={m.short_name || m.name}
          emoji={m.emoji}
          count={counts?.[m.id]}
        />
      ))}
    </div>
  );
}

function FilterChip({
  active,
  color,
  onClick,
  label,
  emoji,
  count,
}: {
  active: boolean;
  color?: string;
  onClick: () => void;
  label: string;
  emoji?: string | null;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:bg-accent",
      )}
      style={color && !active ? { borderColor: color + "55", color } : undefined}
    >
      {emoji && <span>{emoji}</span>}
      {label}
      {count != null && (
        <span
          className={cn(
            "min-w-[18px] rounded-full px-1.5 text-center text-[10px] font-bold tabular-nums leading-none",
            active
              ? "bg-primary-foreground/25 text-primary-foreground"
              : "bg-muted text-muted-foreground",
          )}
          style={{ paddingTop: "3px", paddingBottom: "3px" }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export function MemberDot({
  color,
  label,
  className,
  emoji,
}: {
  color: string;
  label?: string;
  className?: string;
  emoji?: string | null;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        className,
      )}
      style={{ borderColor: color + "55", color, background: color + "15" }}
    >
      {emoji ? (
        <span className="text-xs leading-none">{emoji}</span>
      ) : (
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      )}
      {label}
    </span>
  );
}
