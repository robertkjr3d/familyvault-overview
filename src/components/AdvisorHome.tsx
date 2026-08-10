import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Toaster, toast } from "sonner";
import {
  listClientHouseholdsForAdvisor,
  getClientRecordsForAdvisor,
  getAdvisorNetworthSummary,
  STALE_AFTER_DAYS,
} from "@/lib/advisorAccess";
import { generateAndDownloadAdvisorPdf } from "@/lib/advisorPdf";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { fmtMoney, fmtDate } from "@/lib/format";

async function handleSignOut() {
  await supabase.auth.signOut();
}

const CATEGORY_TITLES: Record<string, string> = {
  insurance: "Insurance",
  investments: "Investments",
};

export function AdvisorHome() {
  const [selectedHouseholdId, setSelectedHouseholdId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["advisor-clients"],
    queryFn: () => listClientHouseholdsForAdvisor(),
  });

  if (error) {
    toast.error(error instanceof Error ? error.message : "Unable to load your client list.");
  }

  const clients = data?.clients ?? [];
  const selectedClient = clients.find((c) => c.householdId === selectedHouseholdId) ?? null;

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
                        ? `${dueCount} of ${clients.length} client${clients.length === 1 ? "" : "s"} ${dueCount === 1 ? "has" : "have"} something due soon.`
                        : `${clients.length} client${clients.length === 1 ? "" : "s"} — nothing due in the next ${30} days.`;
                    })()}
            </p>
            <div className="space-y-2">
              {clients.map((c) => (
                <button
                  key={c.householdId}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setSelectedHouseholdId(c.householdId);
                  }}
                  className="flex w-full items-center justify-between rounded-2xl border border-border bg-card p-4 text-left"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{c.householdName}</p>
                    <p className="truncate text-xs text-muted-foreground">
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
            canViewNetworthSummary={selectedClient.canViewNetworthSummary}
            onBack={() => setSelectedHouseholdId(null)}
          />
        )}

        <div className="mt-8 border-t border-border/40 pt-4">
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
  canViewNetworthSummary,
  onBack,
}: {
  householdId: string;
  householdName: string;
  canViewNetworthSummary: boolean;
  onBack: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["advisor-client-records", householdId],
    queryFn: () => getClientRecordsForAdvisor({ data: { householdId } }),
  });

  // Deliberately a separate query from the records above — on a slow
  // connection, one being slow must never block the other from showing up
  // as soon as it's ready, and a failure here shouldn't blank the records
  // list that loaded fine.
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
        generatedAt: new Date(),
        netWorth: canViewNetworthSummary && networth ? networth : null,
        records,
        staleAfterDays: STALE_AFTER_DAYS,
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
  const byCategory = records.reduce<Record<string, typeof records>>((acc, r) => {
    (acc[r.category] ??= []).push(r);
    return acc;
  }, {});

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
        <h2 className="text-base font-bold">{householdName}</h2>
        <button
          onPointerDown={(e) => {
            e.preventDefault();
            if (!isLoading && !isDownloading) void handleDownloadPdf();
          }}
          disabled={isLoading || isDownloading}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-primary disabled:opacity-40"
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
                Net worth (combined total)
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

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {!isLoading && records.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing shared in the categories you have access to yet.
        </p>
      )}

      {Object.entries(byCategory).map(([category, items]) => (
        <section key={category} className="mb-4 rounded-2xl border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-bold">{CATEGORY_TITLES[category] ?? category}</h3>
          <div className="space-y-2">
            {items.map((r) => {
              const primaryAmount =
                category === "investments" ? r.sum_assured : (r.premium ?? r.sum_assured);
              const primaryLabel =
                category === "investments"
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
                    <div>
                      <p className="font-medium">{r.record_name}</p>
                      {r.insurance_category && (
                        <p className="text-[10px] text-muted-foreground">{r.insurance_category}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{fmtMoney(primaryAmount, r.currency)}</p>
                      <p className="text-[10px] text-muted-foreground">{primaryLabel}</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {[
                      r.member_name,
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
        </section>
      ))}
    </div>
  );
}
