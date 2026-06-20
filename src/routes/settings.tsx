import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useMembers } from "@/hooks/useMembers";
import { useAppStore } from "@/lib/store";
import { Trash2 } from "lucide-react";
import { fmtMoney } from "@/lib/format";
import { runFullExport } from "@/lib/fullExport";

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
  const [generatingEstateDoc, setGeneratingEstateDoc] = useState(false);
  const [generatingFullExport, setGeneratingFullExport] = useState(false);

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
  const [retirementYear, setRetirementYear] = useState<string>("");
  const [cpfPayoutAge, setCpfPayoutAge] = useState<string>("65");
  const [cpfMonthlyPayout, setCpfMonthlyPayout] = useState<string>("");
  const [investmentGrowthRate, setInvestmentGrowthRate] = useState<string>("4");
  const [propertyAppreciationRate, setPropertyAppreciationRate] = useState<string>("2");
  const [inflationRate, setInflationRate] = useState<string>("2");
  const [planningHorizonAge, setPlanningHorizonAge] = useState<string>("85");

  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof window !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light"
  );
  const [accent, setAccent] = useState<string>(() =>
    (typeof window !== "undefined" && localStorage.getItem("fv:accent")) || ACCENT_PRESETS[0].value
  );
  const [alerts, setAlerts] = useState<LSAlerts>(loadAlerts);

  useEffect(() => {
    if (settings?.simulated_date) setSimDate(settings.simulated_date);
  }, [settings?.simulated_date]);

  useEffect(() => {
    if (settings?.monthly_income != null) setMonthlyIncome(String(settings.monthly_income));
    if (settings?.monthly_expenses != null) setMonthlyExpenses(String(settings.monthly_expenses));
    if (settings?.retirement_year != null) setRetirementYear(String(settings.retirement_year));
    if (settings?.cpf_payout_age != null) setCpfPayoutAge(String(settings.cpf_payout_age));
    if (settings?.cpf_monthly_payout != null) setCpfMonthlyPayout(String(settings.cpf_monthly_payout));
    if (settings?.investment_growth_rate != null) setInvestmentGrowthRate(String(settings.investment_growth_rate));
    if (settings?.property_appreciation_rate != null) setPropertyAppreciationRate(String(settings.property_appreciation_rate));
    if (settings?.inflation_rate != null) setInflationRate(String(settings.inflation_rate));
    if (settings?.planning_horizon_age != null) setPlanningHorizonAge(String(settings.planning_horizon_age));
  }, [
    settings?.monthly_income, settings?.monthly_expenses,
    settings?.retirement_year, settings?.cpf_payout_age, settings?.cpf_monthly_payout,
    settings?.investment_growth_rate, settings?.property_appreciation_rate,
    settings?.inflation_rate, settings?.planning_horizon_age,
  ]);

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
      if (!activeHouseholdId) throw new Error("Select a household first.");
      const { error } = await supabase
        .from("app_settings")
        .upsert({ household_id: activeHouseholdId, ...patch }, { onConflict: "household_id" });
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

  async function exportFull() {
    if (!activeHouseholdId) {
      toast.error("Select a household first.");
      return;
    }
    setGeneratingFullExport(true);
    try {
      await runFullExport(activeHouseholdId, members);
      toast.success("Full export downloaded");
    } catch (err: any) {
      toast.error(err.message || "Could not generate export");
    } finally {
      setGeneratingFullExport(false);
    }
  }

  async function exportAssetSummaryDocx() {
    if (!activeHouseholdId) {
      toast.error("Select a household first.");
      return;
    }
    setGeneratingEstateDoc(true);
    try {
      const docxLib: any = await import("https://esm.sh/docx@9");
      const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } = docxLib;

      const filter = (q: any) => q.eq("household_id", activeHouseholdId);
      const [propsRes, loansRes, insRes, invRes, savRes, otherRes] = await Promise.all([
        filter(supabase.from("properties").select("*")),
        filter(supabase.from("loans").select("*")),
        filter(supabase.from("insurance_policies").select("*")),
        filter(supabase.from("investments").select("*")),
        filter(supabase.from("savings_accounts").select("*")),
        filter(supabase.from("other_assets").select("*")),
      ]);

      const properties = propsRes.data ?? [];
      const loans = loansRes.data ?? [];
      const insurance = insRes.data ?? [];
      const investments = invRes.data ?? [];
      const savings = savRes.data ?? [];
      const otherAssets = otherRes.data ?? [];

      const memberById = new Map(members.map((m: any) => [m.id, m]));
      const ownerLabel = (memberId: string | null | undefined) => {
        if (!memberId) return "Joint / Household";
        const m = memberById.get(memberId);
        return m ? `${m.emoji ? m.emoji + " " : ""}${m.name}` : "Joint / Household";
      };

      // fmtMoney only renders $ or £; for non-SGD currencies, append the
      // currency code explicitly so a will-attachment isn't ambiguous.
      const fmtMoneyCcy = (n: number | null | undefined, ccy?: string | null) => {
        const base = fmtMoney(n, ccy === "GBP" ? "GBP" : "SGD");
        if (n == null || isNaN(Number(n))) return base;
        if (ccy && ccy !== "SGD" && ccy !== "GBP") return `${base} ${ccy}`;
        return base;
      };

      // Build owner order: each member in sort order, then "Joint / Household" last
      const ownerKeys: (string | null)[] = [...members.map((m: any) => m.id), null];

      // Usable page width = 12240 (Letter) - 2*1440 (1in margins) = 9360 DXA.
      const PAGE_WIDTH_DXA = 9360;

      const cell = (text: string, opts: { bold?: boolean } = {}) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text, bold: !!opts.bold })] })],
        });

      const headerRow = (labels: string[]) =>
        new TableRow({
          children: labels.map((l) => cell(l, { bold: true })),
        });

      const dataRow = (values: string[]) =>
        new TableRow({
          children: values.map((v) => cell(v)),
        });

      // Builds a full-width table with evenly-sized columns. docx@9 needs
      // explicit columnWidths (in DXA / twentieths-of-a-point) on tblGrid —
      // without it, columns render at ~0 width and everything is squeezed
      // into the left edge.
      const makeTable = (labels: string[], rows: string[][]) => {
        const colWidth = Math.floor(PAGE_WIDTH_DXA / labels.length);
        return new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          columnWidths: labels.map(() => colWidth),
          rows: [headerRow(labels), ...rows.map(dataRow)],
        });
      };

      const children: any[] = [];

      // --- Title & disclaimer ---
      children.push(new Paragraph({ text: "Asset & Liability Summary", heading: HeadingLevel.TITLE }));
      children.push(new Paragraph({
        children: [new TextRun({ text: `Generated ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} via FamilyVault`, italics: true, color: "666666" })],
      }));
      children.push(new Paragraph({ text: "" }));
      children.push(new Paragraph({
        children: [new TextRun({
          text: "This document is a reference summary of assets and liabilities recorded in FamilyVault. It is intended to assist with estate planning discussions (e.g. as an attachment alongside a will) and does NOT constitute a legal will or binding instruction. Always consult a qualified lawyer or financial advisor for legal estate planning.",
          italics: true, color: "999999",
        })],
      }));
      children.push(new Paragraph({ text: "" }));

      // --- Overall net worth summary ---
      const totalAssetsVal = properties.reduce((s: number, p: any) => s + (Number(p.current_value) || 0), 0)
        + investments.reduce((s: number, i: any) => s + (Number(i.current_value) || 0), 0)
        + savings.reduce((s: number, a: any) => s + (Number(a.balance) || 0), 0)
        + otherAssets.reduce((s: number, a: any) => s + (Number(a.estimated_value) || 0), 0);
      const totalLiabilitiesVal = loans.reduce((s: number, l: any) => s + (Number(l.balance) || 0), 0);

      children.push(new Paragraph({ text: "Household Summary", heading: HeadingLevel.HEADING_1 }));
      children.push(makeTable(
        ["", "Amount (SGD)"],
        [
          ["Total assets", fmtMoney(totalAssetsVal)],
          ["Total liabilities", fmtMoney(totalLiabilitiesVal)],
          ["Net worth", fmtMoney(totalAssetsVal - totalLiabilitiesVal)],
        ],
      ));
      children.push(new Paragraph({ text: "" }));
      children.push(new Paragraph({
        children: [new TextRun({ text: "Note: foreign-currency assets are shown in their original currency below but excluded from the SGD totals above.", italics: true, color: "999999" })],
      }));
      children.push(new Paragraph({ text: "" }));

      // --- Per-owner sections ---
      for (const ownerId of ownerKeys) {
        const label = ownerLabel(ownerId);
        const ownProps = properties.filter((p: any) => (p.member_id ?? null) === ownerId);
        const ownLoans = loans.filter((l: any) => (l.member_id ?? null) === ownerId);
        const ownIns = insurance.filter((p: any) => (p.member_id ?? null) === ownerId);
        const ownInv = investments.filter((i: any) => (i.member_id ?? null) === ownerId);
        const ownSav = savings.filter((a: any) => (a.member_id ?? null) === ownerId);
        const ownOther = otherAssets.filter((a: any) => (a.member_id ?? null) === ownerId);

        const hasAny = ownProps.length || ownLoans.length || ownIns.length || ownInv.length || ownSav.length || ownOther.length;
        if (!hasAny) continue;

        children.push(new Paragraph({ text: label, heading: HeadingLevel.HEADING_1 }));

        if (ownProps.length) {
          children.push(new Paragraph({ text: "Properties", heading: HeadingLevel.HEADING_2 }));
          children.push(makeTable(
            ["Name", "Current value", "Beneficiary / intended for"],
            ownProps.map((p: any) => [p.name ?? "—", fmtMoneyCcy(p.current_value, p.currency), p.beneficiary || "—"]),
          ));
          children.push(new Paragraph({ text: "" }));
        }

        if (ownInv.length) {
          children.push(new Paragraph({ text: "Investments", heading: HeadingLevel.HEADING_2 }));
          children.push(makeTable(
            ["Name", "Type", "Current value"],
            ownInv.map((i: any) => [i.name ?? "—", i.group_name ?? "—", fmtMoney(i.current_value)]),
          ));
          children.push(new Paragraph({ text: "" }));
        }

        if (ownSav.length) {
          children.push(new Paragraph({ text: "Savings & CPF", heading: HeadingLevel.HEADING_2 }));
          children.push(makeTable(
            ["Institution", "Account type", "Balance"],
            ownSav.map((a: any) => [a.institution ?? "—", a.account_type ?? "—", fmtMoney(a.balance)]),
          ));
          children.push(new Paragraph({ text: "" }));
        }

        if (ownOther.length) {
          children.push(new Paragraph({ text: "Other Assets", heading: HeadingLevel.HEADING_2 }));
          children.push(makeTable(
            ["Name", "Category", "Estimated value"],
            ownOther.map((a: any) => [a.name ?? "—", a.category ?? "—", fmtMoney(a.estimated_value)]),
          ));
          children.push(new Paragraph({ text: "" }));
        }

        if (ownIns.length) {
          children.push(new Paragraph({ text: "Insurance Policies", heading: HeadingLevel.HEADING_2 }));
          children.push(makeTable(
            ["Policy", "Provider", "Sum assured", "Beneficiary"],
            ownIns.map((p: any) => [p.name ?? "—", p.provider || "—", fmtMoneyCcy(p.sum_assured, p.currency), p.beneficiary || "—"]),
          ));
          children.push(new Paragraph({ text: "" }));
        }

        if (ownLoans.length) {
          children.push(new Paragraph({ text: "Liabilities (Loans)", heading: HeadingLevel.HEADING_2 }));
          children.push(makeTable(
            ["Bank", "Purpose", "Outstanding balance"],
            ownLoans.map((l: any) => [l.bank ?? "—", l.purpose || "—", fmtMoney(l.balance)]),
          ));
          children.push(new Paragraph({ text: "" }));
        }
      }

      const doc = new Document({
        sections: [{
          properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
          children,
        }],
      });

      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `familyvault-asset-summary-${new Date().toISOString().slice(0, 10)}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Asset summary downloaded");
    } catch (err: any) {
      toast.error(err.message || "Could not generate document");
    } finally {
      setGeneratingEstateDoc(false);
    }
  }

  const currency = settings?.currency ?? "SGD";
  const inc = parseFloat(monthlyIncome) || 0;
  const exp = parseFloat(monthlyExpenses) || 0;
  const surplus = inc - exp;
  const surplusColor = surplus >= 0 ? "text-settled" : "text-urgent";
  const showSurplus = inc > 0 || exp > 0;

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
          Combined household figures used for cash flow and lifetime projections.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground">Monthly income ({currency})</label>
            <input
              type="number" min="0"
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              placeholder="e.g. 12000"
              value={monthlyIncome}
              onChange={(e) => setMonthlyIncome(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground">Monthly expenses ({currency})</label>
            <input
              type="number" min="0"
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              placeholder="e.g. 6000"
              value={monthlyExpenses}
              onChange={(e) => setMonthlyExpenses(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Exclude loan repayments and insurance premiums — those are tracked automatically.
            </p>
          </div>
          {showSurplus && (
            <div className="rounded-lg bg-background/50 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Discretionary surplus: </span>
              <span className={`font-semibold ${surplusColor}`}>{currency} {surplus.toLocaleString()}</span>
              <span className="text-xs text-muted-foreground"> / month</span>
            </div>
          )}
        </div>
        <button
          className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          onClick={() => save.mutate({
            monthly_income: parseFloat(monthlyIncome) || 0,
            monthly_expenses: parseFloat(monthlyExpenses) || 0,
          })}
        >
          Save
        </button>
      </section>

      {/* Projection Assumptions */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-1 text-sm font-bold">Projection Assumptions</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Used only for the Lifetime Net Worth chart. All rates are annual percentages.
        </p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Retirement year</label>
              <input
                type="number" min="2024" max="2100"
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                placeholder="e.g. 2045"
                value={retirementYear}
                onChange={(e) => setRetirementYear(e.target.value)}
              />
              <p className="mt-0.5 text-[10px] text-muted-foreground">Salary stops this year</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Planning horizon (age)</label>
              <input
                type="number" min="60" max="120"
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                placeholder="85"
                value={planningHorizonAge}
                onChange={(e) => setPlanningHorizonAge(e.target.value)}
              />
              <p className="mt-0.5 text-[10px] text-muted-foreground">Chart projects to this age</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground">CPF payout age</label>
              <input
                type="number" min="55" max="75"
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                placeholder="65"
                value={cpfPayoutAge}
                onChange={(e) => setCpfPayoutAge(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">CPF monthly payout ({currency})</label>
              <input
                type="number" min="0"
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                placeholder="e.g. 1500"
                value={cpfMonthlyPayout}
                onChange={(e) => setCpfMonthlyPayout(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Investment growth (%)</label>
              <input
                type="number" min="0" max="30" step="0.5"
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                placeholder="4"
                value={investmentGrowthRate}
                onChange={(e) => setInvestmentGrowthRate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Property growth (%)</label>
              <input
                type="number" min="0" max="20" step="0.5"
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                placeholder="2"
                value={propertyAppreciationRate}
                onChange={(e) => setPropertyAppreciationRate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Inflation (%)</label>
              <input
                type="number" min="0" max="20" step="0.5"
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                placeholder="2"
                value={inflationRate}
                onChange={(e) => setInflationRate(e.target.value)}
              />
            </div>
          </div>
        </div>
        <button
          className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          onClick={() => save.mutate({
            retirement_year: parseInt(retirementYear) || null,
            cpf_payout_age: parseInt(cpfPayoutAge) || 65,
            cpf_monthly_payout: parseFloat(cpfMonthlyPayout) || 0,
            investment_growth_rate: investmentGrowthRate === "" ? 4 : parseFloat(investmentGrowthRate),
            property_appreciation_rate: propertyAppreciationRate === "" ? 2 : parseFloat(propertyAppreciationRate),
            inflation_rate: inflationRate === "" ? 2 : parseFloat(inflationRate),
            planning_horizon_age: parseInt(planningHorizonAge) || 85,
          })}
        >
          Save
        </button>
      </section>

      {/* Planned Events */}
      <PlannedEvents householdId={activeHouseholdId} currency={currency} />

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
          <button onClick={exportFull} disabled={generatingFullExport} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold">
            {generatingFullExport ? "Generating…" : "Export everything (Excel)"}
          </button>
          <button onClick={exportAssetSummaryDocx} disabled={generatingEstateDoc} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold">
            {generatingEstateDoc ? "Generating…" : "Export Asset & Liability Summary (.docx)"}
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

// ── Planned Events ────────────────────────────────────────────────────────────

type PlannedEvent = {
  id: string;
  label: string;
  year: number;
  amount: number;
  type: "inflow" | "outflow";
};

function PlannedEvents({ householdId, currency }: { householdId: string | null; currency: string }) {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [year, setYear] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [type, setType] = useState<"inflow" | "outflow">("outflow");
  const [adding, setAdding] = useState(false);

  const { data: events = [] } = useQuery({
    queryKey: ["planned_events", householdId],
    enabled: !!householdId,
    queryFn: async () => {
      if (!householdId) return [];
      const { data } = await supabase
        .from("planned_cashflow_events" as any)
        .select("*")
        .eq("household_id", householdId)
        .order("year", { ascending: true });
      return (data ?? []) as PlannedEvent[];
    },
  });

  async function addEvent() {
    if (!householdId || !label || !year || !amount) return;
    setAdding(true);
    const { error } = await supabase
      .from("planned_cashflow_events" as any)
      .insert({
        household_id: householdId,
        label,
        year: parseInt(year),
        amount: parseFloat(amount),
        type,
      });
    setAdding(false);
    if (error) { toast.error("Could not save event."); return; }
    setLabel(""); setYear(""); setAmount(""); setType("outflow");
    qc.invalidateQueries({ queryKey: ["planned_events", householdId] });
    qc.invalidateQueries({ queryKey: ["planned_events_chart", householdId] });
    toast.success("Event added");
  }

  async function deleteEvent(id: string) {
    await supabase.from("planned_cashflow_events" as any).delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["planned_events", householdId] });
    qc.invalidateQueries({ queryKey: ["planned_events_chart", householdId] });
  }

  const currentYear = new Date().getFullYear();

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h2 className="mb-1 text-sm font-bold">Planned Events</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        One-off future inflows or outflows — renovations, education fees, inheritances, windfalls.
      </p>

      {/* Add form */}
      <div className="space-y-2 rounded-xl bg-background/50 p-3">
        <input
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          placeholder="Label, e.g. University fees, Home renovation"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <div className="grid grid-cols-3 gap-2">
          <input
            type="number"
            min={currentYear} max="2100"
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
            placeholder="Year"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
          <input
            type="number" min="0"
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
            placeholder={`Amount (${currency})`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <select
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value as "inflow" | "outflow")}
          >
            <option value="outflow">Outflow ↓</option>
            <option value="inflow">Inflow ↑</option>
          </select>
        </div>
        <button
          className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          onClick={addEvent}
          disabled={adding || !label || !year || !amount}
        >
          {adding ? "Adding…" : "Add event"}
        </button>
      </div>

      {/* Event list */}
      {events.length > 0 && (
        <ul className="mt-3 divide-y divide-border">
          {events.map((e) => {
            const typeColor = e.type === "inflow" ? "text-settled" : "text-urgent";
            const typeSign = e.type === "inflow" ? "+" : "−";
            return (
              <li key={e.id} className="flex items-center gap-3 py-2 text-sm">
                <div className="flex-1 min-w-0">
                  <span className="font-medium truncate">{e.label}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{e.year}</span>
                </div>
                <span className={`shrink-0 font-semibold ${typeColor}`}>
                  {typeSign}{currency} {Number(e.amount).toLocaleString()}
                </span>
                <button
                  onClick={() => deleteEvent(e.id)}
                  className="shrink-0 text-urgent opacity-70 hover:opacity-100"
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {events.length === 0 && (
        <p className="mt-3 text-center text-xs text-muted-foreground">No planned events yet.</p>
      )}
    </section>
  );
}

// ── Dismissed History ─────────────────────────────────────────────────────────

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
    await supabase.from("dismissed_dashboard_items").delete().eq("household_id", householdId);
    await qc.invalidateQueries({ queryKey: ["dismissed-dashboard", householdId] });
    await qc.invalidateQueries({ queryKey: ["alert-count", householdId] });
    toast.success("History cleared — items restored to dashboard and alerts.");
  }

  const historyCount = history.length;

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">Completed Items History</h2>
        <button onClick={() => setExpanded((v) => !v)} className="text-xs font-semibold text-primary">
          {expanded ? "Hide" : `Show (${historyCount})`}
        </button>
      </div>
      {expanded && (
        <div className="mt-3">
          {historyCount === 0 ? (
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
