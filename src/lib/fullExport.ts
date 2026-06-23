import { supabase } from "@/integrations/supabase/client";
import { recordConfigs, type FieldDef, type SelectOption } from "@/lib/recordConfigs";
import type { Member } from "@/hooks/useMembers";

// Full household data export — one Excel sheet per record type (Properties,
// Loans, Insurance, Investments, Savings & CPF, Other Assets, Health, Go-Bag,
// Inventory, Members), built from the SAME field definitions the app's own
// forms use (recordConfigs.ts), so headers and the set of columns can never
// drift out of sync with what's actually in the app.
//
// Design goals (per Azariah, 19 Jun 2026 session):
// - Must be directly usable in Excel/Google Sheets — real numbers, real
//   dates, human-readable labels, not raw UUIDs or stringified JSON.
// - One tab per table, easy to delete a tab the household doesn't use.
// - Honest about what's NOT included — see the caveat below and the
//   "Read Me" sheet, which is the first sheet in the workbook.
//
// KNOWN GAP (flagged deliberately, not an oversight): photos and uploaded
// documents (inventory photos, policy documents, history attachments) live
// in Supabase Storage, not in these tables. This export includes the stored
// file *reference* where one exists (e.g. inventory photo URL) but does NOT
// download the actual files. A signed/storage URL may stop working once the
// household is no longer using FamilyVault. True "take my files and leave"
// portability needs a separate zip-of-files export — not built yet.

const STATUS_LABEL: Record<string, string> = {
  urgent: "Urgent",
  review: "Review",
  settled: "Settled",
};

function optValue(o: SelectOption) {
  return typeof o === "string" ? o : o.value;
}
function optLabel(o: SelectOption) {
  return typeof o === "string" ? o : o.label;
}

function resolveSelectLabel(f: FieldDef, raw: any): string {
  if (raw == null || raw === "") return "";
  const opt = f.options?.find((o) => optValue(o) === raw);
  return opt ? optLabel(opt) : String(raw);
}

type ExportRow = Record<string, any>;

type SheetSpec = {
  name: string;
  columns: { header: string; key: string; width: number; numFmt?: string }[];
  rows: ExportRow[];
};

// ─── Column width overrides ────────────────────────────────────────────────────
// The generic widthFor() formula (below) sizes by field type. These overrides
// apply on top of it for specific fields where the formula produces a column
// that's too wide given the actual data (e.g. "Interest rate %" is a short
// 2-decimal number, not a paragraph of text).
//
// Two tiers:
//  SHEET_OVERRIDES[configKey][fieldKey] — sheet-specific (takes precedence)
//  GLOBAL_OVERRIDES[fieldKey]           — applied when no sheet-specific entry
//
// Width units are Excel character widths (≈ 1 character at 11pt Calibri).
// Adjusted by Azariah Jun 2026 session to remove wasted whitespace.

const SHEET_OVERRIDES: Record<string, Record<string, number>> = {
  properties: {
    name: 20,
    member_id: 13,
    purpose: 13,
    currency: 8,
    purchase_price: 12,
    purchase_date: 12,
    current_value: 11,
    mortgage_bank: 12,
    mortgage_balance: 15,
    monthly_payment: 12,
    interest_rate: 6,
    rate_type: 8,
    market_rent: 14,
    cost_management: 14,
    cost_property_tax: 10,
    cost_fire_insurance: 12,
    cost_other_label: 12,
    strategy: 17,
    beneficiary: 12,
  },
  loans: {
    purpose: 8,
    member_id: 9,
    original_amount: 10,
    balance: 13,
    term_years: 9,
    rate: 13,
    rate_label: 8,
    monthly_payment: 13,
    reprice_date: 11,
    property_id: 23,
  },
  insurance_policies: {
    also_covers: 17,
    provider: 12,
    member_id: 11,
    policy_number: 15,
    coverage: 20,
    currency: 8,
    frequency: 16,
    payout_frequency: 15,
    beneficiary: 12,
  },
  savings_accounts: {
    institution: 20,
    member_id: 13,
    joint_member_id: 18,
    account_number: 13,
  },
};

// Applied to any sheet that doesn't have a sheet-specific entry for the field.
// Keeps common fields (currency, interest_rate, last_updated, coverage)
// consistently sized across all tabs without repeating the override on each.
const GLOBAL_OVERRIDES: Record<string, number> = {
  currency: 8,
  interest_rate: 6,
  last_updated: 10,
  coverage: 20,
  beneficiary: 12,
};

// Status and Last Updated columns are appended by buildRecordSheet
// (not driven by recordConfigs), so they get their own constants.
const STATUS_COL_WIDTH = 8;       // "Status": fits "Settled" / "Urgent"
const UPDATED_AT_COL_WIDTH = 16;  // "Last Updated In App": date, no need for 20

function resolvedWidth(f: FieldDef, configKey: string): number {
  return SHEET_OVERRIDES[configKey]?.[f.key]
    ?? GLOBAL_OVERRIDES[f.key]
    ?? widthFor(f);
}

// ─────────────────────────────────────────────────────────────────────────────
// like — not the header text length. A long header like "Current estimated
// value" holds short numbers and shouldn't force a wide column; a short
// header like "Action" holds free-text notes and needs a wide one. The header
// row has text-wrapping turned on (see assembly loop below) so a long header
// on a narrow numeric/date column wraps to two lines instead of being clipped.
function widthFor(f: FieldDef): number {
  const headerLen = f.label.length;
  if (f.money) return clamp(14, headerLen + 2, 18);
  if (f.type === "date") return 14;
  if (f.type === "number") return clamp(10, headerLen + 2, 16);
  if (f.type === "chips") return 30;
  if (f.type === "select" || f.type === "member" || f.type === "property_select") {
    return clamp(16, headerLen + 4, 26);
  }
  // text / textarea — free-form notes are typically the longest actual
  // content in the sheet (e.g. "Action": "Ask UOB for repricing rate May 2026")
  return clamp(30, headerLen + 12, 48);
}

function clamp(min: number, value: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function numFmtFor(f: FieldDef): string | undefined {
  if (f.type === "date") return "dd mmm yyyy";
  if (f.money) return "#,##0.00";
  if (f.type === "number") {
    return f.label.includes("%") ? '0.00"%"' : "#,##0.##";
  }
  return undefined;
}

function cellValue(
  f: FieldDef,
  raw: any,
  ctx: { memberNameById: Map<string, string>; propertyNameById: Map<string, string> }
): any {
  if (raw == null || raw === "") return null;
  if (f.type === "member") return ctx.memberNameById.get(raw) ?? raw;
  if (f.type === "property_select") return ctx.propertyNameById.get(raw) ?? raw;
  if (f.type === "select") return resolveSelectLabel(f, raw);
  if (f.type === "chips") return Array.isArray(raw) ? raw.join("; ") : String(raw);
  if (f.type === "date") {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  if (f.type === "number" || f.money) {
    const n = Number(raw);
    return isNaN(n) ? null : n;
  }
  return raw;
}

function buildRecordSheet(
  configKey: keyof typeof recordConfigs,
  sheetName: string,
  rows: any[],
  ctx: { memberNameById: Map<string, string>; propertyNameById: Map<string, string> }
): SheetSpec {
  const cfg = recordConfigs[configKey];
  const columns = [
    ...cfg.fields.map((f) => ({ header: f.label, key: f.key, width: resolvedWidth(f, configKey), numFmt: numFmtFor(f) })),
    { header: "Status", key: "__status", width: STATUS_COL_WIDTH },
    { header: "Last Updated In App", key: "__updated_at", width: UPDATED_AT_COL_WIDTH, numFmt: "dd mmm yyyy" },
  ];
  const outRows: ExportRow[] = rows.map((r) => {
    const out: ExportRow = {};
    for (const f of cfg.fields) {
      out[f.key] = cellValue(f, r[f.key], ctx);
    }
    out.__status = STATUS_LABEL[r.status] ?? r.status ?? "";
    out.__updated_at = r.updated_at ? new Date(r.updated_at) : null;
    return out;
  });
  return { name: sheetName, columns, rows: outRows };
}

const FINANCIAL_TABLES: { configKey: keyof typeof recordConfigs; sheetName: string }[] = [
  { configKey: "properties", sheetName: "Properties" },
  { configKey: "loans", sheetName: "Loans" },
  { configKey: "insurance_policies", sheetName: "Insurance" },
  { configKey: "investments", sheetName: "Investments" },
  { configKey: "savings_accounts", sheetName: "Savings & CPF" },
  { configKey: "other_assets", sheetName: "Other Assets" },
  { configKey: "health_conditions", sheetName: "Health" },
  { configKey: "gobag_items", sheetName: "Go-Bag" },
];

export async function runFullExport(householdId: string, members: Member[]) {
  const memberNameById = new Map(members.map((m) => [m.id, `${m.emoji ? m.emoji + " " : ""}${m.name}`]));

  const filter = (q: any) => q.eq("household_id", householdId);

  const tableQueries = FINANCIAL_TABLES.map((t) =>
    filter(supabase.from(t.configKey as any).select("*"))
  );

  const [
    propertiesRes,
    loansRes,
    insuranceRes,
    investmentsRes,
    savingsRes,
    otherAssetsRes,
    healthRes,
    gobagRes,
    foldersRes,
    inventoryRes,
  ] = await Promise.all([
    ...tableQueries,
    filter(supabase.from("inventory_folders").select("*")),
    filter(supabase.from("inventory_items").select("*")),
  ]);

  const properties = propertiesRes.data ?? [];
  const propertyNameById = new Map(properties.map((p: any) => [p.id, p.name ?? "Property"]));
  const ctx = { memberNameById, propertyNameById };

  const sheets: SheetSpec[] = [];

  sheets.push(buildRecordSheet("properties", "Properties", properties, ctx));
  sheets.push(buildRecordSheet("loans", "Loans", loansRes.data ?? [], ctx));
  sheets.push(buildRecordSheet("insurance_policies", "Insurance", insuranceRes.data ?? [], ctx));
  sheets.push(buildRecordSheet("investments", "Investments", investmentsRes.data ?? [], ctx));
  sheets.push(buildRecordSheet("savings_accounts", "Savings & CPF", savingsRes.data ?? [], ctx));
  sheets.push(buildRecordSheet("other_assets", "Other Assets", otherAssetsRes.data ?? [], ctx));
  sheets.push(buildRecordSheet("health_conditions", "Health", healthRes.data ?? [], ctx));
  sheets.push(buildRecordSheet("gobag_items", "Go-Bag", gobagRes.data ?? [], ctx));

  // Inventory is hand-built — its forms don't go through recordConfigs.ts,
  // and items are nested inside locations/subfolders rather than being flat
  // records, so it needs its own location-aware flattening (same approach
  // as the inventory tab's own CSV export).
  const folders = foldersRes.data ?? [];
  const folderById = new Map(folders.map((f: any) => [f.id, f]));
  const inventoryItems = inventoryRes.data ?? [];
  const inventoryRows: ExportRow[] = inventoryItems.map((it: any) => {
    const folder = folderById.get(it.folder_id);
    const parent = folder?.parent_id ? folderById.get(folder.parent_id) : null;
    return {
      location: parent ? parent.name : folder?.name ?? "",
      subfolder: parent ? folder?.name ?? "" : "",
      name: it.name ?? "",
      category: it.category ?? "",
      action: it.action ?? "",
      warranty_date: it.warranty_date ? new Date(it.warranty_date) : null,
      photo_url: it.photo_url ?? "",
    };
  });
  sheets.push({
    name: "Inventory",
    columns: [
      { header: "Location", key: "location", width: 20 },
      { header: "Subfolder", key: "subfolder", width: 20 },
      { header: "Item name", key: "name", width: 24 },
      { header: "Category", key: "category", width: 16 },
      { header: "Action / Notes", key: "action", width: 28 },
      { header: "Warranty / Expiry date", key: "warranty_date", width: 20, numFmt: "dd mmm yyyy" },
      { header: "Photo URL (see Read Me)", key: "photo_url", width: 30 },
    ],
    rows: inventoryRows,
  });

  // Members reference sheet — useful since every other sheet resolves
  // owner/insured/person to a name rather than a raw ID.
  sheets.push({
    name: "Members",
    columns: [
      { header: "Name", key: "name", width: 20 },
      { header: "Short name", key: "short_name", width: 16 },
    ],
    rows: members.map((m) => ({ name: `${m.emoji ? m.emoji + " " : ""}${m.name}`, short_name: m.short_name ?? "" })),
  });

  await writeWorkbook(sheets);
}

async function writeWorkbook(sheets: SheetSpec[]) {
  const mod: any = await import("https://esm.sh/exceljs@4.4.0");
  const ExcelJS = mod.default ?? mod;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "FamilyVault";
  workbook.created = new Date();

  // Read Me sheet — first tab, sets expectations honestly.
  const readMe = workbook.addWorksheet("Read Me");
  readMe.columns = [{ width: 100 }];
  const readMeLines = [
    "FamilyVault — Full Data Export",
    `Generated ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`,
    "",
    "What's included: every record from every tab in the app — Properties, Loans, Insurance, Investments,",
    "Savings & CPF, Other Assets, Health, Go-Bag, and Inventory — as one sheet per tab, with names instead",
    "of internal IDs and real numbers/dates you can sort, filter, and calculate with directly in Excel or",
    "Google Sheets.",
    "",
    "What's NOT included: the actual photo and document FILES (e.g. inventory item photos, insurance policy",
    "PDFs). Only their stored web links are included where present (see the Inventory sheet's Photo URL",
    "column). Those links point back to FamilyVault's storage and may stop working if this household",
    "later stops using the app. If you want to keep the actual files long-term, download them individually",
    "from within the app — this spreadsheet is not a substitute for that.",
    "",
    "Each sheet below is safe to delete if you don't need it — they're independent.",
    "",
    "This export is for your own records and is not financial advice.",
  ];
  readMeLines.forEach((line, i) => {
    const row = readMe.getRow(i + 1);
    row.getCell(1).value = line;
    if (i === 0) row.getCell(1).font = { bold: true, size: 14 };
  });

  for (const spec of sheets) {
    const ws = workbook.addWorksheet(spec.name);
    ws.columns = spec.columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };
    ws.getRow(1).alignment = { wrapText: true, vertical: "middle" };
    ws.getRow(1).height = 30;
    ws.views = [{ state: "frozen", ySplit: 1 }];
    if (spec.rows.length > 0) {
      ws.addRows(spec.rows);
    }
    for (const c of spec.columns) {
      if (!c.numFmt) continue;
      const colIdx = ws.getColumn(c.key).number;
      for (let r = 2; r <= spec.rows.length + 1; r++) {
        ws.getCell(r, colIdx).numFmt = c.numFmt;
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `familyvault-full-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
