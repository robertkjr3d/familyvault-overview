import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToday } from "@/lib/today";
import { AlertsSheet } from "./AlertsSheet";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useAppStore } from "@/lib/store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export function AppHeader() {
  const { simulated, today } = useToday();
  const { user } = useAuthSession();
  const [alertsOpen, setAlertsOpen] = useState(false);
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
  const setActiveHouseholdId = useAppStore((s) => s.setActiveHouseholdId);

  const { data: memberships = [] } = useQuery({
    queryKey: ["household-memberships", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("household_users" as any)
        .select("household_id, role, households(id, name)")
        .eq("user_id", user!.id);
      if (error) throw error;

      return (data ?? []) as Array<{
        household_id: string;
        role: "owner" | "member" | "viewer";
        households: { id: string; name: string } | null;
      }>;
    },
  });

  const households = memberships
    .map((m) => ({ id: m.household_id, name: m.households?.name ?? "Household", role: m.role }))
    .filter((h, i, arr) => arr.findIndex((x) => x.id === h.id) === i);

  useEffect(() => {
    if (!activeHouseholdId && households.length > 0) {
      setActiveHouseholdId(households[0].id);
    }
  }, [activeHouseholdId, households, setActiveHouseholdId]);
  const { data: settings } = useQuery({
    queryKey: ["app_settings"],
    queryFn: async () => {
      const { data } = await supabase.from("app_settings").select("*").eq("id", 1).maybeSingle();
      return data;
    },
  });
  const { data: alertCount = 0 } = useQuery({
    queryKey: ["alert-count"],
    queryFn: async () => {
      const tables = ["properties", "loans", "insurance_policies", "investments", "health_conditions"];
      let count = 0;
      for (const t of tables) {
        const { count: c } = await supabase.from(t as any).select("*", { count: "exact", head: true }).in("status", ["urgent", "review"]);
        count += c ?? 0;
      }
      return count;
    },
    refetchInterval: 30_000,
  });

  return (
    <>
      {simulated && (
        <div className="bg-review px-4 py-2 text-center text-xs font-semibold text-review-foreground">
          ⚠ Test Mode: Simulating {today.toDateString()}
        </div>
      )}
      <header className="sticky top-0 z-30 border-b border-border bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">FamilyVault</div>
            <h1 className="text-lg font-bold tracking-tight">{settings?.family_name ?? "Our Family"}</h1>
            {user?.email && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">{user.email}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {households.length > 0 && (
              <div className="w-36">
                <Select value={activeHouseholdId ?? households[0].id} onValueChange={setActiveHouseholdId}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Household" />
                  </SelectTrigger>
                  <SelectContent>
                    {households.map((h) => (
                      <SelectItem key={h.id} value={h.id}>
                        {h.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <button
              type="button"
              onClick={() => setAlertsOpen(true)}
              className="relative cursor-pointer rounded-full p-2 hover:bg-accent"
              aria-label="Open alerts"
            >
              <Bell className="h-5 w-5" />
              {alertCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-urgent px-1 text-[9px] font-bold text-urgent-foreground">
                  {alertCount}
                </span>
              )}
            </button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void supabase.auth.signOut();
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <AlertsSheet open={alertsOpen} onOpenChange={setAlertsOpen} />
    </>
  );
}
