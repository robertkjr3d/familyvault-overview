// Shared per-table household data queries.
//
// Why this file exists: AppHeader, the dashboard (index.tsx), and the alerts
// bell (AlertsSheet.tsx) each independently fetch the same household tables
// (properties, loans, insurance, etc) as three separate network requests
// for the same data.
//
// These hooks give every consumer the SAME query key per table
// (e.g. ["properties", householdId]). TanStack Query automatically shares
// one in-flight request and one cache entry across every component asking
// for the same key at the same time — so using these hooks in more than one
// place is what removes the duplicate reads. No other wiring needed.
//
// The key names below intentionally match the `queryKey` values already
// defined in recordConfigs.ts (and already invalidated by RecordFormSheet,
// RecordWizardSheet, OnboardingWizard, savings.tsx, investments.tsx,
// inventory.tsx, etc). That means every existing "invalidate after save"
// call in this app already invalidates these shared caches too — nothing
// else needs to change for edits to keep showing up correctly.
//
// Optional third argument (refetchInterval): only pass this from the ONE
// always-mounted consumer that should own the periodic backstop refresh
// (AppHeader) — do not add it to every call site, or every mounted
// component would independently poll. Any observer of a shared key that
// sets refetchInterval keeps that key's cache warm for every other
// component reading the same key, whether or not they request an interval
// themselves.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type HouseholdId = string | null | undefined;

function useHouseholdTable<T = any>(
  cacheKey: string,
  table: string,
  householdId: HouseholdId,
  enabled: boolean = true,
  refetchInterval?: number,
) {
  return useQuery({
    queryKey: [cacheKey, householdId],
    enabled: !!householdId && enabled,
    refetchInterval,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table as any)
        .select("*")
        .eq("household_id", householdId!);
      if (error) throw error;
      return (data ?? []) as T[];
    },
  });
}

export const useProperties = (householdId: HouseholdId, enabled = true, refetchInterval?: number) =>
  useHouseholdTable("properties", "properties", householdId, enabled, refetchInterval);

export const useLoans = (householdId: HouseholdId, enabled = true, refetchInterval?: number) =>
  useHouseholdTable("loans", "loans", householdId, enabled, refetchInterval);

export const useInsurancePolicies = (householdId: HouseholdId, enabled = true, refetchInterval?: number) =>
  useHouseholdTable("insurance", "insurance_policies", householdId, enabled, refetchInterval);

export const useInvestments = (householdId: HouseholdId, enabled = true, refetchInterval?: number) =>
  useHouseholdTable("investments", "investments", householdId, enabled, refetchInterval);

export const useSavingsAccounts = (householdId: HouseholdId, enabled = true, refetchInterval?: number) =>
  useHouseholdTable("savings", "savings_accounts", householdId, enabled, refetchInterval);

export const useHealthConditions = (householdId: HouseholdId, enabled = true, refetchInterval?: number) =>
  useHouseholdTable("health", "health_conditions", householdId, enabled, refetchInterval);

export const useOtherAssets = (householdId: HouseholdId, enabled = true, refetchInterval?: number) =>
  useHouseholdTable("other_assets", "other_assets", householdId, enabled, refetchInterval);

export const useInventoryItems = (householdId: HouseholdId, enabled = true, refetchInterval?: number) =>
  useHouseholdTable("inventory_items", "inventory_items", householdId, enabled, refetchInterval);

export const useCreditCards = (householdId: HouseholdId, enabled = true, refetchInterval?: number) =>
  useHouseholdTable("credit_cards", "credit_cards", householdId, enabled, refetchInterval);
