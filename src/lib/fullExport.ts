import { supabase } from "@/integrations/supabase/client";
import { recordConfigs, type FieldDef, type SelectOption } from "@/lib/recordConfigs";
import type { Member } from "@/hooks/useMembers";
import { getDisplayUrl, getExportUrl } from "@/lib/storageUrls";

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
// household is no longer using FamilyHub SG. True "take my files and leave"
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
    joint_member_id: 18,
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
    surrender_value_last_updated: 10,
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

// Measures how long a value will actually LOOK once Excel renders it with
// the given numFmt — used by the column auto-fit pass below. Mirrors
// numFmtFor()'s exact format strings; if that function's formats ever
// change, this must change with it. Deliberately does NOT rely on
// ExcelJS's cell.text (confirmed by direct testing to ignore numFmt for
// both dates and numbers — see the auto-fit comment in writeWorkbook()).
function measureDisplayLength(value: any, numFmt?: string): number {
  if (value == null || value === "") return 0;
  if (value instanceof Date) {
    // "dd mmm yyyy" always renders as exactly 2-digit day + space + 3-letter
    // month + space + 4-digit year, e.g. "01 Mar 2027" — always 11 chars.
    return 11;
  }
  if (typeof value === "object" && typeof value.text === "string") {
    // ExcelJS hyperlink cell ({ text, hyperlink }) — measure the short
    // display text, not the (often much longer) underlying link.
    return value.text.length;
  }
  if (typeof value === "number") {
    if (numFmt === "#,##0.00") {
      return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).length;
    }
    if (numFmt === '0.00"%"') {
      return `${value.toFixed(2)}%`.length;
    }
    if (numFmt === "#,##0.##") {
      return value.toLocaleString("en-US", { maximumFractionDigits: 2 }).length;
    }
    return String(value).length;
  }
  // Plain text — longest line, so a multi-line note doesn't force a column
  // wide enough to fit the whole note on one line.
  return String(value).split("\n").reduce((m, l) => Math.max(m, l.length), 0);
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
  { configKey: "credit_cards", sheetName: "Credit Cards" },
  { configKey: "health_conditions", sheetName: "Health" },
  { configKey: "gobag_items", sheetName: "Go-Bag" },
  { configKey: "travel_checklist_items", sheetName: "Travel Checklist" },
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
    creditCardsRes,
    healthRes,
    gobagRes,
    travelChecklistRes,
    foldersRes,
    inventoryRes,
  ] = await Promise.all([
    ...tableQueries,
    filter(supabase.from("inventory_folders").select("*").order("sort_order")),
    filter(supabase.from("inventory_items").select("*").order("name")),
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
  sheets.push(buildRecordSheet("credit_cards", "Credit Cards", creditCardsRes.data ?? [], ctx));
  sheets.push(buildRecordSheet("health_conditions", "Health", healthRes.data ?? [], ctx));
  sheets.push(buildRecordSheet("gobag_items", "Go-Bag", gobagRes.data ?? [], ctx));
  sheets.push(buildRecordSheet("travel_checklist_items", "Travel Checklist", travelChecklistRes.data ?? [], ctx));

  // Inventory is hand-built — its forms don't go through recordConfigs.ts,
  // and items are nested inside locations/subfolders rather than being flat
  // records. Walks folders the same way the inventory tab's own CSV export
  // does (July 2026 fix — this used to just flat-map items ignoring folder
  // structure entirely, so nothing was actually grouped by location despite
  // this comment already claiming otherwise): top-level folders in
  // sort_order, each one's direct items, then each subfolder (also in
  // sort_order) and ITS items — including a placeholder row for a folder or
  // subfolder that has no items yet, so empty locations still show up.
  const folders = foldersRes.data ?? [];
  const topLevelFolders = folders.filter((f: any) => f.parent_id === null);
  const childrenByParent = new Map<string, any[]>();
  folders.forEach((f: any) => {
    if (f.parent_id) {
      const arr = childrenByParent.get(f.parent_id) ?? [];
      arr.push(f);
      childrenByParent.set(f.parent_id, arr);
    }
  });
  const inventoryItems = inventoryRes.data ?? [];
  const itemsByFolder = new Map<string, any[]>();
  inventoryItems.forEach((it: any) => {
    const arr = itemsByFolder.get(it.folder_id) ?? [];
    arr.push(it);
    itemsByFolder.set(it.folder_id, arr);
  });

  // photo_url holds a private storage path, not a fetchable link. Resolve
  // every distinct one into a long-lived (10 year) signed link before
  // writing rows, since this workbook is meant to be kept outside the app.
  const uniquePhotoPaths = new Set<string>();
  inventoryItems.forEach((it: any) => { if (it.photo_url) uniquePhotoPaths.add(it.photo_url); });
  const photoUrlEntries = await Promise.all(
    Array.from(uniquePhotoPaths).map(async (p) => [p, await getExportUrl("inventory-photos", p)] as const)
  );
  const photoUrlMap = new Map(photoUrlEntries);
  // Shown as short clickable "Open photo" text instead of the raw signed
  // URL (which can run 100+ characters) — the real link is still fully
  // intact as the cell's hyperlink, just not forcing the column wide.
  const photoCell = (path: string | null | undefined) => {
    const url = path ? photoUrlMap.get(path) : null;
    return url ? { text: "Open photo", hyperlink: url } : "";
  };

  const inventoryRows: ExportRow[] = [];
  topLevelFolders.forEach((f: any) => {
    const directItems = itemsByFolder.get(f.id) ?? [];
    const children = childrenByParent.get(f.id) ?? [];
    if (directItems.length === 0 && children.length === 0) {
      inventoryRows.push({ location: f.name, subfolder: "", name: "", category: "", action: "", warranty_date: null, photo_url: "" });
    }
    directItems.forEach((it: any) => {
      inventoryRows.push({
        location: f.name, subfolder: "", name: it.name ?? "", category: it.category ?? "",
        action: it.action ?? "", warranty_date: it.warranty_date ? new Date(it.warranty_date) : null,
        photo_url: photoCell(it.photo_url),
      });
    });
    children.forEach((sf: any) => {
      const subItems = itemsByFolder.get(sf.id) ?? [];
      if (subItems.length === 0) {
        inventoryRows.push({ location: f.name, subfolder: sf.name, name: "", category: "", action: "", warranty_date: null, photo_url: "" });
      }
      subItems.forEach((it: any) => {
        inventoryRows.push({
          location: f.name, subfolder: sf.name, name: it.name ?? "", category: it.category ?? "",
          action: it.action ?? "", warranty_date: it.warranty_date ? new Date(it.warranty_date) : null,
          photo_url: photoCell(it.photo_url),
        });
      });
    });
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
      { header: "Photo (click to open — see Read Me)", key: "photo_url", width: 30 },
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

  const buffer = await writeWorkbook(sheets);
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  downloadBlob(blob, `familyhub-full-export-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

async function writeWorkbook(sheets: SheetSpec[], context: "standalone" | "backup-zip" = "standalone") {
  const mod: any = await import("https://esm.sh/exceljs@4.4.0");
  const ExcelJS = mod.default ?? mod;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "FamilyHub SG";
  workbook.created = new Date();

  // Read Me sheet — first tab, sets expectations honestly.
  const readMe = workbook.addWorksheet("Read Me");
  readMe.columns = [{ width: 100 }];
  const readMeLines = context === "backup-zip" ? [
    "FamilyHub SG — Full Backup",
    `Generated ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`,
    "",
    "What's included: every record from every tab in the app, as one sheet per tab — plus the actual photo",
    "and document files themselves, included right alongside this spreadsheet in the \"Documents\" and",
    "\"Inventory Photos\" folders of this .zip. This backup is fully self-contained: nothing in it depends on",
    "FamilyHub SG, Supabase, or any link ever again.",
    "",
    "The Inventory sheet's Photo column and each record's document links still work too (valid for up to 10",
    "years), as a convenient shortcut — but you don't need them, since the real files are right here.",
    "",
    "Each sheet below is safe to delete if you don't need it — they're independent.",
    "",
    "This export is for your own records and is not financial advice.",
  ] : [
    "FamilyHub SG — Full Data Export",
    `Generated ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`,
    "",
    "What's included: every record from every tab in the app — Properties, Loans, Insurance, Investments,",
    "Savings & CPF, Other Assets, Health, Go-Bag, and Inventory — as one sheet per tab, with names instead",
    "of internal IDs and real numbers/dates you can sort, filter, and calculate with directly in Excel or",
    "Google Sheets.",
    "",
    "What's NOT included in this version: the actual photo and document FILES (e.g. inventory item photos,",
    "insurance policy PDFs). Instead, each has a private link (see the Inventory sheet's Photo column and",
    "each record's documents) that opens the real file directly, valid for up to 10 years from when this",
    "export was generated. Treat these links like a shared cloud storage link — anyone with the exact link",
    "can open it, so avoid forwarding this file to anyone you wouldn't want to have that access.",
    "",
    "If you'd rather have the actual files themselves, with nothing depending on a link or on FamilyHub SG",
    "still running, use \"Download full backup (.zip)\" from Settings \u2192 Data instead — it includes this same",
    "spreadsheet plus every photo and document as real files.",
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
    // Auto-fit every column to its actual data (added July 2026, per Azariah
    // request — replaces guessing at widths by hand). Measures from the raw
    // row data + each column's numFmt, NOT from ExcelJS's cell.text — tested
    // directly and confirmed cell.text is unreliable for this: it returns
    // the full 63-character Date.toString() for date cells (ignoring numFmt
    // entirely) and the unformatted number for currency cells, which would
    // have forced every single date column to the max-width cap and
    // under-sized every currency column. Deliberately only measures DATA
    // rows, not the header (row 1 already has wrapText + a taller row
    // height, matching the same "long header shouldn't force a wide column"
    // design already established above for widthFor()) — otherwise a long
    // header on a short numeric/date column would widen it right back to
    // the exact problem this replaces. Skips empty sheets — an empty table
    // has nothing to size from, so it keeps its original hand-set width
    // rather than collapsing to the bare minimum.
    if (spec.rows.length > 0) {
      for (const c of spec.columns) {
        let maxLen = 0;
        for (const row of spec.rows) {
          const len = measureDisplayLength(row[c.key], c.numFmt);
          if (len > maxLen) maxLen = len;
        }
        if (maxLen > 0) ws.getColumn(c.key).width = clamp(8, maxLen + 2, 60);
      }
    }
    // Header row height must be set AFTER auto-fit above, since auto-fit can
    // make a column narrower than the fixed-width layout this was originally
    // tuned for — a long header wrapping onto 3+ lines at a narrow column was
    // getting cut off at the old fixed 30pt (added July 2026, same session as
    // auto-fit, to fix that). ~1.1 characters fit per width-unit for bold
    // 11pt text (approximate, deliberately generous — better to leave a
    // little extra blank space than cut a header off again), each wrapped
    // line ~15pt tall.
    let maxHeaderLines = 1;
    for (const c of spec.columns) {
      const width = ws.getColumn(c.key).width ?? c.width;
      const charsPerLine = Math.max(1, Math.floor(width * 1.1));
      const lines = Math.ceil(c.header.length / charsPerLine);
      if (lines > maxHeaderLines) maxHeaderLines = lines;
    }
    ws.getRow(1).height = clamp(30, maxHeaderLines * 15 + 6, 90);
  }

  return await workbook.xlsx.writeBuffer();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Entity types that can have attachments via the Documents feature, mapped
// to the table + display-name logic used for that record type elsewhere in
// the app (insurance.tsx, property.tsx, etc. — see title={...} on each card).
const DOCUMENT_ENTITY_TABLES: { entityType: string; table: string; sheetLabel: string }[] = [
  { entityType: "property", table: "properties", sheetLabel: "Properties" },
  { entityType: "loan", table: "loans", sheetLabel: "Loans" },
  { entityType: "insurance", table: "insurance_policies", sheetLabel: "Insurance" },
  { entityType: "investment", table: "investments", sheetLabel: "Investments" },
  { entityType: "savings", table: "savings_accounts", sheetLabel: "Savings & CPF" },
  { entityType: "other_asset", table: "other_assets", sheetLabel: "Other Assets" },
  { entityType: "credit_card", table: "credit_cards", sheetLabel: "Credit Cards" },
  { entityType: "health", table: "health_conditions", sheetLabel: "Health" },
];

function recordDisplayName(entityType: string, row: any): string {
  switch (entityType) {
    case "loan":
      return `${row.bank ?? "Loan"}${row.purpose ? " - " + row.purpose : ""}`;
    case "savings":
      return `${row.institution ?? "Account"}${row.account_type ? " - " + row.account_type : ""}`;
    default:
      return row.name ?? "Record";
  }
}

function sanitizeForFilename(s: string): string {
  return (s || "untitled").replace(/[\\/:*?"<>|]/g, "-").trim().slice(0, 80);
}

function extensionFromPath(path: string): string {
  const match = path.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1] : "bin";
}

async function fetchBytes(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

/**
 * True "take my files and leave" backup: downloads the actual document and
 * photo bytes (not just links) and bundles them with the same data workbook
 * into a single .zip. Fully self-contained — doesn't depend on FamilyHub SG
 * still running, or on any link still being valid, ever.
 */
export async function runFullBackupZip(householdId: string, members: Member[]) {
  const memberNameById = new Map(members.map((m) => [m.id, `${m.emoji ? m.emoji + " " : ""}${m.name}`]));
  const filter = (q: any) => q.eq("household_id", householdId);

  const tableQueries = FINANCIAL_TABLES.map((t) => filter(supabase.from(t.configKey as any).select("*")));
  const [
    propertiesRes, loansRes, insuranceRes, investmentsRes, savingsRes,
    otherAssetsRes, creditCardsRes, healthRes, gobagRes, travelChecklistRes, foldersRes, inventoryRes,
  ] = await Promise.all([
    ...tableQueries,
    filter(supabase.from("inventory_folders").select("*").order("sort_order")),
    filter(supabase.from("inventory_items").select("*").order("name")),
  ]);

  const properties = propertiesRes.data ?? [];
  const propertyNameById = new Map(properties.map((p: any) => [p.id, p.name ?? "Property"]));
  const ctx = { memberNameById, propertyNameById };

  // Build the exact same workbook as the plain export (same sheets, same
  // logic) — reused inside the zip so the backup is fully self-contained.
  const sheets: SheetSpec[] = [];
  sheets.push(buildRecordSheet("properties", "Properties", properties, ctx));
  sheets.push(buildRecordSheet("loans", "Loans", loansRes.data ?? [], ctx));
  sheets.push(buildRecordSheet("insurance_policies", "Insurance", insuranceRes.data ?? [], ctx));
  sheets.push(buildRecordSheet("investments", "Investments", investmentsRes.data ?? [], ctx));
  sheets.push(buildRecordSheet("savings_accounts", "Savings & CPF", savingsRes.data ?? [], ctx));
  sheets.push(buildRecordSheet("other_assets", "Other Assets", otherAssetsRes.data ?? [], ctx));
  sheets.push(buildRecordSheet("credit_cards", "Credit Cards", creditCardsRes.data ?? [], ctx));
  sheets.push(buildRecordSheet("health_conditions", "Health", healthRes.data ?? [], ctx));
  sheets.push(buildRecordSheet("gobag_items", "Go-Bag", gobagRes.data ?? [], ctx));
  sheets.push(buildRecordSheet("travel_checklist_items", "Travel Checklist", travelChecklistRes.data ?? [], ctx));

  // Walks folders the same way the inventory tab's own CSV export does
  // (July 2026 fix — see the matching fix + comment in runFullExport above
  // for the full explanation; this had the identical bug, duplicated).
  const folders = foldersRes.data ?? [];
  // Also needed further down (by id, not by parent) to organise the actual
  // photo FILES into a matching folder structure inside the zip — keep both
  // maps, each serves a different lookup this function needs.
  const folderById = new Map(folders.map((f: any) => [f.id, f]));
  const topLevelFolders = folders.filter((f: any) => f.parent_id === null);
  const childrenByParent = new Map<string, any[]>();
  folders.forEach((f: any) => {
    if (f.parent_id) {
      const arr = childrenByParent.get(f.parent_id) ?? [];
      arr.push(f);
      childrenByParent.set(f.parent_id, arr);
    }
  });
  const inventoryItems = inventoryRes.data ?? [];
  const itemsByFolder = new Map<string, any[]>();
  inventoryItems.forEach((it: any) => {
    const arr = itemsByFolder.get(it.folder_id) ?? [];
    arr.push(it);
    itemsByFolder.set(it.folder_id, arr);
  });

  const inventoryRows: ExportRow[] = [];
  topLevelFolders.forEach((f: any) => {
    const directItems = itemsByFolder.get(f.id) ?? [];
    const children = childrenByParent.get(f.id) ?? [];
    if (directItems.length === 0 && children.length === 0) {
      inventoryRows.push({ location: f.name, subfolder: "", name: "", category: "", action: "", warranty_date: null, photo_url: "" });
    }
    directItems.forEach((it: any) => {
      inventoryRows.push({
        location: f.name, subfolder: "", name: it.name ?? "", category: it.category ?? "",
        action: it.action ?? "", warranty_date: it.warranty_date ? new Date(it.warranty_date) : null,
        photo_url: it.photo_url ? "(see Inventory Photos folder in this zip)" : "",
      });
    });
    children.forEach((sf: any) => {
      const subItems = itemsByFolder.get(sf.id) ?? [];
      if (subItems.length === 0) {
        inventoryRows.push({ location: f.name, subfolder: sf.name, name: "", category: "", action: "", warranty_date: null, photo_url: "" });
      }
      subItems.forEach((it: any) => {
        inventoryRows.push({
          location: f.name, subfolder: sf.name, name: it.name ?? "", category: it.category ?? "",
          action: it.action ?? "", warranty_date: it.warranty_date ? new Date(it.warranty_date) : null,
          photo_url: it.photo_url ? "(see Inventory Photos folder in this zip)" : "",
        });
      });
    });
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
      { header: "Photo", key: "photo_url", width: 30 },
    ],
    rows: inventoryRows,
  });
  sheets.push({
    name: "Members",
    columns: [
      { header: "Name", key: "name", width: 20 },
      { header: "Short name", key: "short_name", width: 16 },
    ],
    rows: members.map((m) => ({ name: `${m.emoji ? m.emoji + " " : ""}${m.name}`, short_name: m.short_name ?? "" })),
  });

  const workbookBuffer = await writeWorkbook(sheets, "backup-zip");

  const zipMod: any = await import("https://esm.sh/jszip@3.10.1");
  const JSZip = zipMod.default ?? zipMod;
  const zip = new JSZip();
  zip.file(`FamilyHub Export ${new Date().toISOString().slice(0, 10)}.xlsx`, workbookBuffer);

  // Every record's uploaded documents, organised by category/record name.
  const tableResByEntity: Record<string, any[]> = {
    property: properties,
    loan: loansRes.data ?? [],
    insurance: insuranceRes.data ?? [],
    investment: investmentsRes.data ?? [],
    savings: savingsRes.data ?? [],
    other_asset: otherAssetsRes.data ?? [],
    health: healthRes.data ?? [],
  };
  const allEntityIds = Object.values(tableResByEntity).flat().map((r: any) => r.id);
  const { data: allDocuments } = allEntityIds.length
    ? await supabase.from("record_documents").select("*").in("entity_id", allEntityIds).eq("bucket", "vault-docs")
    : { data: [] as any[] };

  const docFetches = (allDocuments ?? []).map(async (doc: any) => {
    const url = await getDisplayUrl("vault-docs", doc.path);
    const bytes = url ? await fetchBytes(url) : null;
    return { doc, bytes };
  });

  // Every inventory photo (folders + items).
  const photoTargets: { path: string; folderPath: string; label: string }[] = [];
  folders.forEach((f: any) => {
    if (!f.photo_url) return;
    const parent = f.parent_id ? folderById.get(f.parent_id) : null;
    photoTargets.push({ path: f.photo_url, folderPath: parent ? parent.name : f.name, label: f.name });
  });
  inventoryItems.forEach((it: any) => {
    if (!it.photo_url) return;
    const folder = folderById.get(it.folder_id);
    const parent = folder?.parent_id ? folderById.get(folder.parent_id) : null;
    const folderPath = parent ? `${parent.name}/${folder?.name ?? ""}` : folder?.name ?? "";
    photoTargets.push({ path: it.photo_url, folderPath, label: it.name ?? "item" });
  });
  const photoFetches = photoTargets.map(async (t) => {
    const url = await getDisplayUrl("inventory-photos", t.path);
    const bytes = url ? await fetchBytes(url) : null;
    return { target: t, bytes };
  });

  const [docResults, photoResults] = await Promise.all([
    Promise.all(docFetches),
    Promise.all(photoFetches),
  ]);

  const usedNames = new Set<string>();
  function uniqueName(base: string): string {
    let name = base;
    let n = 2;
    while (usedNames.has(name)) { name = `${base} (${n})`; n++; }
    usedNames.add(name);
    return name;
  }

  let missingCount = 0;

  docResults.forEach(({ doc, bytes }) => {
    if (!bytes) { missingCount++; return; }
    const tableConfig = DOCUMENT_ENTITY_TABLES.find((t) => t.entityType === doc.entity_type);
    const rows = tableResByEntity[doc.entity_type] ?? [];
    const record = rows.find((r: any) => r.id === doc.entity_id);
    const recordName = sanitizeForFilename(record ? recordDisplayName(doc.entity_type, record) : "Record");
    const ext = extensionFromPath(doc.path);
    const baseLabel = sanitizeForFilename(doc.label || doc.path.split("/").pop() || "document");
    const zipPath = uniqueName(`Documents/${tableConfig?.sheetLabel ?? doc.entity_type}/${recordName}/${baseLabel}`);
    zip.file(`${zipPath}.${ext}`, bytes);
  });

  photoResults.forEach(({ target, bytes }) => {
    if (!bytes) { missingCount++; return; }
    const ext = extensionFromPath(target.path);
    const safeFolder = target.folderPath.split("/").map(sanitizeForFilename).join("/");
    const zipPath = uniqueName(`Inventory Photos/${safeFolder}/${sanitizeForFilename(target.label)}`);
    zip.file(`${zipPath}.${ext}`, bytes);
  });

  const zipBlob = await zip.generateAsync({ type: "blob" });
  downloadBlob(zipBlob, `familyhub-full-backup-${new Date().toISOString().slice(0, 10)}.zip`);

  return { missingCount, totalFiles: docResults.length + photoResults.length };
}
