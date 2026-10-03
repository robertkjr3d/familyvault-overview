import { supabase } from "@/integrations/supabase/client";
import { recordConfigs, type FieldDef, type SelectOption } from "@/lib/recordConfigs";
import type { Member } from "@/hooks/useMembers";
import { getDisplayUrl, getExportUrl } from "@/lib/storageUrls";
import { recurrenceLabel } from "@/lib/reminderRecurrence";
import {
  buildWorkbookBuffer,
  toLocalWallClock,
  type ExportRow,
  type SheetSpec,
} from "@/lib/excelLayout";

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
// household is no longer using FamilyHub SG. The zip export (runFullBackupZip,
// further down in this file) bundles this workbook with the actual files.

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

// Column widths, wrapping, row heights, fonts and print setup are all worked out from the real
// data in excelLayout.ts, so nothing here needs hand-tuned widths.

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
  ctx: { memberNameById: Map<string, string>; propertyNameById: Map<string, string> },
): any {
  if (raw == null || raw === "") return null;
  if (f.type === "member") return ctx.memberNameById.get(raw) ?? raw;
  if (f.type === "property_select") return ctx.propertyNameById.get(raw) ?? raw;
  if (f.type === "boolean") return raw ? "Yes" : "No";
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
  ctx: { memberNameById: Map<string, string>; propertyNameById: Map<string, string> },
): SheetSpec {
  const cfg = recordConfigs[configKey];
  const columns: SheetSpec["columns"] = [
    ...cfg.fields.map((f) => ({
      header: f.label,
      key: f.key,
      numFmt: numFmtFor(f),
    })),
    // Sep 21 2026: the detailed Notes (the rich-text editor inside each card) live in a
    // `notes` column that is NOT one of the form fields above, so they were silently missing
    // from every export. Same for who the follow-up action is assigned to, and the
    // packed/unpacked tick on the travel checklist.
    ...(NOTES_TABLES.has(configKey as string)
      ? [{ header: "Notes", key: "__notes", wrap: true }]
      : []),
    ...(ACTION_OWNER_TABLES.has(configKey as string)
      ? [{ header: "Action owner", key: "__action_owner" }]
      : []),
    ...(configKey === "travel_checklist_items" ? [{ header: "Checked", key: "__checked" }] : []),
    { header: "Status", key: "__status" },
    {
      header: "Last Updated In App",
      key: "__updated_at",
      numFmt: "dd mmm yyyy",
    },
  ];
  const outRows: ExportRow[] = rows.map((r) => {
    const out: ExportRow = {};
    for (const f of cfg.fields) {
      out[f.key] = cellValue(f, r[f.key], ctx);
    }
    if (NOTES_TABLES.has(configKey as string)) out.__notes = notesToPlainText(r.notes);
    if (ACTION_OWNER_TABLES.has(configKey as string)) {
      out.__action_owner = r.action_member_id
        ? (ctx.memberNameById.get(r.action_member_id) ?? null)
        : null;
    }
    if (configKey === "travel_checklist_items") out.__checked = r.checked ? "Yes" : "No";
    out.__status = STATUS_LABEL[r.status] ?? r.status ?? "";
    // Excel has no time zones: store the time on the user's own clock so the day shown is right.
    out.__updated_at = r.updated_at ? toLocalWallClock(new Date(r.updated_at)) : null;
    return out;
  });
  return { name: sheetName, columns, rows: outRows };
}

// Record types whose table has a `notes` column (the rich-text "Notes" editor in each card) /
// an `action_member_id` column (who the follow-up action is assigned to). Static lists so the
// columns appear even on an empty sheet. Checked against a real nightly backup on Sep 21 2026.
const NOTES_TABLES = new Set([
  "properties",
  "loans",
  "insurance_policies",
  "investments",
  "savings_accounts",
  "other_assets",
  "credit_cards",
  "health_conditions",
]);
const ACTION_OWNER_TABLES = new Set([
  "properties",
  "loans",
  "insurance_policies",
  "investments",
  "savings_accounts",
  "other_assets",
  "health_conditions",
]);

function decodeHtmlEntities(s: string): string {
  if (typeof document !== "undefined") {
    const t = document.createElement("textarea");
    t.innerHTML = s;
    return t.value;
  }
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

// Notes are stored as HTML (or plain text on older records). For a spreadsheet cell: keep the
// line breaks and bullets, drop the tags.
function notesToPlainText(value: unknown): string | null {
  if (value == null || value === "") return null;
  let s = String(value);
  if (/<[a-z][\s\S]*>/i.test(s)) {
    s = s
      .replace(/<li[^>]*>/gi, "\u2022 ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|ul|ol)>/gi, "\n")
      .replace(/<[^>]+>/g, "");
    s = decodeHtmlEntities(s);
  }
  s = s
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s || null;
}

// A reminder's time is stored as a moment; the app is Singapore-based, so take the calendar date
// as it is in Singapore (a plain UTC conversion could show the day before for early-morning times).
function singaporeDate(raw: unknown): Date | null {
  if (!raw) return null;
  const d = new Date(String(raw));
  if (isNaN(d.getTime())) return null;
  const parsed = new Date(d.toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" }));
  return isNaN(parsed.getTime()) ? null : parsed;
}

const ACTIVITY_TYPE_LABEL: Record<string, string> = {
  property: "Property",
  loan: "Loan",
  insurance: "Insurance",
  investment: "Investment",
  savings: "Savings & CPF",
  other_asset: "Other Asset",
  credit_card: "Credit Card",
  health: "Health",
  inventory: "Inventory",
};

// The Reminders and Updates sheets (Updates = the record_history table). Both tables point at a record by (entity_type, entity_id), so
// the record's name is looked up from the rows already loaded for the other sheets.
// recordRows: entity type -> that type's rows (records + inventory items).
function buildActivitySheets(args: {
  reminders: any[];
  history: any[];
  recordRows: Record<string, any[]>;
}): SheetSpec[] {
  const nameById = new Map<string, string>();
  for (const [entityType, rows] of Object.entries(args.recordRows)) {
    for (const row of rows) {
      nameById.set(
        row.id,
        entityType === "inventory" ? (row.name ?? "Item") : recordDisplayName(entityType, row),
      );
    }
  }
  const describe = (entityType: string, entityId: string) => ({
    item_type: ACTIVITY_TYPE_LABEL[entityType] ?? entityType ?? "",
    item: nameById.get(entityId) ?? "(item deleted)",
  });

  const reminders = [...args.reminders].sort((a, b) =>
    String(a.remind_at).localeCompare(String(b.remind_at)),
  );
  const history = [...args.history].sort(
    (a, b) =>
      String(b.occurred_on ?? "").localeCompare(String(a.occurred_on ?? "")) ||
      String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
  );

  return [
    {
      name: "Reminders",
      columns: [
        { header: "Item type", key: "item_type" },
        { header: "Item", key: "item" },
        { header: "Reminder", key: "what", wrap: true },
        { header: "Remind on", key: "remind_on", numFmt: "dd mmm yyyy" },
        { header: "Repeats", key: "repeats" },
        { header: "Dismissed", key: "dismissed" },
      ],
      rows: reminders.map((r) => ({
        ...describe(r.entity_type, r.entity_id),
        what: r.what ?? "",
        remind_on: singaporeDate(r.remind_at),
        repeats: recurrenceLabel(r.recurrence, r.recurrence_end_of_month),
        dismissed: r.dismissed ? "Yes" : "No",
      })),
    },
    {
      // Named "Updates" (what the app calls them) - Excel itself reserves the sheet name "History".
      name: "Updates",
      columns: [
        { header: "Item type", key: "item_type" },
        { header: "Item", key: "item" },
        { header: "Date", key: "occurred_on", numFmt: "dd mmm yyyy" },
        { header: "Note", key: "note", wrap: true },
      ],
      rows: history.map((h) => ({
        ...describe(h.entity_type, h.entity_id),
        occurred_on: h.occurred_on ? new Date(h.occurred_on) : null,
        note: h.note ?? "",
      })),
    },
  ];
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
  const memberNameById = new Map(
    members.map((m) => [m.id, `${m.emoji ? m.emoji + " " : ""}${m.name}`]),
  );

  const filter = (q: any) => q.eq("household_id", householdId);

  const tableQueries = FINANCIAL_TABLES.map((t) =>
    filter(supabase.from(t.configKey as any).select("*")),
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
    remindersRes,
    historyRes,
  ] = await Promise.all([
    ...tableQueries,
    filter(supabase.from("inventory_folders").select("*").order("sort_order")),
    filter(supabase.from("inventory_items").select("*").order("name")),
    filter(supabase.from("reminders" as any).select("*")),
    filter(supabase.from("record_history" as any).select("*")),
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
  sheets.push(
    buildRecordSheet(
      "travel_checklist_items",
      "Travel Checklist",
      travelChecklistRes.data ?? [],
      ctx,
    ),
  );

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
  inventoryItems.forEach((it: any) => {
    if (it.photo_url) uniquePhotoPaths.add(it.photo_url);
  });
  const photoUrlEntries = await Promise.all(
    Array.from(uniquePhotoPaths).map(
      async (p) => [p, await getExportUrl("inventory-photos", p)] as const,
    ),
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
      inventoryRows.push({
        location: f.name,
        subfolder: "",
        name: "",
        category: "",
        action: "",
        warranty_date: null,
        photo_url: "",
      });
    }
    directItems.forEach((it: any) => {
      inventoryRows.push({
        location: f.name,
        subfolder: "",
        name: it.name ?? "",
        category: it.category ?? "",
        action: it.action ?? "",
        warranty_date: it.warranty_date ? new Date(it.warranty_date) : null,
        photo_url: photoCell(it.photo_url),
      });
    });
    children.forEach((sf: any) => {
      const subItems = itemsByFolder.get(sf.id) ?? [];
      if (subItems.length === 0) {
        inventoryRows.push({
          location: f.name,
          subfolder: sf.name,
          name: "",
          category: "",
          action: "",
          warranty_date: null,
          photo_url: "",
        });
      }
      subItems.forEach((it: any) => {
        inventoryRows.push({
          location: f.name,
          subfolder: sf.name,
          name: it.name ?? "",
          category: it.category ?? "",
          action: it.action ?? "",
          warranty_date: it.warranty_date ? new Date(it.warranty_date) : null,
          photo_url: photoCell(it.photo_url),
        });
      });
    });
  });
  sheets.push({
    name: "Inventory",
    columns: [
      { header: "Location", key: "location" },
      { header: "Subfolder", key: "subfolder" },
      { header: "Item name", key: "name" },
      { header: "Category", key: "category" },
      { header: "Action / Notes", key: "action" },
      { header: "Warranty / Expiry date", key: "warranty_date", numFmt: "dd mmm yyyy" },
      { header: "Photo (click to open — see Read Me)", key: "photo_url" },
    ],
    rows: inventoryRows,
  });

  sheets.push(
    ...buildActivitySheets({
      reminders: remindersRes.data ?? [],
      history: historyRes.data ?? [],
      recordRows: {
        property: propertiesRes.data ?? [],
        loan: loansRes.data ?? [],
        insurance: insuranceRes.data ?? [],
        investment: investmentsRes.data ?? [],
        savings: savingsRes.data ?? [],
        other_asset: otherAssetsRes.data ?? [],
        credit_card: creditCardsRes.data ?? [],
        health: healthRes.data ?? [],
        inventory: inventoryItems,
      },
    }),
  );
  // Members reference sheet — useful since every other sheet resolves
  // owner/insured/person to a name rather than a raw ID.
  sheets.push({
    name: "Members",
    columns: [
      { header: "Name", key: "name" },
      { header: "Short name", key: "short_name" },
    ],
    rows: members.map((m) => ({
      name: `${m.emoji ? m.emoji + " " : ""}${m.name}`,
      short_name: m.short_name ?? "",
    })),
  });

  const buffer = await writeWorkbook(sheets);
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  downloadBlob(blob, `familyhub-full-export-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

async function writeWorkbook(
  sheets: SheetSpec[],
  context: "standalone" | "backup-zip" = "standalone",
) {
  // Bundled as real dependencies (not fetched at click-time); dynamic imports so Vite code-splits
  // them: they only download when someone actually exports.
  const mod: any = await import("exceljs");
  const ExcelJS = mod.default ?? mod;
  const zipMod: any = await import("jszip");
  const JSZip = zipMod.default ?? zipMod;
  return await buildWorkbookBuffer(ExcelJS, JSZip, sheets, context);
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
  return (s || "untitled")
    .replace(/[\\/:*?"<>|]/g, "-")
    .trim()
    .slice(0, 80);
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
  const memberNameById = new Map(
    members.map((m) => [m.id, `${m.emoji ? m.emoji + " " : ""}${m.name}`]),
  );
  const filter = (q: any) => q.eq("household_id", householdId);

  const tableQueries = FINANCIAL_TABLES.map((t) =>
    filter(supabase.from(t.configKey as any).select("*")),
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
    remindersRes,
    historyRes,
  ] = await Promise.all([
    ...tableQueries,
    filter(supabase.from("inventory_folders").select("*").order("sort_order")),
    filter(supabase.from("inventory_items").select("*").order("name")),
    filter(supabase.from("reminders" as any).select("*")),
    filter(supabase.from("record_history" as any).select("*")),
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
  sheets.push(
    buildRecordSheet(
      "travel_checklist_items",
      "Travel Checklist",
      travelChecklistRes.data ?? [],
      ctx,
    ),
  );

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
      inventoryRows.push({
        location: f.name,
        subfolder: "",
        name: "",
        category: "",
        action: "",
        warranty_date: null,
        photo_url: "",
      });
    }
    directItems.forEach((it: any) => {
      inventoryRows.push({
        location: f.name,
        subfolder: "",
        name: it.name ?? "",
        category: it.category ?? "",
        action: it.action ?? "",
        warranty_date: it.warranty_date ? new Date(it.warranty_date) : null,
        photo_url: it.photo_url ? "(see Inventory Photos folder in this zip)" : "",
      });
    });
    children.forEach((sf: any) => {
      const subItems = itemsByFolder.get(sf.id) ?? [];
      if (subItems.length === 0) {
        inventoryRows.push({
          location: f.name,
          subfolder: sf.name,
          name: "",
          category: "",
          action: "",
          warranty_date: null,
          photo_url: "",
        });
      }
      subItems.forEach((it: any) => {
        inventoryRows.push({
          location: f.name,
          subfolder: sf.name,
          name: it.name ?? "",
          category: it.category ?? "",
          action: it.action ?? "",
          warranty_date: it.warranty_date ? new Date(it.warranty_date) : null,
          photo_url: it.photo_url ? "(see Inventory Photos folder in this zip)" : "",
        });
      });
    });
  });
  sheets.push({
    name: "Inventory",
    columns: [
      { header: "Location", key: "location" },
      { header: "Subfolder", key: "subfolder" },
      { header: "Item name", key: "name" },
      { header: "Category", key: "category" },
      { header: "Action / Notes", key: "action" },
      { header: "Warranty / Expiry date", key: "warranty_date", numFmt: "dd mmm yyyy" },
      { header: "Photo", key: "photo_url" },
    ],
    rows: inventoryRows,
  });
  sheets.push(
    ...buildActivitySheets({
      reminders: remindersRes.data ?? [],
      history: historyRes.data ?? [],
      recordRows: {
        property: propertiesRes.data ?? [],
        loan: loansRes.data ?? [],
        insurance: insuranceRes.data ?? [],
        investment: investmentsRes.data ?? [],
        savings: savingsRes.data ?? [],
        other_asset: otherAssetsRes.data ?? [],
        credit_card: creditCardsRes.data ?? [],
        health: healthRes.data ?? [],
        inventory: inventoryItems,
      },
    }),
  );
  sheets.push({
    name: "Members",
    columns: [
      { header: "Name", key: "name" },
      { header: "Short name", key: "short_name" },
    ],
    rows: members.map((m) => ({
      name: `${m.emoji ? m.emoji + " " : ""}${m.name}`,
      short_name: m.short_name ?? "",
    })),
  });

  const workbookBuffer = await writeWorkbook(sheets, "backup-zip");

  // Sep 22 2026 -- bundled, same reasoning as the ExcelJS import above.
  const zipMod: any = await import("jszip");
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
  const allEntityIds = Object.values(tableResByEntity)
    .flat()
    .map((r: any) => r.id);
  const { data: allDocuments } = allEntityIds.length
    ? await supabase
        .from("record_documents")
        .select("*")
        .in("entity_id", allEntityIds)
        .eq("bucket", "vault-docs")
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
    photoTargets.push({
      path: f.photo_url,
      folderPath: parent ? parent.name : f.name,
      label: f.name,
    });
  });
  inventoryItems.forEach((it: any) => {
    if (!it.photo_url) return;
    const folder = folderById.get(it.folder_id);
    const parent = folder?.parent_id ? folderById.get(folder.parent_id) : null;
    const folderPath = parent ? `${parent.name}/${folder?.name ?? ""}` : (folder?.name ?? "");
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
    while (usedNames.has(name)) {
      name = `${base} (${n})`;
      n++;
    }
    usedNames.add(name);
    return name;
  }

  let missingCount = 0;

  docResults.forEach(({ doc, bytes }) => {
    if (!bytes) {
      missingCount++;
      return;
    }
    const tableConfig = DOCUMENT_ENTITY_TABLES.find((t) => t.entityType === doc.entity_type);
    const rows = tableResByEntity[doc.entity_type] ?? [];
    const record = rows.find((r: any) => r.id === doc.entity_id);
    const recordName = sanitizeForFilename(
      record ? recordDisplayName(doc.entity_type, record) : "Record",
    );
    const ext = extensionFromPath(doc.path);
    const baseLabel = sanitizeForFilename(doc.label || doc.path.split("/").pop() || "document");
    const zipPath = uniqueName(
      `Documents/${tableConfig?.sheetLabel ?? doc.entity_type}/${recordName}/${baseLabel}`,
    );
    zip.file(`${zipPath}.${ext}`, bytes);
  });

  photoResults.forEach(({ target, bytes }) => {
    if (!bytes) {
      missingCount++;
      return;
    }
    const ext = extensionFromPath(target.path);
    const safeFolder = target.folderPath.split("/").map(sanitizeForFilename).join("/");
    const zipPath = uniqueName(
      `Inventory Photos/${safeFolder}/${sanitizeForFilename(target.label)}`,
    );
    zip.file(`${zipPath}.${ext}`, bytes);
  });

  const zipBlob = await zip.generateAsync({ type: "blob" });
  downloadBlob(zipBlob, `familyhub-full-backup-${new Date().toISOString().slice(0, 10)}.zip`);

  return { missingCount, totalFiles: docResults.length + photoResults.length };
}
