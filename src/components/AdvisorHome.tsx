import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Toaster, toast } from "sonner";
import {
  listClientHouseholdsForAdvisor,
  getClientRecordsForAdvisor,
  getAdvisorNetworthSummary,
  STALE_AFTER_DAYS,
  ADVISOR_ALERT_HORIZON_DAYS,
} from "@/lib/advisorAccess";
import { generateAndDownloadAdvisorPdf, groupAdvisorRecords } from "@/lib/advisorPdf";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { fmtMoney, fmtDate } from "@/lib/format";

async function handleSignOut() {
  await supabase.auth.signOut();
}

// A "client" here is a (household, member) PAIR — a household that has
// shared 2 members with the same advisor produces 2 separate cards, never
// one combined household total. See listClientHouseholdsForAdvisor.
type SelectedClient = { householdId: string; memberId: string };

export function AdvisorHome() {
  const [selected, setSelected] = useState<SelectedClient | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["advisor-clients"],
    queryFn: () => listClientHouseholdsForAdvisor(),
  });

  if (error) {
    toast.error(error instanceof Error ? error.message : "Unable to load your client list.");
  }

  const clients = data?.clients ?? [];
  const selectedClient =
    clients.find((c) => c.householdId === selected?.householdId && c.memberId === selected?.memberId) ??
    null;

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="bg-primary px-4 py-5">
        <p className="text-xs font-medium uppercase tracking-wide text-primary-foreground/70">
          FamilyHub SG
        </p>
        <h1 className="text-lg font-bold tracking-tight text-primary-foreground">Adviser View</h1>
      </div>

      <main className="mx-auto max-w-3xl px-4 py-4">
        {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

        {!isLoading && !selectedClient && (
          <>
            <p className="mb-3 text-sm text-muted-foreground">
              {error
                ? "Unable to load your client list right now."
                : clients.length === 0
                  ? "No clients have shared access with you yet."
                  : (() => {
                      const dueCount = clients.filter((c) => c.upcomingCount > 0).length;
                      return dueCount > 0
                        ? `${dueCount} of ${clients.length} client${clients.length === 1 ? "" : "s"} ${dueCount === 1 ? "has" : "have"} something due in the next ${ADVISOR_ALERT_HORIZON_DAYS} days — insurance & investments only.`
                        : `${clients.length} client${clients.length === 1 ? "" : "s"} — nothing due in the next ${ADVISOR_ALERT_HORIZON_DAYS} days (insurance & investments only).`;
                    })()}
            </p>
            <div className="space-y-2">
              {clients.map((c) => (
                <button
                  key={`${c.householdId}:${c.memberId}`}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setSelected({ householdId: c.householdId, memberId: c.memberId });
                  }}
                  className="flex w-full items-center justify-between rounded-2xl border border-border bg-card p-4 text-left"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{c.memberName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.householdName} ·{" "}
                      {[c.canViewInsurance && "Insurance", c.canViewInvestments && "Investments"]
                        .filter(Boolean)
                        .join(", ") || "No categories shared"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {c.upcomingCount > 0 && (
                      <span className="rounded-full bg-urgent/10 px-2 py-1 text-xs font-semibold text-urgent">
                        {c.upcomingCount} due soon
                      </span>
                    )}
                    {c.upcomingCount === 0 && c.staleCount > 0 && (
                      <span className="rounded-full bg-review-soft px-2 py-1 text-[10px] font-medium text-review-foreground">
                        Please verify
                      </span>
                    )}
                    <span className="text-muted-foreground">→</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {selectedClient && (
          <ClientDetail
            householdId={selectedClient.householdId}
            householdName={selectedClient.householdName}
            memberId={selectedClient.memberId}
            memberName={selectedClient.memberName}
            canViewNetworthSummary={selectedClient.canViewNetworthSummary}
            onBack={() => setSelected(null)}
          />
        )}

        <div className="mt-8 space-y-2 border-t border-border/40 pt-4">
          <a
            href="/"
            className="block w-full rounded-lg border border-border px-4 py-2 text-center text-sm font-semibold text-primary"
          >
            ← Back to FamilyHub
          </a>
          <Button type="button" variant="outline" onClick={handleSignOut} className="w-full">
            Sign out
          </Button>
        </div>
      </main>
      <Toaster
        position="bottom-right"
        richColors
        closeButton
        offset={{ bottom: 80 }}
        duration={1000}
      />
    </div>
  );
}

function ClientDetail({
  householdId,
  householdName,
  memberId,
  memberName,
  canViewNetworthSummary,
  onBack,
}: {
  householdId: string;
  householdName: string;
  memberId: string;
  memberName: string;
  canViewNetworthSummary: boolean;
  onBack: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["advisor-client-records", householdId, memberId],
    queryFn: () => getClientRecordsForAdvisor({ data: { householdId, memberId } }),
  });

  // Deliberately a separate query from the records above — on a slow
  // connection, one being slow must never block the other from showing up
  // as soon as it's ready, and a failure here shouldn't blank the records
  // list that loaded fine.
  //
  // Net worth is intentionally still household-level, not member-level —
  // savings/properties/loans feed this number and have their own
  // joint-ownership semantics that per-member scoping doesn't cover yet.
  // Shown once per household regardless of which member card is open.
  const {
    data: networth,
    isLoading: networthLoading,
    error: networthError,
  } = useQuery({
    queryKey: ["advisor-networth", householdId],
    queryFn: () => getAdvisorNetworthSummary({ data: { householdId } }),
    enabled: canViewNetworthSummary,
  });

  const [isDownloading, setIsDownloading] = useState(false);

  async function handleDownloadPdf() {
    setIsDownloading(true);
    try {
      await generateAndDownloadAdvisorPdf({
        householdName,
        memberName,
        generatedAt: new Date(),
        netWorth: canViewNetworthSummary && networth ? networth : null,
        records,
        upcomingPremiums,
        staleAfterDays: STALE_AFTER_DAYS,
        upcomingHorizonDays: ADVISOR_ALERT_HORIZON_DAYS,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to generate the PDF.");
    } finally {
      setIsDownloading(false);
    }
  }

  if (error) {
    toast.error(error instanceof Error ? error.message : "Unable to load this client's records.");
  }
  if (networthError) {
    toast.error(
      networthError instanceof Error ? networthError.message : "Unable to load net worth summary.",
    );
  }

  const records = data?.records ?? [];
  const upcomingPremiums = data?.upcomingPremiums ?? [];
  // Same shared function advisorPdf.ts uses — same order, same subgroups,
  // same subtotals, so this screen and the downloaded PDF can't disagree.
  const categoryGroups = groupAdvisorRecords(records);

  return (
    <div>
      <button
        onPointerDown={(e) => {
          e.preventDefault();
          onBack();
        }}
        className="mb-3 text-sm font-medium text-primary"
      >
        ← All clients
      </button>
      <div className="mb-3 flex items-center justify-between">
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold">{memberName}</h2>
          <p className="truncate text-xs text-muted-foreground">{householdName}</p>
        </div>
        <button
          onPointerDown={(e) => {
            e.preventDefault();
            if (!isLoading && !isDownloading) void handleDownloadPdf();
          }}
          disabled={isLoading || isDownloading}
          className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-primary disabled:opacity-40"
        >
          {isDownloading ? "Generating..." : "Download PDF"}
        </button>
      </div>

      {canViewNetworthSummary && (
        <section className="mb-4 rounded-2xl border border-border bg-card p-4">
          {networthLoading && <p className="text-sm text-muted-foreground">Loading net worth...</p>}
          {!networthLoading && networthError && (
            <p className="text-sm text-muted-foreground">
              Net worth summary unavailable right now.
            </p>
          )}
          {!networthLoading && networth && !networth.hasData && (
            <p className="text-sm text-muted-foreground">No net worth data shared yet.</p>
          )}
          {!networthLoading && networth?.hasData && (
            <>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Household net worth (combined total — not {memberName}'s individually)
              </p>
              <p className="text-2xl font-bold">{fmtMoney(networth.netWorth, "SGD")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {fmtMoney(networth.totalAssets, "SGD")} assets −{" "}
                {fmtMoney(networth.totalLiabilities, "SGD")} liabilities
              </p>
            </>
          )}
        </section>
      )}

      {!isLoading && upcomingPremiums.length > 0 && (
        <section className="mb-4 rounded-2xl border border-urgent/30 bg-urgent/5 p-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-urgent">
            Upcoming Premiums — Next {ADVISOR_ALERT_HORIZON_DAYS} Days
          </h3>
          <div className="space-y-1.5">
            {upcomingPremiums.map((item) => (
              <div key={`${item.recordId}-${item.date}`} className="flex items-center justify-between text-sm">
                <span className={item.overdue ? "font-semibold text-urgent" : "text-foreground"}>
                  {item.label}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{fmtDate(item.date)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {!isLoading && records.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing shared in the categories you have access to yet.
        </p>
      )}

      {categoryGroups.map((catGroup) => (
        <section key={catGroup.category} className="mb-4 rounded-2xl border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-bold">{catGroup.categoryTitle}</h3>
          {catGroup.subgroups.map((sub) => (
            <div key={sub.name} className="mb-3 last:mb-0">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {sub.name}
              </p>
              <div className="space-y-2">
                {sub.items.map((r) => {
                  const primaryAmount =
                    catGroup.category === "investments" ? r.sum_assured : (r.premium ?? r.sum_assured);
                  const primaryLabel =
                    catGroup.category === "investments"
                      ? "Current value"
                      : r.premium != null
                        ? "Premium"
                        : "Sum assured";
                  const isStale =
                    !!r.last_updated &&
                    Date.now() - new Date(r.last_updated).getTime() >
                      STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
                  return (
                    <div key={r.record_id} className="rounded-lg bg-background/50 px-3 py-2 text-sm">
                      <div className="flex items-center justify-between">
                        <p className="font-medium">{r.record_name}</p>
                        <div className="text-right">
                          <p className="font-semibold">{fmtMoney(primaryAmount, r.currency)}</p>
                          <p className="text-[10px] text-muted-foreground">{primaryLabel}</p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {[
                          // Scoped to one member already — showing their own
                          // name on every line was redundant. Unassigned is
                          // the one case worth flagging, since it's the only
                          // one NOT implied by being on this page.
                          r.member_id == null ? "Unassigned" : null,
                          r.end_date && `Ends ${fmtDate(r.end_date)}`,
                          r.is_giro && "GIRO",
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </p>
                      <p
                        className={`mt-1 text-[10px] ${isStale ? "font-medium text-review-foreground" : "text-muted-foreground"}`}
                      >
                        Shared by client · updated {fmtDate(r.last_updated)}
                        {isStale ? " · please confirm this is still accurate" : ""}
                      </p>
                    </div>
                  );
                })}
              </div>
              {sub.subtotals.length > 0 && (
                <div className="mt-1.5 space-y-0.5 text-right text-xs font-semibold text-muted-foreground">
                  {sub.subtotals.map((st) => (
                    <p key={st.currency}>
                      {catGroup.category === "investments" ? "Total value" : "Total sum assured"}:{" "}
                      {fmtMoney(st.amount, st.currency)}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
