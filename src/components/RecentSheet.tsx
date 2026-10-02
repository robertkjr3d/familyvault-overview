import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { MemberTag } from "./MemberTag";
import { SOURCES } from "./AlertsSheet";
import { useAppStore } from "@/lib/store";
import { flashRecord } from "./HashHighlight";
import { buildRecentList, timeAgo } from "@/lib/recentChanges";
import {
  useProperties,
  useLoans,
  useInsurancePolicies,
  useInvestments,
  useSavingsAccounts,
  useHealthConditions,
  useOtherAssets,
  useCreditCards,
} from "@/lib/householdRecordQueries";

// Inventory is left out on purpose: its table has no automatic "last edited"
// stamp, and its items live inside folders rather than in a card list.
const RECENT_SOURCES = SOURCES.filter((s) => s.key !== "inventory_items");

/**
 * "Recently edited" list behind the clock icon in the header. Builds the list
 * from the same shared per-table queries the bell and dashboard already use
 * (nothing new is fetched from the database), and each row links to the card
 * by going to that tab and calling flashRecord(id), which makes HashHighlight
 * scroll to the card and flash it (works on the same page too, where a plain
 * #hash link would not, because the router does not send a hashchange event).
 */
export function RecentSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
  const setMemberFilter = useAppStore((s) => s.setMemberFilter);
  const gate = open && !!activeHouseholdId;

  const propertiesQ = useProperties(activeHouseholdId, gate);
  const loansQ = useLoans(activeHouseholdId, gate);
  const insuranceQ = useInsurancePolicies(activeHouseholdId, gate);
  const investmentsQ = useInvestments(activeHouseholdId, gate);
  const savingsQ = useSavingsAccounts(activeHouseholdId, gate);
  const healthQ = useHealthConditions(activeHouseholdId, gate);
  const otherAssetsQ = useOtherAssets(activeHouseholdId, gate);
  const creditCardsQ = useCreditCards(activeHouseholdId, gate);

  const queries = [
    propertiesQ,
    loansQ,
    insuranceQ,
    investmentsQ,
    savingsQ,
    healthQ,
    otherAssetsQ,
    creditCardsQ,
  ];
  const loaded = queries.every((q) => q.data !== undefined);
  const failed = queries.some((q) => q.isError);

  const entries = loaded
    ? buildRecentList(RECENT_SOURCES, {
        properties: propertiesQ.data,
        loans: loansQ.data,
        insurance: insuranceQ.data,
        investments: investmentsQ.data,
        savings: savingsQ.data,
        health: healthQ.data,
        other_assets: otherAssetsQ.data,
        credit_cards: creditCardsQ.data,
      })
    : [];
  const now = Date.now();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Recently edited</SheetTitle>
          <SheetDescription>Tap a card to jump straight to it.</SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          {!loaded && !failed && (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          )}
          {failed && !loaded && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Could not load. Please try again.
            </p>
          )}
          {loaded && entries.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">Nothing edited yet.</p>
          )}
          {entries.length > 0 && (
            <ul className="space-y-2">
              {entries.map((e) => {
                const src = RECENT_SOURCES.find((s) => s.key === e.key)!;
                const Icon = src.icon;
                return (
                  <li key={`${e.key}-${e.row.id}`}>
                    <Link
                      to={src.href as any}
                      onClick={() => {
                        onOpenChange(false);
                        setMemberFilter(e.row.member_id ?? "all");
                        flashRecord(e.row.id);
                      }}
                      className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-3 hover:bg-accent/50"
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                            {src.kind}
                          </span>
                          <span className="min-w-0 line-clamp-2 break-words text-sm font-semibold">
                            {e.title}
                          </span>
                          <MemberTag memberId={e.row.member_id} />
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {e.isNew ? "Added" : "Edited"} {timeAgo(e.at, now)}
                        </div>
                      </div>
                      <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">
                        View <ChevronRight className="h-3 w-3" />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
