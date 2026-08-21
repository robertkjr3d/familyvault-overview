import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  getAdvisorPolicyChart,
  upsertAdvisorPolicyChart,
  deleteAdvisorPolicyChart,
  listAdvisorPolicyCharts,
} from "@/lib/advisorAccess";
import {
  expandPhasesToYearlyBars,
  buildDefaultPhases,
  type ChartPhase,
  type ChartPhaseDirection,
  type ChartPhaseFrequency,
} from "@/lib/policyChartMath";
import { fmtMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type AdvisorPolicyChartSummary = {
  id: string;
  title: string | null;
  phases: ChartPhase[];
  recordId: string;
  recordCategory: "insurance" | "investments";
  policyName: string;
  currency: string | null;
  updatedAt: string;
};

// Each policy in the compare view gets a {dark, light} pair from the same
// hue — dark for "pay in", light for "pay out" — rather than one color at
// two opacities. Opacity-only differentiation (the first version of this)
// read as "the same color" on at least one real screen/browser, per
// direct user feedback — distinct lightness values are unambiguous even
// on a washed-out display, which opacity alone isn't.
const CHART_COLOR_PAIRS: { dark: string; light: string }[] = [
  { dark: "#1d4ed8", light: "#93c5fd" }, // blue
  { dark: "#b91c1c", light: "#fca5a5" }, // red
  { dark: "#15803d", light: "#86efac" }, // green
  { dark: "#b45309", light: "#fcd34d" }, // amber
  { dark: "#6d28d9", light: "#c4b5fd" }, // purple
  { dark: "#0e7490", light: "#67e8f9" }, // cyan
  { dark: "#be185d", light: "#f9a8d4" }, // pink
  { dark: "#4d7c0f", light: "#bef264" }, // lime
];

// Abbreviates large axis values (70000 -> "70k", 1250000 -> "1.25M") so the
// y-axis never gets clipped for realistic premium/payout figures — the
// bug this fixes was a 6-digit premium showing as "0000" because the
// axis column wasn't wide enough for the full unabbreviated number.
function tickAbbrev(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(abs % 1_000_000 === 0 ? 0 : 2)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(abs % 1_000 === 0 ? 0 : 1)}k`;
  return String(v);
}

function newPhaseId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `p${Date.now()}${Math.random()}`;
}

// A phase with an age outside 0-120 (almost always a bad upstream date
// feeding buildDefaultPhases, not something the FA typed on purpose) gets
// a plain-English message here instead of the raw zod validation array —
// buildDefaultPhases already clamps its own output, so this only fires
// for a phase the FA edited by hand into an out-of-range value.
function validatePhases(phases: ChartPhase[]): string | null {
  for (const p of phases) {
    if (p.startAge < 0 || p.startAge > 120 || p.endAge < 0 || p.endAge > 120) {
      return `"${p.label}" has an age outside 0-120 - check the start/end age.`;
    }
    if (p.endAge < p.startAge && p.frequency !== "lump-sum") {
      return `"${p.label}"'s end age is before its start age.`;
    }
  }
  return null;
}

// Shared by both AdvisorHome.tsx (for the per-record "(1) Displayed"
// label) and PolicyChartCompareSection — one query, one place that knows
// which charts exist for this client and which are currently toggled on
// in the compare view. "Displayed" is deliberately local-only state (not
// persisted) — it resets on page reload, same as the pre-existing
// compare-view toggle behavior before this change.
export function usePolicyCharts(householdId: string, memberId: string) {
  const { data: charts } = useQuery({
    queryKey: ["advisor-policy-charts", householdId, memberId],
    queryFn: () => listAdvisorPolicyCharts({ data: { householdId, memberId } }),
  });
  const [displayedIds, setDisplayedIds] = useState<Set<string>>(new Set());
  return {
    charts: charts as AdvisorPolicyChartSummary[] | undefined,
    displayedIds,
    setDisplayedIds,
  };
}

// ============================================================
// Per-record phase editor — a "Policy chart" toggle button + inline panel,
// same interaction shape as RecordNote in AdvisorHome.tsx.
// ============================================================
export function PolicyChartToggle({
  recordId,
  recordCategory,
  householdId,
  memberId,
  charts,
  displayedIds,
  setDisplayedIds,
}: {
  recordId: string;
  recordCategory: "insurance" | "investments";
  householdId: string;
  memberId: string;
  charts: AdvisorPolicyChartSummary[] | undefined;
  displayedIds: Set<string>;
  setDisplayedIds: (updater: (prev: Set<string>) => Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const existing = charts?.find((c) => c.recordId === recordId);
  const isDisplayed = existing ? displayedIds.has(existing.id) : false;

  let label = "Policy chart";
  if (!open && existing) label = `Policy chart (1)${isDisplayed ? " \u00b7 Displayed" : ""}`;
  else if (open) label = "Hide chart";

  return (
    <div className="mt-2">
      <button
        type="button"
        className="text-[10px] font-medium text-primary"
        onPointerDown={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
      >
        {label}
      </button>
      {open && (
        <PolicyChartEditor
          recordId={recordId}
          recordCategory={recordCategory}
          householdId={householdId}
          memberId={memberId}
          setDisplayedIds={setDisplayedIds}
        />
      )}
    </div>
  );
}

function PolicyChartEditor({
  recordId,
  recordCategory,
  householdId,
  memberId,
  setDisplayedIds,
}: {
  recordId: string;
  recordCategory: "insurance" | "investments";
  householdId: string;
  memberId: string;
  setDisplayedIds: (updater: (prev: Set<string>) => Set<string>) => void;
}) {
  const queryClient = useQueryClient();
  const [phases, setPhases] = useState<ChartPhase[] | null>(null); // null until seeded from the query below
  const [title, setTitle] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["advisor-policy-chart", householdId, memberId, recordId],
    queryFn: () =>
      getAdvisorPolicyChart({ data: { householdId, memberId, recordCategory, recordId } }),
  });

  // Seed local editable state exactly once when the query resolves — from
  // the saved chart if one exists, otherwise from buildDefaultPhases. Not
  // a useEffect: this file's other components avoid them elsewhere for
  // sync-on-every-render (RecordNote does the same pattern with useState
  // initializers), so this mirrors that instead of introducing a new
  // pattern for one component.
  if (phases === null && data) {
    const saved = data.chart;
    if (saved) {
      setPhases(saved.phases as ChartPhase[]);
      setTitle(saved.title ?? "");
    } else {
      setPhases(
        buildDefaultPhases(
          data.policy as Parameters<typeof buildDefaultPhases>[0],
          data.memberBirthYear,
        ),
      );
    }
    // Falls through to render with phases still null on THIS render pass;
    // the setState above triggers a re-render where phases is populated.
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      upsertAdvisorPolicyChart({
        data: {
          householdId,
          memberId,
          recordId,
          recordCategory,
          title: title.trim() || undefined,
          phases: phases ?? [],
        },
      }),
    onSuccess: (result) => {
      toast.success("Chart saved and displayed");
      // Saving a chart also shows it in the compare view immediately —
      // an FA who just built a chart wants to show it right away, not
      // hunt for a second toggle elsewhere on the page.
      setDisplayedIds((prev) => new Set(prev).add(result.chartId));
      void queryClient.invalidateQueries({
        queryKey: ["advisor-policy-chart", householdId, memberId, recordId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["advisor-policy-charts", householdId, memberId],
      });
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Unable to save chart."),
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!data?.chart) throw new Error("Nothing to delete yet.");
      return deleteAdvisorPolicyChart({ data: { chartId: data.chart.id } });
    },
    onSuccess: () => {
      toast.success("Chart removed");
      if (data?.chart) {
        const removedId = data.chart.id;
        setDisplayedIds((prev) => {
          const next = new Set(prev);
          next.delete(removedId);
          return next;
        });
      }
      void queryClient.invalidateQueries({
        queryKey: ["advisor-policy-chart", householdId, memberId, recordId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["advisor-policy-charts", householdId, memberId],
      });
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Unable to remove chart."),
  });

  const bars = useMemo(() => expandPhasesToYearlyBars(phases ?? []), [phases]);

  if (isLoading || phases === null) {
    return <p className="mt-2 text-xs text-muted-foreground">Loading...</p>;
  }

  function updatePhase(id: string, patch: Partial<ChartPhase>) {
    setPhases((prev) => (prev ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function removePhase(id: string) {
    setPhases((prev) => (prev ?? []).filter((p) => p.id !== id));
  }
  function addPhase() {
    setPhases((prev) => [
      ...(prev ?? []),
      {
        id: newPhaseId(),
        label: "New phase",
        direction: "in",
        startAge: 30,
        endAge: 30,
        amount: 0,
        frequency: "annual",
      },
    ]);
  }
  function handleSave() {
    const problem = validatePhases(phases ?? []);
    if (problem) {
      toast.error(problem);
      return;
    }
    saveMutation.mutate();
  }

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-dashed border-border/60 p-3">
      {data?.memberBirthYear == null && (
        <p className="rounded-md bg-review/10 p-2 text-[10px] text-review-foreground">
          This member has no birth year on file, so ages below aren't tied to a real calendar year
          yet - the chart still works, just treat the numbers as relative years, not confirmed ages.
        </p>
      )}

      {bars.length > 0 && (
        <div>
          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bars} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="age" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={44} tickFormatter={tickAbbrev} />
                <Tooltip
                  formatter={(v: number) => fmtMoney(v, undefined)}
                  labelFormatter={(age) => `Age ${age}`}
                />
                <Legend verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="in" name="Pay in" fill="#b91c1c" />
                <Bar dataKey="out" name="Pay out" fill="#15803d" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-center text-[9px] text-muted-foreground">Age</p>
        </div>
      )}

      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Chart title (optional, e.g. 'Retirement plan')"
        className="h-7 text-xs"
      />

      <div className="space-y-2">
        {(phases ?? []).map((p) => (
          <PhaseRow
            key={p.id}
            phase={p}
            onChange={(patch) => updatePhase(p.id, patch)}
            onRemove={() => removePhase(p.id)}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={addPhase}
        >
          + Add phase
        </Button>
        <div className="flex gap-2">
          {data?.chart && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              Remove chart
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            className="h-7 px-3 text-xs"
            disabled={saveMutation.isPending || (phases ?? []).length === 0}
            onClick={handleSave}
          >
            {saveMutation.isPending ? "Saving..." : "Save & display chart"}
          </Button>
        </div>
      </div>
    </div>
  );
}

const DIRECTIONS: { value: ChartPhaseDirection; label: string }[] = [
  { value: "in", label: "Pay in" },
  { value: "out", label: "Pay out" },
];
const FREQUENCIES: { value: ChartPhaseFrequency; label: string }[] = [
  { value: "annual", label: "Per year" },
  { value: "monthly", label: "Per month" },
  { value: "lump-sum", label: "One-time" },
];

// A plain integer text field (0-120) - deliberately NOT type="number".
// Native number-input spin arrows overlap the field's own text on narrow
// widths and clip the second digit of a 2-3 digit age, confirmed on a
// real browser - text + inputMode sidesteps that entirely and matches
// the numeric-input pattern insurance.tsx's UpdateSurrenderValueInline
// already uses elsewhere in this app.
function AgeField({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <Input
      type="text"
      inputMode="numeric"
      value={value}
      disabled={disabled}
      onChange={(e) =>
        onChange(Math.max(0, Math.min(120, Number(e.target.value.replace(/[^0-9]/g, "")) || 0)))
      }
      className="h-6 w-12 text-center text-[11px]"
    />
  );
}

function PhaseRow({
  phase,
  onChange,
  onRemove,
}: {
  phase: ChartPhase;
  onChange: (patch: Partial<ChartPhase>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-md bg-background/60 p-2">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Input
          value={phase.label}
          onChange={(e) => onChange({ label: e.target.value })}
          className="h-6 flex-1 text-[11px]"
          placeholder="Label"
        />
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 px-1 text-xs text-muted-foreground"
          aria-label="Remove phase"
        >
          x
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <select
          value={phase.direction}
          onChange={(e) => onChange({ direction: e.target.value as ChartPhaseDirection })}
          className="h-6 shrink-0 rounded border border-input bg-background px-1"
        >
          {DIRECTIONS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
        <span className="shrink-0 text-muted-foreground">age</span>
        <AgeField value={phase.startAge} onChange={(startAge) => onChange({ startAge })} />
        <span className="shrink-0 text-muted-foreground">to</span>
        <AgeField
          value={phase.endAge}
          onChange={(endAge) => onChange({ endAge })}
          disabled={phase.frequency === "lump-sum"}
        />
        <Input
          type="text"
          inputMode="decimal"
          value={phase.amount}
          onChange={(e) =>
            onChange({ amount: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 })
          }
          className="h-6 w-24 text-[11px]"
          placeholder="Amount"
        />
        <select
          value={phase.frequency}
          onChange={(e) => {
            const frequency = e.target.value as ChartPhaseFrequency;
            onChange(
              frequency === "lump-sum" ? { frequency, endAge: phase.startAge } : { frequency },
            );
          }}
          className="h-6 shrink-0 rounded border border-input bg-background px-1"
        >
          {FREQUENCIES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ============================================================
// Compare view - every saved chart for this client, toggleable, one
// {dark, light} color pair per policy. Renders nothing when the advisor
// hasn't saved any chart yet for this client.
// ============================================================
export function PolicyChartCompareSection({
  charts,
  displayedIds,
  setDisplayedIds,
}: {
  charts: AdvisorPolicyChartSummary[] | undefined;
  displayedIds: Set<string>;
  setDisplayedIds: (updater: (prev: Set<string>) => Set<string>) => void;
}) {
  if (!charts || charts.length === 0) return null;

  function toggle(id: string) {
    setDisplayedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const activeCharts = charts.filter((c) => displayedIds.has(c.id));
  const colorByChartId = new Map(
    charts.map((c, i) => [c.id, CHART_COLOR_PAIRS[i % CHART_COLOR_PAIRS.length]]),
  );

  // Merge each active chart's expanded bars into one age-indexed dataset,
  // with a dedicated {chartId}_in / {chartId}_out pair of series per
  // chart so each policy gets its own bars rather than being summed
  // together (summing would defeat the point of a compare view).
  const ageSet = new Set<number>();
  const expandedByChart = new Map<string, Map<number, { in: number; out: number }>>();
  for (const c of activeCharts) {
    const bars = expandPhasesToYearlyBars(c.phases);
    const byAge = new Map(bars.map((b) => [b.age, { in: b.in, out: b.out }]));
    expandedByChart.set(c.id, byAge);
    for (const b of bars) ageSet.add(b.age);
  }
  const ages = [...ageSet].sort((a, b) => a - b);
  const merged = ages.map((age) => {
    const row: Record<string, number> = { age };
    for (const c of activeCharts) {
      const v = expandedByChart.get(c.id)?.get(age);
      row[`${c.id}_in`] = v?.in ?? 0;
      row[`${c.id}_out`] = v?.out ?? 0;
    }
    return row;
  });

  return (
    <section className="mb-4 rounded-2xl border border-border bg-card p-4">
      <h3 className="mb-2 text-sm font-bold">Policy illustration</h3>
      <div className="mb-3 flex flex-wrap gap-2">
        {charts.map((c) => {
          const isOn = displayedIds.has(c.id);
          const pair = colorByChartId.get(c.id)!;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-opacity"
              style={{ borderColor: pair.dark, opacity: isOn ? 1 : 0.4 }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: pair.dark }} />
              {c.title || c.policyName}
            </button>
          );
        })}
      </div>
      {merged.length > 0 ? (
        <div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={merged} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="age" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={44} tickFormatter={tickAbbrev} />
                <Tooltip
                  formatter={(v: number) => fmtMoney(v, undefined)}
                  labelFormatter={(age) => `Age ${age}`}
                />
                <Legend verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: 10 }} />
                {activeCharts.map((c) => {
                  const pair = colorByChartId.get(c.id)!;
                  return [
                    <Bar
                      key={`${c.id}_in`}
                      dataKey={`${c.id}_in`}
                      name={`${c.title || c.policyName} (in)`}
                      fill={pair.dark}
                    />,
                    <Bar
                      key={`${c.id}_out`}
                      dataKey={`${c.id}_out`}
                      name={`${c.title || c.policyName} (out)`}
                      fill={pair.light}
                    />,
                  ];
                })}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-center text-[9px] text-muted-foreground">Age</p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Toggle a policy above to show its chart.</p>
      )}
    </section>
  );
}
