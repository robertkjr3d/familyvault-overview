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

// Distinct, stable palette — cycled by index, same policy always gets the
// same color within one compare session (order is stable: insertion order
// of the charts array from listAdvisorPolicyCharts).
const CHART_COLORS = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#d97706",
  "#9333ea",
  "#0891b2",
  "#db2777",
  "#65a30d",
];

function newPhaseId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `p${Date.now()}${Math.random()}`;
}

// ============================================================
// Per-record phase editor — a "Chart" toggle button + inline panel,
// same interaction shape as RecordNote in AdvisorHome.tsx (button when
// collapsed, panel with Save/Cancel when open).
// ============================================================
export function PolicyChartToggle({
  insurancePolicyId,
  householdId,
  memberId,
}: {
  insurancePolicyId: string;
  householdId: string;
  memberId: string;
}) {
  const [open, setOpen] = useState(false);
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
        {open ? "Hide chart" : "Policy chart"}
      </button>
      {open && (
        <PolicyChartEditor
          insurancePolicyId={insurancePolicyId}
          householdId={householdId}
          memberId={memberId}
        />
      )}
    </div>
  );
}

function PolicyChartEditor({
  insurancePolicyId,
  householdId,
  memberId,
}: {
  insurancePolicyId: string;
  householdId: string;
  memberId: string;
}) {
  const queryClient = useQueryClient();
  const [phases, setPhases] = useState<ChartPhase[] | null>(null); // null until seeded from the query below
  const [title, setTitle] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["advisor-policy-chart", householdId, memberId, insurancePolicyId],
    queryFn: () => getAdvisorPolicyChart({ data: { householdId, memberId, insurancePolicyId } }),
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
      setPhases(buildDefaultPhases(data.policy as Parameters<typeof buildDefaultPhases>[0], data.memberBirthYear));
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
          insurancePolicyId,
          title: title.trim() || undefined,
          phases: phases ?? [],
        },
      }),
    onSuccess: () => {
      toast.success("Chart saved");
      void queryClient.invalidateQueries({
        queryKey: ["advisor-policy-chart", householdId, memberId, insurancePolicyId],
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
      void queryClient.invalidateQueries({
        queryKey: ["advisor-policy-chart", householdId, memberId, insurancePolicyId],
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

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-dashed border-border/60 p-3">
      {data?.memberBirthYear == null && (
        <p className="rounded-md bg-review/10 p-2 text-[10px] text-review-foreground">
          This member has no birth year on file, so ages below aren't tied to a real calendar year
          yet — the chart still works, just treat the numbers as relative years, not confirmed ages.
        </p>
      )}

      {bars.length > 0 && (
        <div className="h-40 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis
                dataKey="age"
                tick={{ fontSize: 10 }}
                label={{ value: "Age", position: "insideBottom", offset: -2, fontSize: 10 }}
              />
              <YAxis tick={{ fontSize: 10 }} width={50} />
              <Tooltip
                formatter={(v: number) => fmtMoney(v, undefined)}
                labelFormatter={(age) => `Age ${age}`}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="in" name="Pay in" fill="#dc2626" />
              <Bar dataKey="out" name="Pay out" fill="#16a34a" />
            </BarChart>
          </ResponsiveContainer>
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
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? "Saving..." : "Save chart"}
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
          ✕
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <select
          value={phase.direction}
          onChange={(e) => onChange({ direction: e.target.value as ChartPhaseDirection })}
          className="h-6 rounded border border-input bg-background px-1"
        >
          {DIRECTIONS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground">age</span>
        <Input
          type="number"
          value={phase.startAge}
          onChange={(e) => onChange({ startAge: Number(e.target.value) || 0 })}
          className="h-6 w-14 text-[11px]"
        />
        <span className="text-muted-foreground">to</span>
        <Input
          type="number"
          value={phase.endAge}
          onChange={(e) => onChange({ endAge: Number(e.target.value) || 0 })}
          className="h-6 w-14 text-[11px]"
          disabled={phase.frequency === "lump-sum"}
        />
        <Input
          type="number"
          value={phase.amount}
          onChange={(e) => onChange({ amount: Number(e.target.value) || 0 })}
          className="h-6 w-20 text-[11px]"
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
          className="h-6 rounded border border-input bg-background px-1"
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
// Compare view — every saved chart for this client, toggleable, one
// color per policy. Renders nothing (not even a loading state) when the
// advisor hasn't saved any chart yet for this client, so it never adds
// visual noise to the common case of a client with no charts built.
// ============================================================
export function PolicyChartCompareSection({
  householdId,
  memberId,
}: {
  householdId: string;
  memberId: string;
}) {
  const { data: charts } = useQuery({
    queryKey: ["advisor-policy-charts", householdId, memberId],
    queryFn: () => listAdvisorPolicyCharts({ data: { householdId, memberId } }),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Default to showing the single chart if there's only one — matches
  // the FA's usual case (show one policy to a client) without an extra
  // tap; with multiple charts, default to showing just the first so a
  // multi-policy household doesn't open on an overwhelming combined view.
  const effectiveSelected = useMemo(() => {
    if (selected.size > 0 || !charts) return selected;
    return new Set(charts.slice(0, 1).map((c) => c.id));
  }, [selected, charts]);

  if (!charts || charts.length === 0) return null;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev.size > 0 ? prev : effectiveSelected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const activeCharts = charts.filter((c) => effectiveSelected.has(c.id));
  const colorByChartId = new Map(
    charts.map((c, i) => [c.id, CHART_COLORS[i % CHART_COLORS.length]]),
  );

  // Merge each active chart's expanded bars into one age-indexed dataset,
  // with a dedicated {chartId}_in / {chartId}_out pair of series per
  // chart so each policy gets its own bars rather than being summed
  // together (summing would defeat the point of a compare view).
  const ageSet = new Set<number>();
  const expandedByChart = new Map<string, Map<number, { in: number; out: number }>>();
  for (const c of activeCharts) {
    const bars = expandPhasesToYearlyBars(c.phases as ChartPhase[]);
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
          const isOn = effectiveSelected.has(c.id);
          const color = colorByChartId.get(c.id)!;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-opacity"
              style={{ borderColor: color, opacity: isOn ? 1 : 0.4 }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: color }} />
              {c.title || c.policyName}
            </button>
          );
        })}
      </div>
      {merged.length > 0 ? (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={merged} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis
                dataKey="age"
                tick={{ fontSize: 10 }}
                label={{ value: "Age", position: "insideBottom", offset: -2, fontSize: 10 }}
              />
              <YAxis tick={{ fontSize: 10 }} width={50} />
              <Tooltip
                formatter={(v: number) => fmtMoney(v, undefined)}
                labelFormatter={(age) => `Age ${age}`}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {activeCharts.map((c) => {
                const color = colorByChartId.get(c.id)!;
                return [
                  <Bar
                    key={`${c.id}_in`}
                    dataKey={`${c.id}_in`}
                    name={`${c.title || c.policyName} (in)`}
                    fill={color}
                    fillOpacity={0.9}
                  />,
                  <Bar
                    key={`${c.id}_out`}
                    dataKey={`${c.id}_out`}
                    name={`${c.title || c.policyName} (out)`}
                    fill={color}
                    fillOpacity={0.45}
                  />,
                ];
              })}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Toggle a policy above to show its chart.</p>
      )}
    </section>
  );
}
