import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { DateInput } from "@/components/ui/date-input";
import { useMembers } from "@/hooks/useMembers";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { recordConfigs, type FieldDef, type SelectOption } from "@/lib/recordConfigs";
import { MoneyInput } from "./MoneyInput";
import { ChevronLeft, X } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { flashNewRecord } from "@/components/HashHighlight";

function optValue(o: SelectOption) { return typeof o === "string" ? o : o.value; }
function optLabel(o: SelectOption) { return typeof o === "string" ? o : o.label; }

// Insurance categories that should redirect the user to the Investments
// wizard instead of continuing the Insurance wizard (ILP/Endowment belong
// in `investments`, per recordConfigs.ts).
const ILP_REDIRECT_CATEGORIES = new Set(["ILP (Investment-Linked Policy)", "Endowment"]);

// Property wizard: fields handled by the dedicated "combined other cost"
// question instead of being asked individually.
const PROPERTY_COST_KEYS = new Set([
  "cost_management", "cost_property_tax", "cost_fire_insurance", "cost_maintenance",
]);

type WizardStep =
  | { kind: "field"; field: FieldDef }
  | { kind: "property_costs" };

export function RecordWizardSheet({
  configKey, open, onOpenChange,
}: {
  configKey: "properties" | "insurance_policies";
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const cfg = recordConfigs[configKey];
  const { data: members = [] } = useMembers();
  const qc = useQueryClient();
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);

  const { data: properties = [] } = useQuery({
    queryKey: ["properties", activeHouseholdId],
    enabled: !!activeHouseholdId,
    queryFn: async () => {
      if (!activeHouseholdId) return [];
      const { data } = await supabase.from("properties").select("id, name").eq("household_id", activeHouseholdId);
      return data ?? [];
    },
  });

  const [stepIdx, setStepIdx] = useState(0);
  const [values, setValues] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [redirectMsg, setRedirectMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStepIdx(0);
      setValues({});
      setRedirectMsg(null);
      setSubmitting(false);
    }
  }, [open, configKey]);

  function setVal(k: string, v: any) {
    setValues((s) => ({ ...s, [k]: v }));
  }

  // Build the ordered list of steps for this config, respecting showIf
  // against answers given so far. Re-computed on every render since values
  // change as the user progresses (later showIf checks depend on earlier
  // answers).
  const steps = useMemo<WizardStep[]>(() => {
    const out: WizardStep[] = [];
    for (const f of cfg.fields) {
      if (f.showIf && !f.showIf(values)) continue;

      if (configKey === "properties" && PROPERTY_COST_KEYS.has(f.key)) {
        // Replace the 4 individual cost fields with one combined question,
        // inserted once at the position of the first of these fields.
        if (!out.some((s) => s.kind === "property_costs")) {
          out.push({ kind: "property_costs" });
        }
        continue;
      }

      out.push({ kind: "field", field: f });
    }

    return out;
  }, [cfg.fields, values, configKey]);

  const step = steps[stepIdx];
  const isLast = stepIdx >= steps.length - 1;

  function next() {
    if (!validateCurrent()) return;
    if (isLast) {
      submit();
      return;
    }
    setStepIdx((i) => i + 1);
  }

  function back() {
    if (stepIdx === 0) {
      onOpenChange(false);
      return;
    }
    setStepIdx((i) => i - 1);
  }

  function validateCurrent(): boolean {
    if (!step) return true;
    if (step.kind === "field") {
      const f = step.field;
      if (f.required) {
        const v = values[f.key];
        if (v === undefined || v === "" || v === null) {
          toast.error(`${f.label} is required`);
          return false;
        }
      }
      // ILP / Endowment redirect for insurance category question
      if (configKey === "insurance_policies" && f.key === "category") {
        const v = values.category;
        if (ILP_REDIRECT_CATEGORIES.has(v)) {
          setRedirectMsg(
            `${v} policies belong in the Investments tab — they have their own premium and payout fields there. Please use the Investments tab to add this instead.`
          );
          return false;
        }
      }
    }
    return true;
  }

  async function submit() {
    if (!activeHouseholdId) {
      toast.error("Select a household first.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = buildPayload(cfg.fields, values, activeHouseholdId);

      // Required-field check across all fields actually visible (in case any
      // were skipped via showIf but are required and unanswered — shouldn't
      // normally happen since required fields are always asked, but guard anyway).
      for (const f of cfg.fields) {
        if (f.showIf && !f.showIf(values)) continue;
        if (f.required && (payload[f.key] === undefined || payload[f.key] === "" || payload[f.key] === null)) {
          toast.error(`${f.label} is required`);
          setSubmitting(false);
          return;
        }
      }

      const { data: inserted, error } = await supabase.from(cfg.table as any).insert(payload).select("id").single();
      if (error) throw error;
      const newId = (inserted as any)?.id;

      toast.success(`${cfg.label} added`);
      // Scroll to and flash the new card once the list refreshes (not during a tour).
      if (!useAppStore.getState().activeTour) flashNewRecord(newId);
      qc.invalidateQueries({ queryKey: [cfg.queryKey] });
      // Bug fix (July 2026) — see matching fix + comment in RecordFormSheet.tsx:
      // MemberFilterBar's count badge keys off the real table name, which
      // differs from this queryKey alias for insurance_policies/savings_accounts.
      qc.invalidateQueries({ queryKey: [cfg.table] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Could not save");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92vh] w-full max-w-full overflow-x-hidden overflow-y-auto rounded-t-2xl px-4 pb-2 pt-3"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
        <SheetHeader>
          <SheetTitle className="text-base pr-8">Add {cfg.label}</SheetTitle>
        </SheetHeader>

        {redirectMsg ? (
          <div className="mt-4 space-y-4 pb-4">
            <p className="text-sm">{redirectMsg}</p>
            <Button type="button" className="w-full cursor-pointer" onClick={() => onOpenChange(false)}>
              Got it
            </Button>
          </div>
        ) : (
          <div className="mt-4 space-y-4 pb-4">
            <div className="text-xs text-muted-foreground">
              Step {stepIdx + 1} of {steps.length}
            </div>

            {step?.kind === "field" && (
              <FieldStep
                f={step.field}
                value={values[step.field.key]}
                onChange={(v) => setVal(step.field.key, v)}
                members={members}
                properties={properties}
                currency={(step.field.currencyFrom && values[step.field.currencyFrom]) || "SGD"}
              />
            )}

            {step?.kind === "property_costs" && (
              <PropertyCostsStep
                values={values}
                onChange={(other) => setVal("cost_other", other)}
                currency={values.currency || "SGD"}
              />
            )}

            <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
              <Button type="button" variant="outline" className="flex-1 cursor-pointer" onClick={back}>
                {stepIdx === 0 ? <X className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              </Button>
              <Button type="button" className="flex-1 cursor-pointer" onClick={next} disabled={submitting}>
                {submitting ? "Saving…" : isLast ? "Save" : "Next"}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function buildPayload(fields: FieldDef[], values: Record<string, any>, householdId: string): Record<string, any> {
  const payload: Record<string, any> = {};
  for (const f of fields) {
    let v = values[f.key];
    if (f.type === "chips") {
      payload[f.key] = Array.isArray(v) ? v : [];
      continue;
    }
    if (v === "" || v === undefined || v === null) continue;
    if (f.type === "number" || f.money) {
      const raw = String(v).replace(/,/g, "");
      v = raw === "" ? null : Number(raw);
    }
    payload[f.key] = v;
  }
  payload.household_id = householdId;
  return payload;
}

function FieldStep({ f, value, onChange, members, properties, currency }: {
  f: FieldDef; value: any; onChange: (v: any) => void; members: any[]; properties: any[]; currency: string;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">
        {f.label}{f.required && <span className="text-urgent"> *</span>}
      </div>
      <FieldInput f={f} value={value} onChange={onChange} members={members} properties={properties} currency={currency} />
    </div>
  );
}

function FieldInput({ f, value, onChange, members, properties, currency }: {
  f: FieldDef; value: any; onChange: (v: any) => void; members: any[]; properties: any[]; currency: string;
}) {
  if (f.type === "boolean") {
    return (
      <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-muted-foreground">
        <Checkbox checked={!!value} onCheckedChange={(v) => onChange(!!v)} />
        <span>{f.placeholder ?? "Enabled"}</span>
      </label>
    );
  }
  // Tappable buttons for small select-like fields (member, select, property_select)
  if (f.type === "select" && f.options && f.options.length <= 8) {
    return (
      <div className="flex flex-wrap gap-2">
        {f.options.map((o) => {
          const v = optValue(o);
          const selected = value === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm transition ${
                selected ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background"
              }`}
            >
              {optLabel(o)}
            </button>
          );
        })}
      </div>
    );
  }
  if (f.type === "member") {
    return (
      <div className="flex flex-wrap gap-2">
        {members.map((m) => {
          const selected = value === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onChange(m.id)}
              className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm transition ${
                selected ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background"
              }`}
            >
              {m.emoji ? `${m.emoji} ` : ""}{m.name}
            </button>
          );
        })}
        {!f.required && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm transition ${
              value == null ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background"
            }`}
          >
            — None —
          </button>
        )}
      </div>
    );
  }
  if (f.type === "select") {
    return (
      <NativeSelect
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select…</option>
        {f.options?.map((o) => (
          <option key={optValue(o)} value={optValue(o)}>{optLabel(o)}</option>
        ))}
      </NativeSelect>
    );
  }
  if (f.type === "property_select") {
    return (
      <NativeSelect
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">— None (not a mortgage) —</option>
        {properties.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </NativeSelect>
    );
  }
  if (f.type === "textarea") {
    return <Textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} rows={3} autoFocus />;
  }
  if (f.money) {
    return <MoneyInput value={value} onChange={onChange} currency={currency} placeholder={f.placeholder} />;
  }
  if (f.type === "number") {
    return <Input inputMode="decimal" value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} autoFocus />;
  }
  if (f.type === "date") {
    return <DateInput value={value} onChange={onChange} className="h-9 w-full" showClear={false} />;
  }
  return <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} autoFocus />;
}

function PropertyCostsStep({ values, onChange, currency }: {
  values: Record<string, any>; onChange: (v: any) => void; currency: string;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Monthly running costs</div>
      <p className="text-xs text-muted-foreground">
        Add up management fees, property tax, fire insurance and maintenance into one combined monthly figure.
        Do not include mortgage/loan payments — add those in the Loans tab.
        You can break this down into individual categories later via "edit full details".
      </p>
      <MoneyInput
        value={values.cost_other}
        onChange={onChange}
        currency={currency}
        placeholder="Combined monthly cost"
      />
    </div>
  );
}
