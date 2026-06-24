import { useEffect, useMemo, useState } from "react";
import { Bell, Crown, Share2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToday } from "@/lib/today";
import { AlertsSheet } from "./AlertsSheet";
import { buildUpcomingItems } from "@/lib/alerts";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useAppStore } from "@/lib/store";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { sendHouseholdInvite, transferHouseholdOwnership, listHouseholdPeople } from "@/lib/householdInvites";

export function AppHeader() {
  const { simulated, today } = useToday();
  const { user } = useAuthSession();
  const queryClient = useQueryClient();
  const [alertsOpen, setAlertsOpen] = useState(false);
  const shareOpen = useAppStore((s) => s.shareOpen);
  const setShareOpen = useAppStore((s) => s.setShareOpen);
  const [shareEmail, setShareEmail] = useState("");
  const [shareRole, setShareRole] = useState<"member" | "viewer">("member");
  const [transferEmail, setTransferEmail] = useState("");
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

  const households = useMemo(
    () =>
      memberships
        .map((m) => ({ id: m.household_id, name: m.households?.name ?? "Household", role: m.role }))
        .filter((h, i, arr) => arr.findIndex((x) => x.id === h.id) === i),
    [memberships]
  );

  const selectedHouseholdId = activeHouseholdId ?? households[0]?.id ?? null;
  const selectedHousehold = households.find((h) => h.id === selectedHouseholdId) ?? null;
  const selectedMembership = memberships.find((m) => m.household_id === selectedHouseholdId);
  const canShareActiveHousehold = selectedMembership?.role === "owner";

  useEffect(() => {
    if (households.length === 0) return;
    // Correct two cases: no household selected yet (fresh login, empty
    // localStorage), AND a selected household that no longer matches any of
    // the user's current memberships (stale id left over in localStorage —
    // e.g. from earlier testing, a recreated household, or a different
    // account having used this browser). Both cases previously left
    // activeHouseholdId pointing at something invalid, which made the
    // header show blank and made every insert fail RLS until the user
    // manually reselected the household from the dropdown.
    const isCurrentSelectionValid = households.some((h) => h.id === activeHouseholdId);
    if (!isCurrentSelectionValid) {
      setActiveHouseholdId(households[0].id);
    }
  }, [activeHouseholdId, households, setActiveHouseholdId]);

  const { data: settings } = useQuery({
    queryKey: ["app_settings", selectedHouseholdId],
    enabled: !!selectedHouseholdId,
    queryFn: async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("*")
        .eq("household_id", selectedHouseholdId!)
        .maybeSingle();
      return data;
    },
  });

  // 30-day horizon, same source-of-truth as the AlertsSheet ("Due Soon" list) and
  // the dashboard's 90-day view. Any new alert source only needs to be added once,
  // in src/lib/alerts.ts.
  const { data: alertCount = 0 } = useQuery({
    queryKey: ["alert-count", selectedHouseholdId],
    enabled: !!selectedHouseholdId,
    queryFn: async () => {
      const today = new Date();
      const householdId = selectedHouseholdId!;

      const [properties, loans, insurance, investments, savings, inventoryItems, reminders, dismissed] = await Promise.all([
        supabase.from("properties").select("*").eq("household_id", householdId).then((r) => r.data ?? []),
        supabase.from("loans").select("*").eq("household_id", householdId).then((r) => r.data ?? []),
        supabase.from("insurance_policies").select("*").eq("household_id", householdId).then((r) => r.data ?? []),
        supabase.from("investments").select("*").eq("household_id", householdId).then((r) => r.data ?? []),
        supabase.from("savings_accounts").select("*").eq("household_id", householdId).then((r) => r.data ?? []),
        supabase.from("inventory_items").select("*").eq("household_id", householdId).then((r) => r.data ?? []),
        supabase.from("reminders").select("*").eq("household_id", householdId).eq("dismissed", false).then((r) => r.data ?? []),
        supabase.from("dismissed_dashboard_items").select("record_id, source_type, dismissed_date").eq("household_id", householdId).then((r) => r.data ?? []),
      ]);

      const dismissedKeys = new Set(
        dismissed.map((d: any) => `${d.source_type}::${d.record_id}::${d.dismissed_date}`)
      );

      const allItems = buildUpcomingItems(
        { properties, loans, insurance, investments, savings, inventoryItems, reminders },
        today,
        30,
        {
          mortgage_days: settings?.mortgage_days,
          insurance_days: settings?.insurance_days,
          fd_days: settings?.fd_days,
          warranty_days: settings?.warranty_days,
        }
      );

      return allItems.filter((item) => !dismissedKeys.has(`${item.sourceType}::${item.recordId}::${item.date}`)).length;
    },
    refetchInterval: 5_000,
  });

  const { data: people, isLoading: peopleLoading } = useQuery({
    queryKey: ["household-people", selectedHouseholdId],
    enabled: shareOpen && !!selectedHouseholdId,
    queryFn: async () => {
      const result = await listHouseholdPeople({ data: { householdId: selectedHouseholdId! } });
      return result;
    },
  });

  const shareMutation = useMutation({
    mutationFn: async ({ email, role }: { email: string; role: "member" | "viewer" }) => {
      if (!selectedHouseholdId) {
        throw new Error("Select a household first.");
      }

      const result = await sendHouseholdInvite({
        data: {
          householdId: selectedHouseholdId,
          email,
          role,
        },
      });

      return result;
    },
    onSuccess: () => {
      toast.success("Invitation email sent.");
      setShareEmail("");
      setShareRole("member");
      queryClient.invalidateQueries({ queryKey: ["household-people", selectedHouseholdId] });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Unable to share access.";
      toast.error(message);
    },
  });

  const transferOwnershipMutation = useMutation({
    mutationFn: async ({ email }: { email: string }) => {
      if (!selectedHouseholdId) {
        throw new Error("Select a household first.");
      }

      const result = await transferHouseholdOwnership({
        data: {
          householdId: selectedHouseholdId,
          email,
        },
      });

      return result;
    },
    onSuccess: () => {
      toast.success("Ownership transferred.");
      setTransferEmail("");
      setShareOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["household-memberships", user?.id] });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Unable to transfer ownership.";
      toast.error(message);
    },
  });

  function onShareSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const normalized = shareEmail.trim().toLowerCase();
    if (!normalized) {
      toast.error("Enter an email address.");
      return;
    }
    shareMutation.mutate({ email: normalized, role: shareRole });
  }

  function onTransferSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const normalized = transferEmail.trim().toLowerCase();
    if (!normalized) {
      toast.error("Enter an email address.");
      return;
    }
    transferOwnershipMutation.mutate({ email: normalized });
  }

  // Real date — always today's actual date, never the simulated test date
  const realDateLabel = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
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
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">FamilyHub SG</div>
            <h1 className="text-lg font-bold tracking-tight">{settings?.family_name ?? "Our Family"}</h1>
            {user?.email && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">{user.email}</p>
            )}
            <p className="mt-0.5 text-[11px] font-medium tabular-nums text-muted-foreground sm:hidden">
              {realDateLabel}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Today's real date — hidden on mobile to save space */}
            <span className="hidden shrink-0 select-none text-[11px] font-medium tabular-nums text-muted-foreground sm:inline">
              {realDateLabel}
            </span>

            {households.length > 0 && (
              <div className="w-28 sm:w-36">
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

            {canShareActiveHousehold && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShareOpen(true)}
                disabled={!selectedHouseholdId}
                title="Share household access"
                className="hidden sm:flex"
              >
                <Share2 className="mr-1 h-4 w-4" /> Share
              </Button>
            )}
          </div>
        </div>
      </header>
      <AlertsSheet open={alertsOpen} onOpenChange={setAlertsOpen} />

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share by Email</DialogTitle>
            <DialogDescription>
              Send an invite link for {selectedHousehold?.name ?? "this household"}. The recipient can accept directly from their email.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Who has access</p>
            {peopleLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
            {!peopleLoading && people && (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                {people.members.map((m) => (
                  <div key={m.email} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate">{m.email}{m.isYou ? " (you)" : ""}</span>
                    <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium capitalize text-accent-foreground">
                      {m.role}
                    </span>
                  </div>
                ))}
                {people.pending.map((p) => (
                  <div key={p.email} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-muted-foreground">{p.email}</span>
                    <span className="shrink-0 rounded-full bg-review-soft px-2 py-0.5 text-[10px] font-medium text-review-foreground">
                      Invited, pending
                    </span>
                  </div>
                ))}
                {people.members.length === 0 && people.pending.length === 0 && (
                  <p className="text-xs text-muted-foreground">No one else has access yet.</p>
                )}
              </div>
            )}
          </div>

          <div className="my-2 border-t border-border" />

          <form className="space-y-3" onSubmit={onShareSubmit}>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Email</label>
              <Input
                type="email"
                placeholder="name@example.com"
                value={shareEmail}
                onChange={(e) => setShareEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Access level</label>
              <Select value={shareRole} onValueChange={(value: "member" | "viewer") => setShareRole(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button type="submit" disabled={shareMutation.isPending || !canShareActiveHousehold}>
                {shareMutation.isPending ? "Sharing..." : "Share access"}
              </Button>
            </DialogFooter>
          </form>

          <div className="my-2 border-t border-border" />

          <form className="space-y-3" onSubmit={onTransferSubmit}>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Transfer ownership to email</label>
              <Input
                type="email"
                placeholder="owner@example.com"
                value={transferEmail}
                onChange={(e) => setTransferEmail(e.target.value)}
                autoComplete="email"
                required
              />
              <p className="text-xs text-muted-foreground">
                Target must already be a member of this household. You will be downgraded to member.
              </p>
            </div>

            <DialogFooter>
              <Button
                type="submit"
                variant="destructive"
                disabled={transferOwnershipMutation.isPending || !canShareActiveHousehold}
              >
                <Crown className="mr-1 h-4 w-4" />
                {transferOwnershipMutation.isPending ? "Transferring..." : "Transfer ownership"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
