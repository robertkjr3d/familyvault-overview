// Shared hook: what is the signed-in user's role in the currently active
// household, and can they edit anything (owner/member) or only view (viewer)?
//
// Reuses the exact same query key AppHeader already fetches for the household
// switcher ("household-memberships", user id) - this doesn't cause a second
// network request, it shares AppHeader's cache entry via the same mechanism
// as the household-record hooks in householdRecordQueries.ts.
//
// Fails closed: until the role is actually known, canEdit is false. A brief
// "buttons appear a beat after the page loads" is a smaller cost than a
// viewer seeing edit controls for a moment before they're hidden.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useAppStore } from "@/lib/store";

type Role = "owner" | "member" | "viewer";

export function useCurrentRole() {
  const { user } = useAuthSession();
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);

  const { data: memberships, isLoading } = useQuery({
    queryKey: ["household-memberships", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("household_users" as any)
        .select("household_id, role, has_seen_tour, households(id, name, storage_tier, storage_bytes_used)")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []) as unknown as Array<{
        household_id: string;
        role: Role;
        has_seen_tour: boolean;
        households: { id: string; name: string; storage_tier: string | null; storage_bytes_used: number | null } | null;
      }>;
    },
  });

  const selectedMembership = useMemo(() => {
    if (!memberships) return null;
    const firstHouseholdId = memberships[0]?.household_id ?? null;
    const selectedHouseholdId = activeHouseholdId ?? firstHouseholdId;
    return memberships.find((m) => m.household_id === selectedHouseholdId) ?? null;
  }, [memberships, activeHouseholdId]);

  const role: Role | null = selectedMembership?.role ?? null;
  const householdId: string | null = selectedMembership?.household_id ?? null;
  const householdName: string | null = selectedMembership?.households?.name ?? null;
  // undefined (not false) while loading, so callers can tell "don't know
  // yet" apart from "confirmed not seen" and avoid a flash of the welcome
  // screen before the real value arrives.
  const hasSeenTour: boolean | undefined = selectedMembership ? selectedMembership.has_seen_tour : undefined;

  const storageTier: string | null = selectedMembership?.households?.storage_tier ?? "free";
  const storageBytesUsed: number = selectedMembership?.households?.storage_bytes_used ?? 0;

  const canEdit = role === "owner" || role === "member";

  return {
    role,
    canEdit,
    isViewer: role === "viewer",
    isLoading,
    householdId,
    householdName,
    hasSeenTour,
    storageTier,
    storageBytesUsed,
  };
}
