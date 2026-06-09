import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useMembers } from "@/hooks/useMembers";
import { useAppStore } from "@/lib/store";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
  head: () => ({ meta: [{ title: "Settings — FamilyVault" }] }),
});

const ACCENT_PRESETS = [
  { name: "Gold",  value: "oklch(0.72 0.13 80)" },
  { name: "Teal",  value: "oklch(0.62 0.10 195)" },
  { name: "Coral", value: "oklch(0.68 0.18 35)" },
  { name: "Sage",  value: "oklch(0.65 0.10 150)" },
  { name: "Plum",  value: "oklch(0.55 0.15 320)" },
  { name: "Slate", value: "oklch(0.45 0.04 250)" },
];

type LSAlerts = {
  mortgage_days: number;
  insurance_days: number;
  fd_days: number;
  warranty_days: number;
};
const DEFAULTS: LSAlerts = { mortgage_days: 90, insurance_days: 60, fd_days: 30, warranty_days: 90 };

function loadAlerts(): LSAlerts {
  if (typeof window === "undefined") return DEFAULTS;
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("fv:alerts") ?? "{}") }; }
  catch { return DEFAULTS; }
}

function SettingsPage() {
  const qc = useQueryClient();
  const { data: members = [] } = useMembers();
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
  const setShareOpen = useAppStore((s) => s.setShareOpen);
  const { data: settings } = useQuery({
    queryKey: ["app_settings", activeHouseholdId],
    enabled: !!activeHouseholdId,
    queryFn: async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("*")
        .eq("household_id", activeHouseholdId!)
        .maybeSingle();
      return data;
    },
  });
  const [familyName, setFamilyName] = useState("");
  const [simDate, setSimDate] = useState("");
  const [monthlyIncome, setMonthlyIncome] = useState<string>("");
  const [monthlyExpenses, setMonthlyExpenses] = useState<string>("");

  // Sync simDate from DB when settings first load
  useEffect(() => {
    if (settings?.simulated_date) setSimDate(settings.simulated_date);
  }, [settings?.simulated_date]);

  // Sync income/expenses from DB when settings first load
  useEffect(() => {
    if (settings?.monthly_income != null) setMonthlyIncome(String(settings.monthly_income));
    if (settings?.monthly_expenses != null) setMonthlyExpenses(String(settings.monthly_expenses));
  }, [settings?.monthly_income, settings?.monthly_expenses]);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof window !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light"
  );
  const [accent, setAccent] = useState<string>(() =>
    (typeof window !== "undefined" && localStorage.getItem("fv:accent")) || ACCENT_PRESETS[0].value
  );
  const [alerts, setAlerts] = useState<LSAlerts>(loadAlerts);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty("--aza", accent);
    localStorage.setItem("fv:accent", accent);
  }, [accent]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("fv:alerts", JSON.stringify(alerts));
  }, [alerts]);

  const save = useMutation({
    mutationFn: async (patch: any) => {
      if (!activeHouseholdId) {
        throw new Error("Select a household first.");
      }

      const { error } = await supabase
        .from("app_settings")
        .upsert(
          {
            household_id: activeHouseholdId,
            ...patch,
          },
          { onConflict: "household_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app_settings", activeHouseholdId] });
      toast.success("Saved");
    },
  });

  async function clearDemo() {
    if (!confirm("Are you sure? This cannot be undone.")) return;
    const tables = ["properties", "loans", "insurance_policies", "investments", "savings_accounts", "health_conditions"];
    for (const t of tables) {
      await supabase.from(t as any).delete().eq("is_demo", true);
    }
    qc.invalidateQueries();
    toast.success("Demo data cleared");
  }

  async function exportCsv() {
    const tables = ["properties", "loans", "insurance_policies", "investments", "savings_accounts"];
    let out = "";
    for (const t of tables) {
      const { data } = await supabase.from(t as any).select("*");
      if (!data || data.length === 0) continue;
      const cols = Object.keys(data[0]);
      out += `# ${t}\n${cols.join(",")}\n`;
      for (const row of data) {
        out += cols.map((c) => JSON.stringify((row as any)[c] ?? "")).join(",") + "\n";
      }
      out += "\n";
    }
    const blob = new Blob([out], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `familyvault-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5 pb-6">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>

      {/* Family */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-bold">Family</h2>
        <label className="block text-xs font-medium text-muted-foreground">Family name</label>
        <input
          className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          defaultValue={settings?.family_name ?? ""}
          onChange={(e) => setFamilyName(e.target.value)}
        />
        <button
          className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          onClick={() => save.mutate({ family_name: familyName || settings?.family_name })}
        >
          Save
        </button>
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Members</span>
            <a href="/members" className="text-xs font-semibold text-primary">Manage →</a>
          </div>
          <ul className="space-y-1.5">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 rounded-lg bg-background/50 px-3 py-2 text-sm">
                <span className="h-3 w-3 rounded-full" style={{ background: m.color }} />
                <span className="flex-1 font-medium">{m.name}</span>
                <span className="text-xs text-muted-foreground">{m.short_name}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Household Finances */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-1 text-sm font-bold">Household Finances</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Used for cash flow calculations and lifetime projections. Combined household figures.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground">
              Monthly income ({settings?.currency ?? "SGD"})
            </label>
            <input
              type="number"
              min="0"
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              placeholder="e.g. 12000"
              value={monthlyIncome}
              onChange={(e) => setMonthlyIncome(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground">
              Monthly expenses ({settings?.currency ?? "SGD"})
            </label>
            <input
              type="number"
              min="0"
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              placeholder="e.g. 6000"
              value={monthlyExpenses}
              onChange={(e) => setMonthlyExpenses(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Exclude loan repayments and insurance premiums — those are tracked automatically.
            </p>
          </div>
          {(() => {
            const inc = parseFloat(monthlyIncome) || 0;
            const exp = parseFloat(monthlyExpenses) || 0;
            const surplus = inc - exp;
            const surplusColor = surplus >= 0 ? "text-settled" : "text-urgent";
            const show = inc > 0 || exp > 0;
            if (!show) return null;
            return (
              <div className="rounded-lg bg-background/50 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Discretionary surplus: </span>
                <span className={`font-semibold ${surplusColor}`}>
                  {(settings?.currency ?? "SGD")} {surplus.toLocaleString()}
                </span>
                <span className="text-xs text-muted-foreground"> / month</span>
              </div>
            );
          })()}
        </div>
        <button
          className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          onClick={() =>
            save.mutate({
              monthly_income: parseFloat(monthlyIncome) || 0,
              monthly_expenses: parseFloat(monthlyExpenses) || 0,
            })
          }
        >
          Save
        </button>
      </section>

      {/* Appearance */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-bold">Appearance</h2>
        <div className="flex items-center justify-between text-sm">
          <span>Dark mode</span>
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className={`relative h-6 w-11 rounded-full transition ${theme === "dark" ? "bg-primary" : "bg-muted"}`}
            aria-pressed={theme === "dark"}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${theme === "dark" ? "left-5" : "left-0.5"}`} />
          </button>
        </div>
        <div className="mt-4">
          <div className="mb-2 text-xs font-medium text-muted-foreground">Accent colour</div>
          <div className="flex flex-wrap gap-2">
            {ACCENT_PRESETS.map((c) => (
              <button
                key={c.name}
                onClick={() => setAccent(c.value)}
                title={c.name}
                className={`h-8 w-8 rounded-full border-2 transition ${accent === c.value ? "border-foreground" : "border-transparent"}`}
                style={{ background: c.value }}
                aria-label={c.name}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Alerts & Reminders */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-bold">Alerts & Reminders</h2>
        {[
          { key: "mortgage_days",  label: "Mortgage repricing alert" },
          { key: "insurance_days", label: "Insurance renewal alert" },
          { key: "fd_days",        label: "Fixed Deposit maturity alert" },
          { key: "warranty_days",  label: "Warranty expiry alert" },
        ].map((r) => (
          <div key={r.key} className="flex items-center justify-between py-1.5 text-sm">
            <span>{r.label}</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={(alerts as any)[r.key]}
                onChange={(e) => setAlerts({ ...alerts, [r.key]: Number(e.target.value) })}
                className="h-7 w-16 rounded-md border border-input bg-background px-2 text-right text-sm"
              />
              <span className="text-xs text-muted-foreground">days before</span>
            </div>
          </div>
        ))}
      </section>

      {/* Test Mode */}
      <section className="rounded-2xl border border-review/40 bg-review-soft/30 p-4">
        <h2 className="mb-1 text-sm font-bold">Test Mode</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Simulate a future date (for testing alerts). The whole app behaves as if today were the date you pick.
        </p>
        <input
          type="date"
          className="w-full max-w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          value={simDate}
          onChange={(e) => setSimDate(e.target.value)}
        />
        <div className="mt-3 flex gap-2">
          <button className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
            onClick={() => { if (simDate) save.mutate({ simulated_date: simDate }); }}>Apply</button>
          <button className="rounded-lg border border-border px-3 py-2 text-xs font-semibold"
            onClick={() => { setSimDate(""); save.mutate({ simulated_date: null }); }}>Clear</button>
        </div>
      </section>

      {/* Data */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-bold">Data</h2>
        <div className="flex flex-col gap-2">
          <button onClick={exportCsv} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold">
            Export all data as CSV
          </button>
          <button onClick={clearDemo} className="rounded-lg border border-urgent/40 px-3 py-2 text-sm font-semibold text-urgent">
            Clear all demo data
          </button>
        </div>
      </section>

      {/* Dismissed History */}
      <DismissedHistory householdId={activeHouseholdId} />

      {/* Account */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-bold">Account</h2>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setShareOpen(true)}
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
          >
            Share household access
          </button>
          <button
            onClick={() => void supabase.auth.signOut()}
            className="rounded-lg border border-urgent/40 px-3 py-2 text-sm font-semibold text-urgent"
          >
            Sign out
          </button>
        </div>
      </section>
      {/* About */}
      <section className="rounded-2xl border border-border bg-card p-4 text-sm">
        <h2 className="mb-2 text-sm font-bold">About</h2>
        <p className="font-semibold">FamilyVault</p>
        <p className="text-muted-foreground">Your one stop for everything family — all in one place.</p>
        <p className="mt-2 text-xs text-muted-foreground">Version 1.0.0</p>
        <p className="mt-2 text-xs italic text-muted-foreground">
          Built for families who want one place to track everything that matters.
        </p>
      </section>
    </div>
  );
}

function DismissedHistory({ householdId }: { householdId: string | null }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const { data: history = [] } = useQuery({
    queryKey: ["dismissed-dashboard", householdId],
    enabled: !!householdId,
    queryFn: async () => {
      if (!householdId) return [];
      const { data } = await supabase
        .from("dismissed_dashboard_items")
        .select("*")
        .eq("household_id", householdId)
        .order("dismissed_at", { ascending: false });
      return data ?? [];
    },
  });

  async function clearHistory() {
    if (!householdId) return;
    if (!confirm("Clear all dismissed history? Items will reappear in your dashboard and alerts.")) return;
    await supabase
      .from("dismissed_dashboard_items")
      .delete()
      .eq("household_id", householdId);
    await qc.invalidateQueries({ queryKey: ["dismissed-dashboard", householdId] });
    await qc.invalidateQueries({ queryKey: ["alert-count", householdId] });
    toast.success("History cleared — items restored to dashboard and alerts.");
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">Completed Items History</h2>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs font-semibold text-primary"
        >
          {expanded ? "Hide" : `Show (${history.length})`}
        </button>
      </div>
      {expanded && (
        <div className="mt-3">
          {history.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No dismissed items yet.</p>
          ) : (
            <>
              <ul className="divide-y divide-border">
                {history.map((item: any) => {
                  const dismissedOn = new Date(item.dismissed_at).toLocaleDateString("en-GB", {
                    day: "numeric", month: "short", year: "numeric",
                  });
                  return (
                    <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="flex-1 truncate">{item.label}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">Done {dismissedOn}</span>
                    </li>
                  );
                })}
              </ul>
              <button
                onClick={clearHistory}
                className="mt-4 w-full rounded-lg border border-urgent/40 px-3 py-2 text-sm font-semibold text-urgent"
              >
                Clear history
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
