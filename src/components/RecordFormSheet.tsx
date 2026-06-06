import { useEffect, useState, type KeyboardEvent } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useMembers } from "@/hooks/useMembers";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { recordConfigs, type FieldDef, type SelectOption } from "@/lib/recordConfigs";
import { MoneyInput } from "./MoneyInput";
import { X, Bell } from "lucide-react";
import { addDays, parseISO } from "date-fns";

const ALERT_FIELDS = new Set(["next_due_date", "end_date", "fixed_rate_end", "reprice_date", "maturity_date"]);

export function RecordFormSheet({
  configKey, open, onOpenChange, initial, recordId,
}: {
  configKey: keyof typeof recordConfigs;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Record<string, any>;
  recordId?: string;
}) {
  const cfg = recordConfigs[configKey];
  const isEdit = !!recordId;
  const [values, setValues] = useState<Record<string, any>>(() => seed(cfg.fields, initial));
  const [submitting, setSubmitting] = useState(false);
  const { data: members = [] } = useMembers();
  const qc = useQueryClient();

  useEffect(() => {
    if (open) setValues(seed(cfg.fields, initial));
  }, [open, initial, cfg]);

  function setVal(k: string, v: any) {
    setValues((s) => ({ ...s, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload: Record<string, any> = {};
      for (const f of cfg.fields) {
        let v = values[f.key];
        if (f.type === "chips") {
          payload[f.key] = Array.isArray(v) ? v : [];
          continue;
        }
        if (v === "" || v === undefined) {
          if (isEdit) payload[f.key] = null;
          continue;
        }
        if (v === null) {
          if (isEdit) payload[f.key] = null;
          continue;
        }
        if (f.type === "number" || f.money) {
          const raw = String(v).replace(/,/g, "");
          v = raw === "" ? null : Number(raw);
        }
        payload[f.key] = v;
      }

      if (cfg.table === "savings_accounts" && !payload.group_name) {
        payload.group_name = payload.maturity_date ? "Fixed Deposits" : "Bank Accounts";
      }

      for (const f of cfg.fields) {
        if (f.required && (payload[f.key] === undefined || payload[f.key] === "" || payload[f.key] === null)) {
          toast.error(`${f.label} is required`);
          setSubmitting(false);
          return;
        }
      }

      let savedId = recordId;
      if (isEdit) {
        const { error } = await supabase.from(cfg.table as any).update(payload).eq("id", recordId!);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from(cfg.table as any).insert(payload).select("id").single();
        if (error) throw error;
        savedId = (data as any)?.id;
      }

      if (cfg.table === "savings_accounts" && payload.maturity_date && savedId) {
        try {
          const remindAt = addDays(parseISO(payload.maturity_date), -30);
          await supabase.from("reminders").insert({
            entity_type: "savings",
            entity_id: savedId,
            what: `FD Maturing — ${payload.institution ?? ""} matures on ${payload.maturity_date}.`,
            remind_at: remindAt.toISOString(),
          });
        } catch { /* non-fatal */ }
      }

      toast.success(isEdit ? "Saved" : `${cfg.label} added`);
      qc.invalidateQueries({ queryKey: [cfg.queryKey] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Could not save");
    } finally {
      setSubmitting(false);
    }
  }

  // Prevent Enter key from accidentally submitting form in text inputs
  function handleFormKeyDown(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.key === "Enter") {
      const tag = (e.target as HTMLElement).tagName;
      if (tag !== "TEXTAREA" && tag !== "BUTTON") {
        e.preventDefault();
      }
    }
  }

  // Group fields by section (or "" for ungrouped)
  const sections: { title: string; fields: FieldDef[] }[] = [];
  for (const f of cfg.fields) {
    const title = f.section ?? "";
    let s = sections.find((x) => x.title === title);
    if (!s) { s = { title, fields: [] }; sections.push(s); }
    s.fields.push(f);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92vh] w-full max-w-full overflow-x-hidden overflow-y-auto rounded-t-2xl px-4 pb-2 pt-3"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
        <SheetHeader>
          <SheetTitle className="text-base pr-8">{isEdit ? `Edit ${cfg.label}` : `Add ${cfg.label}`}</SheetTitle>
        </SheetHeader>
        <form onSubmit={submit} onKeyDown={handleFormKeyDown} className="mt-4 space-y-4 pb-4">
          {sections.map((sec, idx) => (
            <div key={idx} className="space-y-3">
              {sec.title && (
                <div className="border-b border-border pb-1.5 pt-1 text-sm font-bold">{sec.title}</div>
              )}
              {sec.fields.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={f.key} className="text-xs">
                    <span className="flex items-center gap-1">
                      {f.label}
                      {ALERT_FIELDS.has(f.key) && <Bell className="h-3 w-3 fill-yellow-500 text-yellow-500" />}
                      {f.required && <span className="text-urgent"> *</span>}
                    </span>
                  </Label>
                  <FieldInput
                    f={f}
                    value={values[f.key]}
                    onChange={(v) => setVal(f.key, v)}
                    members={members}
                    currency={(f.currencyFrom && values[f.currencyFrom]) || "SGD"}
                  />
                </div>
              ))}
            </div>
          ))}
          <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
            <Button type="button" variant="outline" className="flex-1 cursor-pointer" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1 cursor-pointer" disabled={submitting}>
              {submitting ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function optValue(o: SelectOption) { return typeof o === "string" ? o : o.value; }
function optLabel(o: SelectOption) { return typeof o === "string" ? o : o.label; }

function ChipsInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  function add() {
    const t = draft.trim();
    if (!t) return;
    if (!value.includes(t)) onChange([...value, t]);
    setDraft("");
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
    else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background p-1.5">
      {value.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-medium">
          {v}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== v))} className="cursor-pointer rounded-full hover:bg-background/60">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={add}
        placeholder={placeholder || "Type and press Enter…"}
        className="min-w-[120px] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none"
      />
    </div>
  );
}

function FieldInput({ f, value, onChange, members, currency }: {
  f: FieldDef; value: any; onChange: (v: any) => void; members: any[]; currency: string;
}) {
  if (f.type === "chips") {
    const arr: string[] = Array.isArray(value) ? value : [];
    return <ChipsInput value={arr} onChange={onChange} placeholder={f.placeholder} />;
  }
  if (f.type === "textarea") {
    return <Textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} rows={3} />;
  }
  if (f.type === "select") {
    return (
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full cursor-pointer rounded-md border border-input bg-background px-3 text-sm transition focus:border-primary focus:outline-none"
      >
        <option value="">Select…</option>
        {f.options?.map((o) => (
          <option key={optValue(o)} value={optValue(o)}>{optLabel(o)}</option>
        ))}
      </select>
    );
  }
  if (f.type === "member") {
    return (
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-9 w-full cursor-pointer rounded-md border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none"
      >
        <option value="">{f.required ? "Select person…" : "— None —"}</option>
        {members.map((m) => <option key={m.id} value={m.id}>{m.emoji ? `${m.emoji} ` : ""}{m.name}</option>)}
      </select>
    );
  }
  if (f.money) {
    return <MoneyInput value={value} onChange={onChange} currency={currency} placeholder={f.placeholder} />;
  }
  if (f.type === "number") {
    return <Input inputMode="decimal" value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} />;
  }
  if (f.type === "date") {
    const hasDate = value !== "" && value !== null && value !== undefined;
    return (
      <div className="relative flex items-center">
        <Input
          type="date"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-full pr-8"
        />
        {hasDate && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute right-2 flex items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label="Clear date"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }
  return <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} />;
}

function seed(fields: FieldDef[], initial?: Record<string, any>) {
  const v: Record<string, any> = {};
  for (const f of fields) {
    const init = initial?.[f.key];
    if (f.type === "chips") {
      v[f.key] = Array.isArray(init) ? init : (Array.isArray(f.default) ? f.default : []);
    } else if (init !== undefined && init !== null) {
      v[f.key] = init;
    } else if (f.default !== undefined) {
      v[f.key] = f.default;
    } else {
      v[f.key] = "";
    }
  }
  return v;
}
