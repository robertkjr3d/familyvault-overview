import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMembers } from "@/hooks/useMembers";
import { useAppStore } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useIsDark } from "@/hooks/useIsDark";
import { readableMemberColor } from "@/lib/memberColor";

export function MemberFilterBar({
  className,
  table,
  tourTarget = "member-filter",
}: {
  className?: string;
  table?: string;
  // The guided tour finds this bar by name. Two pages showing a bar with the
  // SAME name can be confused with each other mid-navigation, so a page the
  // tour moves to gives its own (see member-confirm in tourSteps.ts).
  tourTarget?: string;
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
    <div className={cn("flex flex-wrap gap-2", className)} data-tour={tourTarget}>
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
  // Bug fix (Aug 28, 2026): see memberColor.ts's own comment — a member's
  // freely-chosen color had no theme adjustment before this, so it could
  // read fine in light mode and be nearly illegible in dark mode (or vice
  // versa). This is the one shared component behind every member tag/card
  // in the app, so fixing it here covers all of them.
  const isDark = useIsDark();
  const c = readableMemberColor(color, isDark);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        className,
      )}
      style={{ borderColor: c + "55", color: c, background: c + "15" }}
    >
      {emoji ? (
        <span className="text-xs leading-none">{emoji}</span>
      ) : (
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      )}
      {label}
    </span>
  );
}

/**
 * Small filled circle + first-letter initial, colored per member — used
 * where a full MemberDot pill (emoji + name) would take too much room, e.g.
 * next to each line in the dashboard's cash-flow breakdown when viewing the
 * whole family combined ("All"). Not meant to replace MemberDot elsewhere;
 * this is deliberately compact and unlabelled, so callers should only use
 * it where the surrounding context makes clear a per-member breakdown is
 * being shown, and should gate it on the "All" member-filter view — a
 * single-member view has no need to keep repeating whose item it is.
 */
export function MemberInitialDot({ memberId }: { memberId: string | null | undefined }) {
  const { data: members = [] } = useMembers();
  const isDark = useIsDark();
  if (!memberId) return null;
  const m = members.find((x) => x.id === memberId);
  if (!m) return null;
  const c = readableMemberColor(m.color, isDark);
  // Sep 6 2026 v2: was computing per-color WCAG contrast (readableTextOn),
  // which is more "theoretically correct" but the user's own eyes on the
  // real rendered app said otherwise — every dark-mode color read better
  // with black text, every light-mode color read better with white, full
  // stop, no exceptions needed. Simplified to match what was actually
  // observed rather than what the contrast math technically prefers.
  const textColor = isDark ? "#000000" : "#ffffff";
  const letter = (m.short_name || m.name || "?").trim().charAt(0).toUpperCase();
  // Centering fix v2 (Sep 27 2026): the first attempt (text-align + fixed
  // line-height on a flex-centered <span>) didn't actually fix it — user
  // confirmed the letter was still off-center after that deploy. The real
  // cause is more fundamental: CSS box-model centering (flexbox or
  // text-align) centers a text glyph's ADVANCE WIDTH, which bakes in each
  // font's own left/right side-bearings — those differ per letter, so no
  // amount of box-centering CSS can make every single letter look visually
  // centered at once, no matter how it's tuned. Switched to SVG instead:
  // `text-anchor="middle"` + `dominant-baseline="central"` center the text
  // node directly around a fixed coordinate, which is how the letter's
  // actual rendered glyph is measured, not its box — the standard, reliable
  // fix for this exact "avatar initial looks off-center" problem.
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      className="mr-1.5 inline-block shrink-0 align-middle"
    >
      <title>{m.short_name || m.name}</title>
      <circle cx="8" cy="8" r="8" fill={c} />
      <text
        x="8"
        y="8"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="9"
        fontWeight="bold"
        fill={textColor}
      >
        {letter}
      </text>
    </svg>
  );
}
