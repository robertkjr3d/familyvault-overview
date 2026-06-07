import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAppStore } from "@/lib/store";

export type Member = {
  id: string;
  name: string;
  short_name: string | null;
  color: string;
  sort_order: number;
  emoji: string | null;
};

export function useMembers() {
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
  return useQuery({
    queryKey: ["members", activeHouseholdId],
    enabled: !!activeHouseholdId,
    queryFn: async () => {
      if (!activeHouseholdId) return [];
      const { data, error } = await supabase
        .from("members")
        .select("*")
        .eq("household_id", activeHouseholdId)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as Member[];
    },
  });
}
