import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Search,
  Building2,
  Landmark,
  ShieldCheck,
  TrendingUp,
  HeartPulse,
  Gem,
  Wallet,
  Package,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAppStore } from "@/lib/store";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";

// Every record type this search covers, and how to find/display/link to it.
// column: which text column to match the typed search term against.
// href + hash: reuses the same "record-<id>" convention that AlertsSheet
// already relies on for deep-linking into a record on its page.
const SOURCES = [
  { table: "properties", column: "name", href: "/property", kind: "Properties", icon: Building2 },
  { table: "loans", column: "bank", href: "/loans", kind: "Loans", icon: Landmark },
  {
    table: "insurance_policies",
    column: "name",
    href: "/insurance",
    kind: "Insurance",
    icon: ShieldCheck,
  },
  {
    table: "investments",
    column: "name",
    href: "/investments",
    kind: "Investments",
    icon: TrendingUp,
  },
  {
    table: "savings_accounts",
    column: "institution",
    href: "/savings",
    kind: "Savings",
    icon: Wallet,
  },
  { table: "health_conditions", column: "name", href: "/health", kind: "Health", icon: HeartPulse },
  { table: "other_assets", column: "name", href: "/other-assets", kind: "Other Assets", icon: Gem },
  {
    table: "inventory_items",
    column: "name",
    href: "/inventory",
    kind: "Inventory",
    icon: Package,
  },
  { table: "members", column: "name", href: "/members", kind: "People", icon: Users },
] as const;

type Result = {
  id: string;
  title: string;
  href: string;
  kind: string;
  icon: (typeof SOURCES)[number]["icon"];
};

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
  const navigate = useNavigate();

  // Debounce typing so we don't fire a query on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  // Cmd+K / Ctrl+K to open from anywhere, same convention as most modern apps.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Reset the typed term each time the dialog is closed, so reopening starts fresh.
  useEffect(() => {
    if (!open) setTerm("");
  }, [open]);

  const shouldSearch = open && debounced.length >= 2 && !!activeHouseholdId;

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["global-search", activeHouseholdId, debounced],
    enabled: shouldSearch,
    staleTime: 30_000,
    queryFn: async () => {
      const pattern = `%${debounced}%`;
      const perTable = await Promise.all(
        SOURCES.map(async (s) => {
          const { data, error } = await (supabase as any)
            .from(s.table)
            .select(`id, ${s.column}`)
            .eq("household_id", activeHouseholdId)
            .ilike(s.column, pattern)
            .limit(8);
          if (error) return [] as Result[];
          return (data ?? []).map(
            (row: Record<string, unknown>): Result => ({
              id: row.id as string,
              title: (row[s.column] as string) || "(untitled)",
              href: s.href,
              kind: s.kind,
              icon: s.icon,
            }),
          );
        }),
      );
      return perTable.flat();
    },
  });

  const grouped = useMemo(() => {
    const map = new Map<string, Result[]>();
    for (const r of results) {
      if (!map.has(r.kind)) map.set(r.kind, []);
      map.get(r.kind)!.push(r);
    }
    return map;
  }, [results]);

  function goTo(r: Result) {
    setOpen(false);
    navigate({ to: r.href as any, hash: `record-${r.id}` });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        title="Search (⌘K)"
        className="cursor-pointer rounded-full p-2 hover:bg-accent"
      >
        <Search className="h-5 w-5" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] w-[calc(100%-2rem)] gap-0 overflow-hidden p-0 sm:w-full sm:max-w-lg">
          <DialogTitle className="sr-only">Search</DialogTitle>
          <DialogDescription className="sr-only">
            Search across properties, loans, insurance, investments, savings, health, other assets,
            inventory, and people.
          </DialogDescription>
          <Command shouldFilter={false} className="bg-transparent">
            <CommandInput
              autoFocus
              value={term}
              onValueChange={setTerm}
              placeholder="Search properties, loans, insurance, and more…"
            />
            <CommandList className="max-h-[60vh]">
              {!shouldSearch && debounced.length > 0 && debounced.length < 2 && (
                <p className="py-8 text-center text-sm text-muted-foreground">Keep typing…</p>
              )}
              {!shouldSearch && debounced.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Search across every record in this household
                </p>
              )}
              {shouldSearch && isFetching && results.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">Searching…</p>
              )}
              {shouldSearch && !isFetching && results.length === 0 && (
                <CommandEmpty>No matches for "{debounced}"</CommandEmpty>
              )}
              {Array.from(grouped.entries()).map(([kind, items]) => (
                <CommandGroup key={kind} heading={kind}>
                  {items.map((r) => {
                    const Icon = r.icon;
                    return (
                      <CommandItem
                        key={`${r.kind}-${r.id}`}
                        value={`${r.kind}-${r.id}-${r.title}`}
                        onSelect={() => goTo(r)}
                        className="cursor-pointer"
                      >
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="truncate">{r.title}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
