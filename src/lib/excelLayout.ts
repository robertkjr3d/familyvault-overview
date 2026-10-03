// Layout + styling for the full-data Excel export (used by fullExport.ts).
//
// Why this file exists: the old export sized columns from the data only, left most
// text un-wrapped (so long text was cut off whenever the next cell had content), let
// header rows wrap to 5-6 lines and clip, showed booleans as TRUE/FALSE, showed whole
// numbers as "30." (the "#,##0.##" format), stored empty text as "" cells, and had no
// print setup. Everything here is pure (no database, no browser) so it can be tested.

export type ExportColumn = {
  header: string;
  key: string;
  numFmt?: string;
  /** Long free text (Notes, Reminder, Update note): wider column, wraps. */
  wrap?: boolean;
};
export type ExportRow = Record<string, any>;
export type SheetSpec = { name: string; columns: ExportColumn[]; rows: ExportRow[] };

// ─── Tunables ──────────────────────────────────────────────────────────────────
const FONT_NAME = "Calibri";
const FONT_SIZE = 11;
const LINE_PT = 15; // height of one text line at 11pt
const ROW_PAD_PT = 6; // breathing room above/below the text in a row
const MIN_ROW_PT = 21;
const MAX_ROW_PT = 409; // Excel's hard maximum row height is 409.5pt
const MAX_CELL_CHARS = 32000; // Excel's hard limit is 32,767 characters per cell
const MAX_URL_CHARS = 2000; // Excel's hard limit for a hyperlink is 2,079 characters
const MIN_COL = 10;
const TEXT_CAP = 45;
const NOTES_MIN = 30;
const NOTES_CAP = 70;
const HEADER_MAX_LINES = 3;
const DATE_FMT = "dd mmm yyyy";

// ─── Text measuring ────────────────────────────────────────────────────────────

/** Rough on-screen width of a string in "character widths": emoji and CJK count double. */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) continue; // joiners / variation selectors
    if (cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0x2e80 && cp <= 0xffef)) w += 2;
    else w += 1;
  }
  return w;
}

/** How many lines `text` takes when wrapped inside `widthChars` (explicit line breaks respected). */
export function wrapLineCount(text: string, widthChars: number): number {
  const limit = Math.max(1, Math.floor(widthChars));
  let total = 0;
  for (const para of text.split("\n")) {
    if (para.trim() === "") {
      total += 1;
      continue;
    }
    let lines = 1;
    let used = 0;
    for (const word of para.split(/ +/)) {
      if (word === "") continue;
      const len = displayWidth(word);
      if (len > limit) {
        // a word longer than the column (a URL, say) is broken at the cell edge
        if (used > 0) lines += 1;
        lines += Math.ceil(len / limit) - 1;
        used = len % limit || limit;
        continue;
      }
      if (used === 0) used = len;
      else if (used + 1 + len <= limit) used += 1 + len;
      else {
        lines += 1;
        used = len;
      }
    }
    total += lines;
  }
  return total;
}

function cellText(v: any): string {
  if (v == null) return "";
  if (v instanceof Date) return "";
  if (typeof v === "object" && typeof v.text === "string") return v.text;
  return String(v);
}

function longestLine(s: string): number {
  return s.split("\n").reduce((m, l) => Math.max(m, displayWidth(l)), 0);
}

// ─── Value clean-up ────────────────────────────────────────────────────────────

// Characters that are not allowed in an .xlsx file at all (they make Excel report the file as corrupt).
// eslint-disable-next-line no-control-regex
const ILLEGAL_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
const URL_ONLY = /^https?:\/\/\S+$/i;

/** Empty text becomes a truly empty cell; text is trimmed, made file-safe, and a lone URL becomes a link. */
export function cleanValue(v: any): any {
  if (v == null) return null;
  if (typeof v !== "string") return v;
  let s = v.replace(ILLEGAL_XML, "").replace(/\r\n?/g, "\n").trim();
  if (s === "") return null;
  if (s.length > MAX_CELL_CHARS) {
    s =
      s.slice(0, MAX_CELL_CHARS) +
      "\n… [cut short for Excel's cell limit — the full text is in the app]";
  }
  if (URL_ONLY.test(s) && s.length <= MAX_URL_CHARS) return { text: s, hyperlink: s };
  return s;
}

/** A timestamp as the wall-clock time on the user's own clock, so Excel (which has no time zones) shows the right day. */
export function toLocalWallClock(d: Date): Date {
  return new Date(
    Date.UTC(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours(),
      d.getMinutes(),
      d.getSeconds(),
    ),
  );
}

// ─── Column analysis ───────────────────────────────────────────────────────────

export type ColumnKind = "date" | "number" | "center" | "text";

/** "#,##0.##" shows whole numbers as "30." in Excel; use whole-number or 2-decimal formats instead. */
export function resolveNumFmt(col: ExportColumn, values: any[]): string | undefined {
  if (col.numFmt !== "#,##0.##") return col.numFmt;
  const nums = values.filter((v) => typeof v === "number");
  return nums.every((n) => Number.isInteger(n)) ? "#,##0" : "#,##0.00";
}

function formattedLength(v: number, numFmt?: string): number {
  if (numFmt === "#,##0.00") {
    return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).length;
  }
  if (numFmt === "#,##0") return v.toLocaleString("en-US", { maximumFractionDigits: 0 }).length;
  if (numFmt === '0.00"%"') return `${v.toFixed(2)}%`.length;
  return String(v).length;
}

export function columnKind(col: ExportColumn, values: any[], numFmt?: string): ColumnKind {
  if (numFmt === DATE_FMT || values.some((v) => v instanceof Date)) return "date";
  if (values.some((v) => typeof v === "number")) return "number";
  if (col.wrap) return "text";
  const texts = values.map(cellText).filter((t) => t !== "");
  // short labels (Currency, Status, Yes/No, Short name) look tidier centred
  if (texts.length > 0 && texts.every((t) => !t.includes("\n") && displayWidth(t) <= 12)) {
    return "center";
  }
  return "text";
}

/** Smallest width at which the header wraps onto at most 3 lines without splitting a word. */
export function headerMinWidth(header: string): number {
  const BOLD = 1.1;
  const longestWord = header.split(/\s+/).reduce((m, w) => Math.max(m, displayWidth(w)), 0);
  const total = displayWidth(header);
  const forLines = Math.ceil((total * BOLD) / HEADER_MAX_LINES) + 3;
  return Math.max(MIN_COL, Math.ceil(longestWord * BOLD) + 4, forLines); // +4: room for the filter button
}

/** Characters of ordinary text that fit on one line of a column of this width (indent + padding taken off). */
export function bodyCharsPerLine(width: number): number {
  return Math.max(1, Math.floor((width - 2) * 1.08));
}

export type ColumnLayout = { width: number; kind: ColumnKind; numFmt?: string };
export type SheetLayout = {
  columns: ColumnLayout[];
  headerHeight: number;
  rowHeights: number[];
  /** Rows whose text is taller than Excel's 409pt row limit (the text is still in the cell). */
  clippedRows: number[];
};

export function computeLayout(spec: SheetSpec): SheetLayout {
  const cols: ColumnLayout[] = spec.columns.map((c) => {
    const values = spec.rows.map((r) => r[c.key]);
    const numFmt = resolveNumFmt(c, values);
    const kind = columnKind(c, values, numFmt);
    const hMin = headerMinWidth(c.header);
    let content = 0;
    for (const v of values) {
      if (v == null) continue;
      if (v instanceof Date) content = Math.max(content, 11);
      else if (typeof v === "number") content = Math.max(content, formattedLength(v, numFmt));
      else content = Math.max(content, longestLine(cellText(v)));
    }
    let width: number;
    if (kind === "date") width = Math.max(14, content + 3, hMin);
    else if (kind === "number") width = Math.max(12, content + 3, hMin);
    else if (kind === "center") width = Math.max(content + 4, hMin);
    else if (c.wrap)
      width = content === 0 ? hMin : Math.min(NOTES_CAP, Math.max(NOTES_MIN, content + 3, hMin));
    else width = Math.min(TEXT_CAP, Math.max(MIN_COL, content + 4, hMin));
    return { width: Math.ceil(width), kind, numFmt };
  });

  // Header: tallest wrapped header (bold text is a little wider).
  let headerLines = 1;
  spec.columns.forEach((c, i) => {
    headerLines = Math.max(headerLines, wrapLineCount(c.header, (cols[i].width - 2) * 0.95));
  });
  const headerHeight = Math.max(30, headerLines * LINE_PT + 10);

  const rowHeights: number[] = [];
  const clippedRows: number[] = [];
  spec.rows.forEach((row, ri) => {
    let lines = 1;
    spec.columns.forEach((c, i) => {
      if (cols[i].kind === "date" || cols[i].kind === "number") return;
      const t = cellText(row[c.key]);
      if (t) lines = Math.max(lines, wrapLineCount(t, bodyCharsPerLine(cols[i].width)));
    });
    const wanted = lines * LINE_PT + ROW_PAD_PT;
    if (wanted > MAX_ROW_PT) clippedRows.push(ri + 2);
    rowHeights.push(Math.min(MAX_ROW_PT, Math.max(MIN_ROW_PT, wanted)));
  });
  return { columns: cols, headerHeight, rowHeights, clippedRows };
}

// ─── Read Me content ───────────────────────────────────────────────────────────

export type ReadMeBlock = { kind: "title" | "subtitle" | "heading" | "para"; text: string };

export function readMeBlocks(context: "standalone" | "backup-zip", today: string): ReadMeBlock[] {
  const common: ReadMeBlock[] = [
    {
      kind: "para",
      text: "Also included: the detailed Notes on each record, plus a Reminders sheet and an Updates sheet (the dated update log).",
    },
    {
      kind: "para",
      text: "Not included: planned one-off cash-flow events, estate checklist ticks, and your projection assumptions (income, growth rates, etc.).",
    },
    {
      kind: "para",
      text: "Very long notes (more than about 25 lines) show only their first part inside the cell, because Excel cannot make a row taller. The full text is still saved in the cell: click it and read it in the formula bar, or open that record in the app.",
    },
    {
      kind: "para",
      text: "Each sheet is safe to delete if you don't need it. They are independent.",
    },
    { kind: "para", text: "This export is for your own records and is not financial advice." },
  ];
  if (context === "backup-zip") {
    return [
      { kind: "title", text: "FamilyHub SG — Full Backup" },
      { kind: "subtitle", text: `Generated ${today}` },
      { kind: "heading", text: "What this is" },
      {
        kind: "para",
        text: 'Every record from every tab in the app, as one sheet per tab, plus the actual photo and document files themselves, included alongside this spreadsheet in the "Documents" and "Inventory Photos" folders of this .zip. This backup is fully self-contained: nothing in it depends on FamilyHub SG, Supabase, or any link ever again.',
      },
      {
        kind: "para",
        text: "The Inventory sheet's Photo column and each record's document links still work too (valid for up to 10 years) as a convenient shortcut, but you don't need them, since the real files are right here.",
      },
      ...common,
    ];
  }
  return [
    { kind: "title", text: "FamilyHub SG — Full Data Export" },
    { kind: "subtitle", text: `Generated ${today}` },
    { kind: "heading", text: "What this is" },
    {
      kind: "para",
      text: "Every record from every tab in the app, as one sheet per tab, with names instead of internal IDs and real numbers and dates you can sort, filter and calculate with directly in Excel or Google Sheets.",
    },
    {
      kind: "para",
      text: "What's NOT included in this version: the actual photo and document FILES (for example inventory photos and insurance policy PDFs). Instead, each has a private link (see the Inventory sheet's Photo column and each record's documents) that opens the real file directly, valid for up to 10 years from when this export was generated. Treat these links like a shared cloud storage link: anyone with the exact link can open it, so avoid forwarding this file to anyone you wouldn't want to have that access.",
    },
    {
      kind: "para",
      text: 'If you would rather have the actual files themselves, with nothing depending on a link or on FamilyHub SG still running, use "Download full backup (.zip)" from Settings → Data instead. It includes this same spreadsheet plus every photo and document as real files.',
    },
    ...common,
  ];
}

// ─── Workbook building ─────────────────────────────────────────────────────────

const NAVY = "FF1F3A5F";
const BORDER_GREY = "FFD0D5DD";
const TAB_COLOURS: Record<string, string> = {
  Properties: "FF1F3A5F",
  Loans: "FF1F3A5F",
  Investments: "FF1F3A5F",
  "Savings & CPF": "FF1F3A5F",
  "Other Assets": "FF1F3A5F",
  Insurance: "FF2E7D6B",
  "Credit Cards": "FF2E7D6B",
  Health: "FF2E7D6B",
  "Go-Bag": "FF8A94A6",
  "Travel Checklist": "FF8A94A6",
  Inventory: "FF8A94A6",
  Reminders: "FFC27C2C",
  Updates: "FFC27C2C",
  Members: "FF8A94A6",
};

const thin = { style: "thin", color: { argb: BORDER_GREY } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

function addReadMe(wb: any, sheets: SheetSpec[], context: "standalone" | "backup-zip") {
  const ws = wb.addWorksheet("Read Me", { properties: { tabColor: { argb: "FF8A94A6" } } });
  ws.views = [{ showGridLines: false }];
  const WIDTH = 110;
  ws.columns = [{ width: 3 }, { width: WIDTH }, { width: 3 }];
  const today = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  let r = 1;
  ws.getRow(r++).height = 10;
  for (const b of readMeBlocks(context, today)) {
    const row = ws.getRow(r++);
    const cell = row.getCell(2);
    cell.value = b.text;
    cell.alignment = { wrapText: true, vertical: "top", horizontal: "left" };
    const lines = wrapLineCount(b.text, (WIDTH - 2) * (b.kind === "title" ? 0.6 : 1.1));
    if (b.kind === "title") {
      cell.font = { name: FONT_NAME, size: 18, bold: true, color: { argb: NAVY } };
      row.height = 30;
    } else if (b.kind === "subtitle") {
      cell.font = { name: FONT_NAME, size: FONT_SIZE, color: { argb: "FF667085" } };
      row.height = 20;
      ws.getRow(r++).height = 8;
    } else if (b.kind === "heading") {
      cell.font = { name: FONT_NAME, size: 13, bold: true, color: { argb: NAVY } };
      row.height = 24;
    } else {
      cell.font = { name: FONT_NAME, size: FONT_SIZE };
      row.height = Math.max(20, lines * LINE_PT + 8);
    }
  }
  // Contents list: one line per sheet with its row count. (No jump links: ExcelJS writes internal
  // links in a form that cannot be verified in real Excel, and a broken link is worse than none.)
  ws.getRow(r++).height = 8;
  const h = ws.getRow(r++);
  h.getCell(2).value = "Sheets in this workbook";
  h.getCell(2).font = { name: FONT_NAME, size: 13, bold: true, color: { argb: NAVY } };
  h.height = 24;
  for (const s of sheets) {
    const row = ws.getRow(r++);
    const n = s.rows.length;
    const cell = row.getCell(2);
    cell.value = `${s.name} — ${n} ${n === 1 ? "row" : "rows"}`;
    cell.font = { name: FONT_NAME, size: FONT_SIZE };
    cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    row.height = 19;
  }
  ws.pageSetup = {
    orientation: "portrait",
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.6, right: 0.6, top: 0.7, bottom: 0.7, header: 0.3, footer: 0.3 },
  };
  ws.headerFooter = { oddFooter: "&L&8FamilyHub SG&R&8Page &P of &N" };
}

function addDataSheet(wb: any, spec: SheetSpec) {
  const tab = TAB_COLOURS[spec.name];
  const ws = wb.addWorksheet(
    spec.name,
    tab ? { properties: { tabColor: { argb: tab } } } : undefined,
  );
  const rows = spec.rows.map((row) => {
    const out: ExportRow = {};
    for (const c of spec.columns) out[c.key] = cleanValue(row[c.key]);
    return out;
  });
  const layout = computeLayout({ ...spec, rows });
  const nCols = spec.columns.length;

  // An empty sheet shows a one-line "No items yet" message, so its first column must be wide enough for it.
  if (rows.length === 0) layout.columns[0].width = Math.max(layout.columns[0].width, 16);
  ws.columns = spec.columns.map((c, i) => ({ key: c.key, width: layout.columns[i].width }));

  // Header row
  const header = ws.getRow(1);
  header.height = layout.headerHeight;
  spec.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    const kind = layout.columns[i].kind;
    cell.value = c.header;
    cell.font = { name: FONT_NAME, size: FONT_SIZE, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.border = BORDER;
    cell.alignment = {
      wrapText: true,
      vertical: "middle",
      horizontal: kind === "text" ? "left" : kind === "number" ? "right" : "center",
      indent: kind === "text" || kind === "number" ? 1 : 0,
    };
  });

  // Body rows
  rows.forEach((row, ri) => {
    const xr = ws.getRow(ri + 2);
    xr.height = layout.rowHeights[ri];
    spec.columns.forEach((c, i) => {
      const cell = xr.getCell(i + 1);
      const L = layout.columns[i];
      const v = row[c.key];
      if (v != null) cell.value = v;
      cell.font =
        v && typeof v === "object" && "hyperlink" in v
          ? { name: FONT_NAME, size: FONT_SIZE, color: { argb: "FF1F5FBF" }, underline: true }
          : { name: FONT_NAME, size: FONT_SIZE };
      cell.border = BORDER;
      if (L.numFmt) cell.numFmt = L.numFmt;
      cell.alignment = {
        wrapText: L.kind === "text" || L.kind === "center",
        vertical: "top",
        horizontal: L.kind === "text" ? "left" : L.kind === "number" ? "right" : "center",
        indent: L.kind === "text" || L.kind === "number" ? 1 : 0,
      };
    });
  });

  if (rows.length === 0) {
    const r2 = ws.getRow(2);
    r2.height = MIN_ROW_PT;
    const cell = r2.getCell(1);
    cell.value = "No items yet";
    cell.font = { name: FONT_NAME, size: FONT_SIZE, italic: true, color: { argb: "FF667085" } };
    cell.alignment = { vertical: "top", horizontal: "left", indent: 1 };
  } else {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: nCols } };
  }

  // Freeze the header, and the first column too when the sheet is wide and that column is narrow.
  const freezeFirstCol = nCols > 6 && layout.columns[0].width <= 40;
  ws.views = [
    freezeFirstCol
      ? { state: "frozen", xSplit: 1, ySplit: 1, topLeftCell: "B2", activePane: "bottomRight" }
      : { state: "frozen", ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft" },
  ];

  // Printing: A4 landscape, header row repeated on every page, wide sheets spread over N pages across.
  const totalWidth = layout.columns.reduce((s, c) => s + c.width, 0);
  ws.pageSetup = {
    orientation: "landscape",
    paperSize: 9,
    fitToPage: true,
    fitToWidth: Math.max(1, Math.ceil(totalWidth / 170)),
    fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    printTitlesRow: "1:1",
    ...(freezeFirstCol ? { printTitlesColumn: "A:A" } : {}),
  };
  ws.headerFooter = { oddFooter: `&L&8FamilyHub SG&C&8&A&R&8Page &P of &N` };
}

/**
 * Excel puts a green "number stored as text" triangle on every digit-only text cell
 * (policy numbers, last-4 digits). Those are meant to be text, so tell Excel to ignore it.
 * Edits the saved file; on ANY problem the original file is returned unchanged.
 */
export async function silenceNumberAsTextWarnings(
  JSZipCtor: any,
  buffer: ArrayBuffer,
): Promise<ArrayBuffer> {
  try {
    const zip = await JSZipCtor.loadAsync(buffer);
    const tag =
      '<ignoredErrors><ignoredError sqref="A1:XFD1048576" numberStoredAsText="1"/></ignoredErrors>';
    // Per the file format, <ignoredErrors> comes after the page setup / header-footer / breaks
    // and before drawings, table parts and extensions.
    const before = [
      "<drawing",
      "<legacyDrawing",
      "<picture",
      "<oleObjects",
      "<controls",
      "<tableParts",
      "<extLst",
    ];
    const names = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    for (const name of names) {
      const xml: string = await zip.file(name).async("string");
      if (xml.includes("<ignoredErrors")) continue;
      let at = xml.lastIndexOf("</worksheet>");
      for (const t of before) {
        const i = xml.indexOf(t);
        if (i !== -1 && i < at) at = i;
      }
      if (at < 0) return buffer;
      zip.file(name, xml.slice(0, at) + tag + xml.slice(at));
    }
    return await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
  } catch {
    return buffer;
  }
}

export async function buildWorkbookBuffer(
  ExcelJS: any,
  JSZipCtor: any,
  sheets: SheetSpec[],
  context: "standalone" | "backup-zip" = "standalone",
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "FamilyHub SG";
  wb.lastModifiedBy = "FamilyHub SG";
  wb.title =
    context === "backup-zip" ? "FamilyHub SG — Full Backup" : "FamilyHub SG — Full Data Export";
  wb.created = new Date();
  wb.modified = new Date();
  addReadMe(wb, sheets, context);
  for (const spec of sheets) addDataSheet(wb, spec);
  wb.views = [{ activeTab: 0, firstSheet: 0, visibility: "visible" }];
  const buffer: ArrayBuffer = await wb.xlsx.writeBuffer();
  return await silenceNumberAsTextWarnings(JSZipCtor, buffer);
}
