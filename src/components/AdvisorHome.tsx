import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Toaster, toast } from "sonner";
import {
  listClientHouseholdsForAdvisor,
  getClientRecordsForAdvisor,
  getAdvisorNetworthSummary,
  upsertAdvisorNote,
  deleteAdvisorNote,
  upsertAdvisorRecordStatus,
  STALE_AFTER_DAYS,
  ADVISOR_ALERT_HORIZON_DAYS,
} from "@/lib/advisorAccess";
import {
  PolicyChartToggle,
  PolicyChartCompareSection,
  usePolicyCharts,
} from "@/components/PolicyChart";
import {
  generateAndDownloadAdvisorPdf,
  groupAdvisorRecords,
  formatAdvisorAmount,
  NET_WORTH_CATEGORY_ORDER,
  NET_WORTH_CATEGORY_LABELS,
  NET_WORTH_CATEGORY_COLORS,
  CATEGORY_ORDER,
  CATEGORY_TITLES,
  CATEGORY_COLUMN_LABEL,
  CATEGORY_TOTAL_LABEL,
} from "@/lib/advisorPdf";
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
    clients.find(
      (c) => c.householdId === selected?.householdId && c.memberId === selected?.memberId,
    ) ?? null;

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
                      {[
                        c.canViewInsurance && "Insurance",
                        c.canViewInvestments && "Investments",
                        c.canViewProperty && "Property",
                        c.canViewLoans && "Loans",
                      ]
                        .filter(Boolean)
                        .join(", ") || "No categories shared"}
                    </p>
                    {c.hiddenCount > 0 && (
                      <p className="truncate text-[10px] text-muted-foreground">
                        + {c.hiddenCount} item{c.hiddenCount === 1 ? "" : "s"} not shared
                      </p>
                    )}
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

// One FA-authored note per record — "what do you recommend for this item."
// Read-modify-write is entirely client-driven (open -> edit -> Save/Cancel)
// rather than autosave, so a half-typed thought never silently becomes the
// visible recommendation a client reads.
function RecordNote({
  record,
  householdId,
  memberId,
}: {
  record: any;
  householdId: string;
  memberId: string;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(record.note ?? "");

  const saveMutation = useMutation({
    mutationFn: () =>
      upsertAdvisorNote({
        data: {
          householdId,
          memberId,
          recordCategory: record.category,
          recordId: record.record_id,
          note: draft.trim(),
        },
      }),
    onSuccess: () => {
      setEditing(false);
      void queryClient.invalidateQueries({
        queryKey: ["advisor-client-records", householdId, memberId],
      });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Unable to save note.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteAdvisorNote({ data: { noteId: record.noteId } }),
    onSuccess: () => {
      setDraft("");
      void queryClient.invalidateQueries({
        queryKey: ["advisor-client-records", householdId, memberId],
      });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Unable to remove note.");
    },
  });

  if (editing) {
    return (
      <div className="mt-2 space-y-1.5">
        <textarea
          className="w-full rounded-lg border border-input bg-background p-2 text-xs"
          rows={2}
          maxLength={2000}
          placeholder="What do you recommend for this item?"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground disabled:opacity-50"
            disabled={saveMutation.isPending || draft.trim().length === 0}
            onPointerDown={(e) => {
              e.preventDefault();
              saveMutation.mutate();
            }}
          >
            {saveMutation.isPending ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
            onPointerDown={(e) => {
              e.preventDefault();
              setDraft(record.note ?? "");
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (record.note) {
    return (
      <div className="mt-2 rounded-lg border border-primary/15 bg-primary/5 p-2">
        <p className="text-[9px] font-bold uppercase tracking-wide text-primary/70">Your note</p>
        <p className="whitespace-pre-wrap text-xs text-foreground">{record.note}</p>
        <div className="mt-1 flex gap-3">
          <button
            type="button"
            className="text-[10px] font-medium text-primary"
            onPointerDown={(e) => {
              e.preventDefault();
              setDraft(record.note ?? "");
              setEditing(true);
            }}
          >
            Edit
          </button>
          <button
            type="button"
            className="text-[10px] font-medium text-muted-foreground disabled:opacity-50"
            disabled={deleteMutation.isPending}
            onPointerDown={(e) => {
              e.preventDefault();
              deleteMutation.mutate();
            }}
          >
            {deleteMutation.isPending ? "Removing..." : "Remove"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="mt-2 text-[10px] font-medium text-primary"
      onPointerDown={(e) => {
        e.preventDefault();
        setEditing(true);
      }}
    >
      + Add note
    </button>
  );
}

// Copies the household RecordCard's actual status pattern exactly (same
// component name "StatusToggle" as household's — deliberately renamed here
// to AdvisorStatusToggle to avoid two same-named-but-different components
// in the codebase), not just its colors: a single pill button that opens a
// dropdown of all 3 states (matching StatusToggle.tsx's dropdown, not the
// earlier 3-buttons-in-a-row version this replaces), using the SAME
// status-urgent/status-review/status-settled CSS classes and the same
// urgent-tint/review-tint/settled-tint whole-card backgrounds — mapped
// paid=settled(green), ongoing=review(amber), review=urgent(red). Paid/
// Ongoing are computed from end_date and need no FA action; Review only
// ever comes from the FA explicitly picking it (see
// upsertAdvisorRecordStatus's comment) — there's no signal in the data
// alone that a client has quietly stopped paying.
const STATUS_CONFIG: Record<
  "paid" | "ongoing" | "review",
  { label: string; cls: string; dot: string; tint: string }
> = {
  paid: {
    label: "Paid",
    cls: "status-settled",
    dot: "\ud83d\udfe2",
    tint: "bg-settled-tint border-settled-border",
  },
  ongoing: {
    label: "Ongoing",
    cls: "status-review",
    dot: "\ud83d\udfe1",
    tint: "bg-review-tint border-review-border",
  },
  review: {
    label: "Review",
    cls: "status-urgent",
    dot: "\ud83d\udd34",
    tint: "bg-urgent-tint border-urgent-border",
  },
};

// Exported so ClientDetail can tint the whole record card by the same
// rule the toggle itself uses, without duplicating the color mapping.
export function advisorStatusTint(status: "paid" | "ongoing" | "review"): string {
  return STATUS_CONFIG[status].tint;
}

function AdvisorStatusToggle({
  record,
  householdId,
  memberId,
  category,
  effectiveStatus,
}: {
  record: any;
  householdId: string;
  memberId: string;
  category: string;
  effectiveStatus: "paid" | "ongoing" | "review";
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const c = STATUS_CONFIG[effectiveStatus];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const mutation = useMutation({
    mutationFn: (status: "paid" | "ongoing" | "review") =>
      upsertAdvisorRecordStatus({
        data: {
          householdId,
          memberId,
          recordCategory: category,
          recordId: record.record_id,
          status,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["advisor-client-records", householdId, memberId],
      });
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Unable to update status."),
  });

  return (
    <div ref={ref} className="relative mt-1.5 inline-block border-t border-border/40 pt-1.5">
      <button
        type="button"
        disabled={mutation.isPending}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${c.cls}`}
      >
        <span className="text-[8px]">{c.dot}</span>
        {c.label}
        <ChevronDown className="h-3 w-3 opacity-70" />
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-full z-20 mt-1 w-32 overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
        >
          {(["paid", "ongoing", "review"] as const).map((s) => {
            const cc = STATUS_CONFIG[s];
            return (
              <button
                key={s}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  if (s !== effectiveStatus) mutation.mutate(s);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold hover:bg-accent ${
                  s === effectiveStatus ? "bg-accent/60" : ""
                }`}
              >
                <span>{cc.dot}</span>
                <span>{cc.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Same category order/colors as the PDF donut (advisorPdf.ts) — imported,
// not re-declared, so a category is never a different color on screen than
// in the exported PDF for the same household.
function NetWorthDonut({
  breakdown,
  totalAssets,
  totalLiabilities,
  netWorth,
}: {
  breakdown: Record<string, number> | undefined;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}) {
  const slices = (NET_WORTH_CATEGORY_ORDER as readonly string[])
    .map((key) => ({ key, value: breakdown?.[key] ?? 0 }))
    .filter((s) => s.value > 0);

  const size = 140;
  const strokeWidth = 24;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let cumulative = 0;

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            className="stroke-border"
          />
          {totalAssets > 0 &&
            slices.map((s) => {
              const fraction = s.value / totalAssets;
              const dash = fraction * circumference;
              const offset = cumulative * circumference;
              cumulative += fraction;
              const [r, g, b] = NET_WORTH_CATEGORY_COLORS[s.key] ?? [0.5, 0.5, 0.5];
              return (
                <circle
                  key={s.key}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={`rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`}
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                />
              );
            })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center px-2 text-center">
          <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
            Net Worth
          </p>
          <p className="text-sm font-bold leading-tight">{fmtMoney(netWorth, "SGD")}</p>
        </div>
      </div>
      <div className="min-w-[160px] flex-1 space-y-1">
        {slices.map((s) => {
          const [r, g, b] = NET_WORTH_CATEGORY_COLORS[s.key] ?? [0.5, 0.5, 0.5];
          const pct = totalAssets > 0 ? Math.round((s.value / totalAssets) * 100) : 0;
          return (
            <div key={s.key} className="flex items-center gap-1.5 text-xs">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`,
                }}
              />
              <span className="truncate text-muted-foreground">
                {NET_WORTH_CATEGORY_LABELS[s.key] ?? s.key}
              </span>
              <span className="ml-auto shrink-0 font-medium text-foreground">{pct}%</span>
            </div>
          );
        })}
        {totalAssets > 0 && (
          <p className="pt-1 text-xs font-semibold text-primary">
            Total Assets: {fmtMoney(totalAssets, "SGD")}
          </p>
        )}
        {totalLiabilities > 0 && (
          <p className="text-xs font-semibold text-urgent">
            Liabilities: {fmtMoney(totalLiabilities, "SGD")}
          </p>
        )}
      </div>
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

  const { charts, displayedIds, setDisplayedIds } = usePolicyCharts(householdId, memberId);

  // Deliberately a separate query from the records above — on a slow
  // connection, one being slow must never block the other from showing up
  // as soon as it's ready, and a failure here shouldn't blank the records
  // list that loaded fine.
  //
  // Now member-scoped, both in RLS (advisor_networth_select on all six
  // contributing tables switched to the 3-arg has_advisor_access) and here
  // — five of six categories are single-owner (verified in recordConfigs.ts,
  // not assumed), and the one exception, savings, gets the exact same
  // plain member_id equality the household's own scopeByMember() uses, not
  // special joint-ownership handling.
  const {
    data: networth,
    isLoading: networthLoading,
    error: networthError,
  } = useQuery({
    queryKey: ["advisor-networth", householdId, memberId],
    queryFn: () => getAdvisorNetworthSummary({ data: { householdId, memberId } }),
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
        hiddenCounts,
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
  const hiddenCounts = data?.hiddenCounts ?? {
    insurance: 0,
    investments: 0,
    property: 0,
    loans: 0,
  };
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
            <p className="text-sm text-muted-foreground">
              No net worth data shared for this household yet.
            </p>
          )}
          {!networthLoading && networth?.hasData && (
            <>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {networth.scope === "member"
                  ? `${memberName}'s net worth`
                  : `Household net worth (combined — nothing yet attributed to ${memberName} individually)`}
              </p>
              <NetWorthDonut
                breakdown={networth.breakdown}
                totalAssets={networth.totalAssets}
                totalLiabilities={networth.totalLiabilities}
                netWorth={networth.netWorth}
              />
            </>
          )}
        </section>
      )}

      {!isLoading && upcomingPremiums.length > 0 && (
        <section className="mb-4 rounded-2xl border border-l-4 border-border border-l-urgent bg-card p-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Upcoming Premiums — Next {ADVISOR_ALERT_HORIZON_DAYS} Days
          </h3>
          <div className="space-y-1.5">
            {upcomingPremiums.map((item) => (
              <div
                key={`${item.recordId}-${item.date}`}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {item.overdue && (
                    <span className="shrink-0 rounded-full bg-urgent/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-urgent">
                      Overdue
                    </span>
                  )}
                  <span
                    className={`truncate ${item.overdue ? "font-medium text-urgent" : "text-foreground"}`}
                  >
                    {item.label}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {item.amount != null && (
                    <span
                      className={`text-xs font-semibold ${item.overdue ? "text-urgent" : "text-foreground"}`}
                    >
                      {fmtMoney(item.amount, item.currency)}
                    </span>
                  )}
                  <span
                    className={`text-xs ${item.overdue ? "text-urgent" : "text-muted-foreground"}`}
                  >
                    {fmtDate(item.date)}
                  </span>
                </span>
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

      <PolicyChartCompareSection
        charts={charts}
        displayedIds={displayedIds}
        setDisplayedIds={setDisplayedIds}
      />

      {categoryGroups.map((catGroup) => (
        <section
          key={catGroup.category}
          className="mb-4 rounded-2xl border border-border bg-card p-4"
        >
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-sm font-bold">{catGroup.categoryTitle}</h3>
            {hiddenCounts[catGroup.category as keyof typeof hiddenCounts] > 0 && (
              <p className="text-[10px] text-muted-foreground">
                + {hiddenCounts[catGroup.category as keyof typeof hiddenCounts]} not shared
              </p>
            )}
          </div>
          {catGroup.subgroups.map((sub) => (
            <div key={sub.name} className="mb-3 last:mb-0">
              <div className="mb-1.5 flex items-center justify-between px-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {sub.name}
                </p>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {CATEGORY_COLUMN_LABEL[catGroup.category] ?? "Premium"}
                </p>
              </div>
              <div className="space-y-2">
                {sub.items.map((r) => {
                  const isStale =
                    !!r.last_updated &&
                    Date.now() - new Date(r.last_updated).getTime() >
                      STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
                  // "Paid"/"Ongoing" auto-computed from end_date — no
                  // manual work needed for the common case where the
                  // client is simply paying as scheduled. "Review" only
                  // ever comes from an explicit FA override (there's no
                  // signal in the data alone that a client has silently
                  // stopped paying) — see the migration's comment on why
                  // this is never itself computed.
                  const computedStatus: "paid" | "ongoing" =
                    r.end_date && new Date(r.end_date).getTime() < Date.now() ? "paid" : "ongoing";
                  const effectiveStatus: "paid" | "ongoing" | "review" =
                    (r as any).status ?? computedStatus;
                  return (
                    <div
                      key={r.record_id}
                      className={`rounded-lg border px-3 py-2 text-sm transition ${advisorStatusTint(effectiveStatus)}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="min-w-0 flex-1 truncate font-medium">{r.record_name}</p>
                        <p className="shrink-0 font-semibold">{formatAdvisorAmount(r)}</p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {[
                          // Scoped to one member already — showing their own
                          // name on every line was redundant. Unassigned is
                          // the one case worth flagging, since it's the only
                          // one NOT implied by being on this page.
                          r.member_id == null ? "Unassigned" : null,
                          // Replaces the old inline "(sum assured)" text
                          // that used to clutter the amount itself — same
                          // fix as the PDF.
                          catGroup.category === "insurance" && r.premium == null
                            ? "Sum assured only"
                            : null,
                          r.end_date && `Ends ${fmtDate(r.end_date)}`,
                          r.is_giro && "GIRO",
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </p>
                      <AdvisorStatusToggle
                        record={r}
                        householdId={householdId}
                        memberId={memberId}
                        category={r.category}
                        effectiveStatus={effectiveStatus}
                      />
                      <RecordNote record={r} householdId={householdId} memberId={memberId} />
                      {(catGroup.category === "insurance" ||
                        // ILP/Endowment investments get the same chart —
                        // they're the same premium/payout phase shape as
                        // insurance, just filed under investments'
                        // group_name. Same two group_name values alerts.ts
                        // already checks for "is this ILP-like" — reused
                        // here rather than re-deciding the list.
                        (catGroup.category === "investments" &&
                          (r.insurance_category === "ILP (Investment-Linked Policy)" ||
                            r.insurance_category === "Endowment"))) && (
                        <PolicyChartToggle
                          recordId={(r as any).record_id}
                          recordCategory={catGroup.category as "insurance" | "investments"}
                          householdId={householdId}
                          memberId={memberId}
                          charts={charts}
                          displayedIds={displayedIds}
                          setDisplayedIds={setDisplayedIds}
                        />
                      )}
                      <div className="mt-1.5 flex justify-end">
                        <p
                          className={`text-[10px] ${isStale ? "font-medium text-review-foreground" : "text-muted-foreground"}`}
                        >
                          Updated {fmtDate(r.last_updated)}
                          {isStale ? " · please confirm this is still accurate" : ""}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
              {sub.subtotals.length > 0 && (
                <div
                  className={`mt-1.5 space-y-0.5 text-right text-xs font-semibold ${
                    catGroup.category === "loans" ? "text-urgent" : "text-muted-foreground"
                  }`}
                >
                  {sub.subtotals.map((st) => (
                    <p key={st.currency}>
                      {CATEGORY_TOTAL_LABEL[catGroup.category] ?? "Total"}:{" "}
                      {fmtMoney(st.amount, st.currency)}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      ))}

      {/* Covers the edge case where every item in a category is hidden —
          categoryGroups only includes categories with at least one VISIBLE
          record, so without this, a fully-hidden category would show
          nothing at all, indistinguishable from "no data exists" rather
          than "data exists but isn't shared." */}
      {CATEGORY_ORDER.filter(
        (cat) => !categoryGroups.some((g) => g.category === cat) && hiddenCounts[cat] > 0,
      ).map((cat) => (
        <section key={cat} className="mb-4 rounded-2xl border border-border bg-card p-4">
          <h3 className="text-sm font-bold">{CATEGORY_TITLES[cat] ?? cat}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {hiddenCounts[cat]} item{hiddenCounts[cat] === 1 ? "" : "s"} not shared
          </p>
        </section>
      ))}
    </div>
  );
}
