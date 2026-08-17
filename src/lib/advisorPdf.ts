// Core PDF-construction logic, deliberately written as a pure function that
// takes the pdf-lib module as a parameter rather than importing it directly.
// This means the exact same code path can be exercised in a real local test
// (importing the npm package) and in production (dynamically importing it
// from a CDN, matching this app's existing pattern for docx/exceljs/jszip) —
// there is no separate "test version" to drift out of sync with reality.
//
// Deliberately does NOT include a multi-year lifetime projection chart —
// that calculation needs monthly income, expenses, retirement year, and CPF
// payout assumptions, none of which have ever been scoped, researched, or
// consented to for advisor access anywhere in this feature. Only the already
// -scoped net worth totals are visualized here.

export type AdvisorPdfRecord = {
  category: string;
  record_name: string;
  insurance_category?: string | null;
  premium?: number | null;
  frequency?: string | null;
  sum_assured?: number | null;
  currency?: string | null;
  member_name?: string | null;
  member_id?: string | null;
  end_date?: string | null;
  is_giro?: boolean | null;
  last_updated?: string | null;
  note?: string | null;
};

// Deliberately just {date, label, overdue?} — the caller's alerts.ts engine
// already produced the correct label text ("X — premium due" / "— premium
// overdue"), so this function only ever displays it, never recomputes it.
export type AdvisorPdfUpcomingItem = {
  date: string;
  label: string;
  overdue?: boolean;
  amount?: number | null;
  currency?: string | null;
};

export type AdvisorPdfData = {
  householdName: string;
  // Set when the PDF is for one member's card, not a whole-household view —
  // the FA-side dashboard is now always member-scoped, so this is populated
  // in practice, but stays optional so this function has no hard dependency
  // on that caller.
  memberName?: string | null;
  generatedAt: Date;
  netWorth: {
    totalAssets: number;
    totalLiabilities: number;
    netWorth: number;
    hasData: boolean;
    // "member": genuinely this member's own total. "household-fallback":
    // nothing was individually attributed to this member, so the combined
    // household total is shown instead — must stay visually distinct from
    // "member" so this PDF never implies a number belongs to one person
    // when it doesn't.
    scope?: "member" | "household" | "household-fallback";
    breakdown?: {
      property: number;
      investments: number;
      savings: number;
      otherAssets: number;
      insuranceSurrender: number;
      liabilities: number;
    };
  } | null;
  records: AdvisorPdfRecord[];
  // Pre-computed by the caller via the shared alerts.ts engine (start_date +
  // frequency, not a raw end_date — see the fix note where this used to be
  // derived locally). This function trusts it entirely rather than
  // re-deriving anything from `records`, which is exactly what went wrong
  // before: a second, simpler, WRONG version of the same calculation.
  upcomingPremiums: AdvisorPdfUpcomingItem[];
  staleAfterDays: number;
  // Single source of truth for the "upcoming" window is
  // ADVISOR_ALERT_HORIZON_DAYS in advisorAccess.ts — passed in by the
  // caller rather than hardcoded here a second time, so the badge count on
  // the dashboard and this PDF can never silently drift apart.
  upcomingHorizonDays: number;
  // "N items not shared" disclosure — an FA reading this PDF shouldn't
  // assume it's the complete picture if it isn't. Optional so this type
  // still works for any caller that predates this feature.
  hiddenCounts?: { insurance: number; investments: number };
};

// Mirrors src/lib/format.ts's fmtMoney exactly (SGD keeps "$", every other
// currency shows its 3-letter code instead — deliberately, per that file's
// own comment: a shared "$" across SGD/USD/AUD/HKD/CAD/NZD would be
// silently misleading). Reimplemented here rather than imported, since this
// file is deliberately kept free of other app-module imports (see the note
// at the top of this file) — but the LOGIC still needs to match exactly,
// not just resemble it, or this PDF would show different money formatting
// than the rest of the app for no real reason.
// Shared between the on-screen donut and the PDF donut, so a category is
// always the same color in both places. Order here is also the legend/draw
// order for both renderers.
export const NET_WORTH_CATEGORY_ORDER = [
  "property",
  "investments",
  "savings",
  "otherAssets",
  "insuranceSurrender",
] as const;

export const NET_WORTH_CATEGORY_LABELS: Record<string, string> = {
  property: "Property",
  investments: "Investments",
  savings: "Savings",
  otherAssets: "Other Assets",
  insuranceSurrender: "Insurance (Surrender Value)",
};

export const NET_WORTH_CATEGORY_COLORS: Record<string, [number, number, number]> = {
  property: [0.2, 0.35, 0.6],
  investments: [0.16, 0.55, 0.42],
  savings: [0.78, 0.58, 0.11],
  otherAssets: [0.48, 0.42, 0.68],
  insuranceSurrender: [0.75, 0.45, 0.52],
};

function fmtMoneyForPdf(n: number | null | undefined, currency?: string | null): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const cur = currency || "SGD";
  const prefix = cur === "SGD" ? "$" : cur;
  const abs = Math.abs(Number(n));
  const str =
    abs >= 1_000_000
      ? (Number(n) / 1_000_000).toFixed(2) + "M"
      : Number(n).toLocaleString("en-SG", { maximumFractionDigits: 0 });
  return `${prefix}${str}`;
}

// FREQ_LABEL is the app's own existing frequency-label map (src/lib/options.ts)
// — reused here rather than re-guessing labels, so "monthly" reads the same
// way everywhere in the app, in the PDF included.
const FREQ_LABEL: Record<string, string> = {
  annual: "year",
  "semi-annual": "half-year",
  quarterly: "quarter",
  monthly: "month",
  "one-off": "one-off",
};

// Canonical order copied directly from src/lib/options.ts (INSURANCE_CATEGORIES,
// INVESTMENT_TYPES) — the same order the record-entry forms use, not a fresh
// ordering invented for this view. A protection-gap review groups by TYPE
// (Life, Critical Illness, Disability...), not by insurer brand — provider
// name is still shown as a sub-line per item, just not the grouping key.
const INSURANCE_CATEGORY_ORDER = [
  "Life", "Health", "Critical Illness", "Disability", "Personal Accident",
  "Car", "Home", "Travel", "Mortgage", "Other",
];
const INVESTMENT_TYPE_ORDER = [
  "Unit Trust / Fund", "Exchange Traded Fund (ETF)", "Stocks / Shares",
  "ILP (Investment-Linked Policy)", "Endowment", "Bonds", "REITs",
  "Cryptocurrency", "Cash / Money Market", "SRS", "CPF-OA Investment", "Other",
];

function orderIndex(order: string[], name: string | null | undefined): number {
  const idx = order.indexOf(name ?? "");
  return idx === -1 ? order.length : idx; // unrecognised/blank sorts after every known type
}

export type AdvisorRecordSubgroup = {
  name: string;
  items: AdvisorPdfRecord[];
  // Per-currency, never summed across currencies — a household with both
  // SGD and USD holdings in the same asset class gets two subtotal lines,
  // not one meaningless blended number.
  subtotals: { currency: string; amount: number }[];
};

export type AdvisorCategoryGroup = {
  category: string;
  categoryTitle: string;
  subgroups: AdvisorRecordSubgroup[];
};

// Single source of truth for how records are grouped and ordered — used by
// both this file's PDF renderer and AdvisorHome.tsx's on-screen list, so
// the two can never show a different grouping or a different subtotal for
// the same data.
export function groupAdvisorRecords(records: AdvisorPdfRecord[]): AdvisorCategoryGroup[] {
  const categoryTitles: Record<string, string> = { insurance: "Insurance", investments: "Investments" };
  const categoryOrder = ["insurance", "investments"];

  const byCategory: Record<string, AdvisorPdfRecord[]> = {};
  for (const r of records) (byCategory[r.category] ??= []).push(r);

  return categoryOrder
    .filter((c) => (byCategory[c]?.length ?? 0) > 0)
    .map((category) => {
      const order = category === "insurance" ? INSURANCE_CATEGORY_ORDER : INVESTMENT_TYPE_ORDER;
      const bySubgroup: Record<string, AdvisorPdfRecord[]> = {};
      for (const r of byCategory[category]) {
        (bySubgroup[r.insurance_category ?? "Other"] ??= []).push(r);
      }
      const subgroupNames = Object.keys(bySubgroup).sort(
        (a, b) => orderIndex(order, a) - orderIndex(order, b) || a.localeCompare(b),
      );
      const subgroups = subgroupNames.map((name) => {
        const items = [...bySubgroup[name]].sort((a, b) => {
          if (!a.end_date && !b.end_date) return 0;
          if (!a.end_date) return 1;
          if (!b.end_date) return -1;
          return new Date(a.end_date).getTime() - new Date(b.end_date).getTime();
        });
        // Subtotal is always sum_assured (coverage for insurance, current
        // value for investments — see AdvisorPdfRecord/the view's aliasing)
        // — never the premium. Premium is a recurring cost; sum_assured is
        // "how much coverage/value exists in this category," which is the
        // actual professional question a subtotal here should answer.
        const byCurrency: Record<string, number> = {};
        for (const r of items) {
          if (r.sum_assured == null) continue;
          const currency = r.currency || "SGD";
          byCurrency[currency] = (byCurrency[currency] ?? 0) + r.sum_assured;
        }
        const subtotals = Object.entries(byCurrency).map(([currency, amount]) => ({ currency, amount }));
        return { name, items, subtotals };
      });
      return { category, categoryTitle: categoryTitles[category] ?? category, subgroups };
    });
}

// Exported so AdvisorHome.tsx's on-screen list uses the exact same amount
// formatting as the PDF — one line, frequency inline ("$1,200/month").
// Deliberately never appends an annotation like "(sum assured)" onto the
// number itself — a confusing thing to read from a real report ("goes
// beyond alignment" was the direct symptom of trying that). When there's no
// premium to show, the caller adds a "Sum assured only" tag to the existing
// sub-line instead, which already has working spacing for exactly this.
export function formatAdvisorAmount(r: AdvisorPdfRecord): string {
  if (r.category === "investments") {
    return fmtMoneyForPdf(r.sum_assured, r.currency);
  }
  if (r.premium == null) {
    return fmtMoneyForPdf(r.sum_assured, r.currency);
  }
  const value = fmtMoneyForPdf(r.premium, r.currency);
  const freqLabel = r.frequency ? FREQ_LABEL[r.frequency] : null;
  return freqLabel ? `${value}/${freqLabel}` : value;
}

function truncateToWidth(
  text: string,
  maxWidth: number,
  f: { widthOfTextAtSize(t: string, size: number): number },
  size: number,
): string {
  if (maxWidth <= 0) return "";
  if (f.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1 && f.widthOfTextAtSize(truncated + "…", size) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + "…";
}

function wrapTextToWidth(
  text: string,
  maxWidth: number,
  f: { widthOfTextAtSize(t: string, size: number): number },
  size: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (f.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Verified empirically before use (not assumed) — see the sandbox test that
// caught this: pdf-lib's drawSvgPath applies an internal Y-flip meant for
// embedding normal SVG icons, so raw path coordinates land off-page unless
// Y is negated here, and the arc sweep-flags need inverting to compensate
// for that same flip reversing the arc's rotational direction. First
// attempt with neither fix rendered nothing; second (Y negated, flags not
// inverted) rendered a distorted overlapping shape; this version, checked
// against an actual rasterized render, produces a clean proportional ring.
function wedgePath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startAngle: number,
  endAngle: number,
): string {
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  const p = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(-(cy + r * Math.sin(a))).toFixed(2)}`;
  return [
    `M ${p(rOuter, startAngle)}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 0 ${p(rOuter, endAngle)}`,
    `L ${p(rInner, endAngle)}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 1 ${p(rInner, startAngle)}`,
    "Z",
  ].join(" ");
}

function fmtDateForPdf(d: string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" });
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

// Loaded on demand, exactly like this app's existing docx/exceljs/jszip
// usage in fullExport.ts — never bundled into the base app for users who
// never touch this feature.
export async function generateAndDownloadAdvisorPdf(data: AdvisorPdfData) {
  const pdfLib = await import("https://esm.sh/pdf-lib@1.17.1");
  const bytes = await buildAdvisorPdfBytes(pdfLib, data);
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const namePart = [data.householdName, data.memberName].filter(Boolean).join("-");
  const safeName = namePart.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  downloadBlob(blob, `${safeName}-summary-${data.generatedAt.toISOString().slice(0, 10)}.pdf`);
}

export async function buildAdvisorPdfBytes(pdfLib: any, data: AdvisorPdfData): Promise<Uint8Array> {
  const { PDFDocument, rgb, StandardFonts } = pdfLib;
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const margin = 48;
  const contentWidth = width - margin * 2;

  const colorPrimary = rgb(0.11, 0.25, 0.47);
  const colorMuted = rgb(0.45, 0.45, 0.48);
  const colorUrgent = rgb(0.72, 0.2, 0.15);
  const colorUrgentBg = rgb(0.98, 0.93, 0.92);
  const colorBorder = rgb(0.85, 0.85, 0.87);
  const colorLiability = rgb(0.72, 0.2, 0.15);

  let y = height - margin;

  // Real pagination, replacing the old "Single page for v1" cap that was
  // silently cutting off content — confirmed real incident: a household
  // with enough insurance records could push Investments off the page
  // entirely with no indication anything was missing. newPage() draws a
  // light continuation header so a multi-page PDF still reads as one
  // coherent document handed to a professional, not truncated output that
  // happens to have extra pages tacked on.
  function newPage(): void {
    page = pdfDoc.addPage([595.28, 841.89]);
    y = height - margin;
    const label = `${data.householdName}${data.memberName ? " — " + data.memberName : ""} (continued)`;
    page.drawText(label, { x: margin, y, size: 9, font, color: colorMuted });
    y -= 24;
  }
  function ensureSpace(minY: number): void {
    if (y < minY) newPage();
  }

  // --- Header ---
  page.drawText("FamilyHub SG", { x: margin, y, size: 10, font, color: colorMuted });
  page.drawText(fmtDateForPdf(data.generatedAt.toISOString()), {
    x: width - margin - font.widthOfTextAtSize(fmtDateForPdf(data.generatedAt.toISOString()), 10),
    y,
    size: 10,
    font,
    color: colorMuted,
  });
  y -= 22;
  page.drawText(data.householdName, {
    x: margin,
    y,
    size: 20,
    font: fontBold,
    color: colorPrimary,
  });
  if (data.memberName) {
    y -= 20;
    page.drawText(data.memberName, {
      x: margin,
      y,
      size: 12,
      font,
      color: colorMuted,
    });
  }
  y -= 8;
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 1,
    color: colorBorder,
  });
  y -= 36;

  // --- Net worth focal point: donut, not a bar ---
  if (data.netWorth?.hasData) {
    const isFallback = data.netWorth.scope === "household-fallback";
    const netWorthHeader =
      data.netWorth.scope === "member" && data.memberName
        ? `${data.memberName.toUpperCase()}'S NET WORTH`
        : "HOUSEHOLD NET WORTH (COMBINED)";
    page.drawText(netWorthHeader, { x: margin, y, size: 9, font, color: colorMuted });
    if (isFallback && data.memberName) {
      y -= 12;
      page.drawText(`Nothing yet attributed to ${data.memberName} individually`, {
        x: margin,
        y,
        size: 7.5,
        font,
        color: colorMuted,
      });
    }
    y -= 20;

    const donutSize = 130;
    const rOuter = donutSize / 2;
    const rInner = rOuter * 0.6;
    ensureSpace(donutSize + 30);
    const cx = margin + rOuter;
    const cy = y - rOuter;

    const totalAssets = Math.max(data.netWorth.totalAssets, 0);
    const breakdown = data.netWorth.breakdown;
    const slices = breakdown
      ? NET_WORTH_CATEGORY_ORDER.map((key) => ({ key, value: breakdown[key] ?? 0 })).filter(
          (s) => s.value > 0,
        )
      : [];

    if (totalAssets > 0 && slices.length > 0) {
      let angle = -Math.PI / 2;
      for (const s of slices) {
        const frac = s.value / totalAssets;
        const sweep = frac * 2 * Math.PI;
        const [r, g, b] = NET_WORTH_CATEGORY_COLORS[s.key] ?? [0.5, 0.5, 0.5];
        page.drawSvgPath(wedgePath(cx, cy, rOuter, rInner, angle, angle + sweep), {
          x: 0,
          y: 0,
          color: rgb(r, g, b),
        });
        angle += sweep;
      }
    } else {
      // No category breakdown available (e.g. an older summary shape) —
      // an empty ring keeps the layout identical either way rather than
      // the page jumping around depending on whether this data exists.
      page.drawEllipse({ x: cx, y: cy, xScale: rOuter, yScale: rOuter, color: colorBorder });
      page.drawEllipse({ x: cx, y: cy, xScale: rInner, yScale: rInner, color: rgb(1, 1, 1) });
    }

    // Center KPI — width measured with the actual font used to draw it
    // (fontBold), the exact discipline that was missing in the two earlier
    // alignment bugs this session.
    const netWorthStr = fmtMoneyForPdf(data.netWorth.netWorth, "SGD");
    const centerSize = netWorthStr.length > 10 ? 10 : 12;
    page.drawText(netWorthStr, {
      x: cx - fontBold.widthOfTextAtSize(netWorthStr, centerSize) / 2,
      y: cy - centerSize / 3,
      size: centerSize,
      font: fontBold,
      color: colorPrimary,
    });
    const capLabel = "NET WORTH";
    page.drawText(capLabel, {
      x: cx - font.widthOfTextAtSize(capLabel, 6) / 2,
      y: cy + centerSize / 2 + 4,
      size: 6,
      font,
      color: colorMuted,
    });

    // Legend to the right of the ring.
    //
    // REAL BUG (found Aug 17, 2026, from the user visually inspecting a
    // generated PDF): the color swatch and its label text were drawn from
    // two different y-coordinate conventions that don't mean the same
    // thing in pdf-lib. drawRectangle's `y` is the box's BOTTOM edge; the
    // box (8pt tall) spanned [legendY-7, legendY+1]. drawText's `y` is the
    // text BASELINE — glyphs sit ABOVE that line, so a 9pt label's visible
    // body spanned roughly [legendY, legendY+6.5]. Those two ranges barely
    // overlap, so every swatch sat ~6pt below its own label. Fixed by
    // treating `legendY` as the row's vertical CENTER and deriving both
    // the box position and the text baseline from it, via one shared
    // helper — so box and label can't drift apart again.
    const legendX = margin + donutSize + 24;
    const legendRowHeight = 15;
    const swatchSize = 8;
    let legendY = cy + rOuter - 6;

    function drawLegendRow(
      rowCenterY: number,
      swatchColor: ReturnType<typeof rgb>,
      label: string,
      opts?: { bold?: boolean; textColor?: ReturnType<typeof rgb> },
    ) {
      const size = 9;
      const rowFont = opts?.bold ? fontBold : font;
      page.drawRectangle({
        x: legendX,
        y: rowCenterY - swatchSize / 2,
        width: swatchSize,
        height: swatchSize,
        color: swatchColor,
      });
      page.drawText(label, {
        x: legendX + 14,
        // Baseline sits below the row's visual center by roughly half a
        // Helvetica cap-height (~0.7em), so the glyph body — not the
        // baseline — ends up centered on rowCenterY, matching the swatch.
        y: rowCenterY - size * 0.35,
        size,
        font: rowFont,
        color: opts?.textColor ?? rgb(0.15, 0.15, 0.18),
      });
    }

    for (const s of slices) {
      const [r, g, b] = NET_WORTH_CATEGORY_COLORS[s.key] ?? [0.5, 0.5, 0.5];
      const pct = Math.round((s.value / totalAssets) * 100);
      const label = `${NET_WORTH_CATEGORY_LABELS[s.key] ?? s.key} — ${pct}%`;
      drawLegendRow(legendY, rgb(r, g, b), label);
      legendY -= legendRowHeight;
    }

    // A totals pair — mirrors the on-screen donut's own summary line, and
    // was previously missing here: only Liabilities showed, with no Assets
    // figure alongside it, even though a categorized breakdown alone
    // doesn't make the total obvious at a glance. Both rows use the same
    // swatch+label alignment as the categories above for visual consistency.
    legendY -= 6;
    drawLegendRow(legendY, colorPrimary, `Total Assets: ${fmtMoneyForPdf(totalAssets, "SGD")}`, {
      bold: true,
      textColor: colorPrimary,
    });
    if (data.netWorth.totalLiabilities > 0) {
      legendY -= legendRowHeight;
      drawLegendRow(
        legendY,
        colorLiability,
        `Liabilities: ${fmtMoneyForPdf(data.netWorth.totalLiabilities, "SGD")}`,
        { bold: true, textColor: colorLiability },
      );
    }

    y -= donutSize + 20;
  }

  // --- Upcoming premiums. Previously derived locally from each record's
  // end_date, which is wrong on two counts: end_date is a policy/premium
  // SCHEDULE's end date, not the next amount actually due (that's dynamic —
  // start_date + frequency, rolled forward — computed by alerts.ts), and a
  // missing lower bound on top of that let already-lapsed dates through as
  // "upcoming." Now takes the caller's pre-computed list directly instead
  // of re-deriving anything here — same list the on-screen dashboard box
  // shows, so the two can't disagree.
  const soon = data.upcomingPremiums;
  if (soon.length > 0) {
    const boxHeight = 20 + soon.length * 16;
    ensureSpace(boxHeight + 60); // +60 leaves room below for the itemized section's own header
    page.drawRectangle({
      x: margin,
      y: y - boxHeight,
      width: contentWidth,
      height: boxHeight,
      color: colorUrgentBg,
    });
    let alertY = y - 16;
    // Neutral, not red — the tinted box background already signals "this
    // section is about upcoming premiums." Coloring the header the same
    // red as overdue items made the caption and the urgent content read as
    // one undifferentiated block. Red is now reserved entirely for the
    // OVERDUE badge/text below, where it actually means something.
    page.drawText(`UPCOMING PREMIUMS — NEXT ${data.upcomingHorizonDays} DAYS`, {
      x: margin + 10,
      y: alertY,
      size: 9,
      font: fontBold,
      color: rgb(0.35, 0.35, 0.38),
    });
    alertY -= 16;
    for (const item of soon) {
      let itemX = margin + 10;
      if (item.overdue) {
        const prefix = "OVERDUE — ";
        page.drawText(prefix, { x: itemX, y: alertY, size: 9, font: fontBold, color: colorUrgent });
        itemX += fontBold.widthOfTextAtSize(prefix, 9);
      }
      // Amount was missing entirely before — the box said something was
      // due and when, never how much, which isn't useful to an FA on its
      // own.
      const amountStr = item.amount != null ? fmtMoneyForPdf(item.amount, item.currency) : null;
      const amountWidth = amountStr ? font.widthOfTextAtSize(amountStr, 10) : 0;
      const textMaxWidth = width - margin - 10 - itemX - (amountStr ? amountWidth + 10 : 0);
      const labelText = truncateToWidth(`${item.label} — ${fmtDateForPdf(item.date)}`, textMaxWidth, font, 10);
      // Only genuinely overdue items get red — everything else in this box
      // is upcoming, not urgent, and was previously drawn in the same red
      // as both the header AND overdue items, so nothing stood out from
      // anything else. Reserving the color for what's actually overdue is
      // what makes the badge above mean something.
      page.drawText(labelText, {
        x: itemX,
        y: alertY,
        size: 10,
        font,
        color: item.overdue ? colorUrgent : rgb(0, 0, 0),
      });
      if (amountStr) {
        page.drawText(amountStr, {
          x: width - margin - 10 - amountWidth,
          y: alertY,
          size: 10,
          font,
          color: item.overdue ? colorUrgent : rgb(0, 0, 0),
        });
      }
      alertY -= 16;
    }
    y -= boxHeight + 24;
  }

  // --- Itemized records, grouped by type/asset class (not alphabetically,
  // not by provider) with a subtotal per group — matches how a real
  // protection-gap or portfolio review reads: "how much Critical Illness
  // coverage exists in total," not an alphabetical name list. Uses the same
  // groupAdvisorRecords() the on-screen dashboard list uses, so the two
  // can't show different groupings for the same data.
  const categoryGroups = groupAdvisorRecords(data.records);

  for (const catGroup of categoryGroups) {
    ensureSpace(120);
    page.drawText(catGroup.categoryTitle, {
      x: margin,
      y,
      size: 13,
      font: fontBold,
      color: colorPrimary,
    });
    const hiddenForThisCategory = data.hiddenCounts?.[catGroup.category as "insurance" | "investments"] ?? 0;
    if (hiddenForThisCategory > 0) {
      const disclosureText = `+ ${hiddenForThisCategory} not shared`;
      page.drawText(disclosureText, {
        x: width - margin - font.widthOfTextAtSize(disclosureText, 9),
        y: y + 1,
        size: 9,
        font,
        color: colorMuted,
      });
    }
    y -= 20;

    for (const sub of catGroup.subgroups) {
      ensureSpace(100);
      const columnLabel = catGroup.category === "investments" ? "VALUE" : "PREMIUM";
      page.drawText(sub.name.toUpperCase(), {
        x: margin,
        y,
        size: 9,
        font: fontBold,
        color: colorMuted,
      });
      page.drawText(columnLabel, {
        x: width - margin - fontBold.widthOfTextAtSize(columnLabel, 8),
        y,
        size: 8,
        font: fontBold,
        color: colorMuted,
      });
      y -= 6;
      page.drawLine({
        start: { x: margin, y },
        end: { x: width - margin, y },
        thickness: 0.5,
        color: colorBorder,
      });
      y -= 16;

      for (const r of sub.items) {
        ensureSpace(90);
        const amountStr = formatAdvisorAmount(r);
        // Neither side was ever width-constrained before — a long record
        // name plus a long amount string had no guard against colliding in
        // the middle of the row. Reserving fixed room for the amount side
        // and truncating the name to fit removes that risk outright rather
        // than hoping typical data stays short enough.
        const amountWidth = font.widthOfTextAtSize(amountStr, 10);
        const nameMaxWidth = contentWidth - amountWidth - 16;
        page.drawText(truncateToWidth(r.record_name, nameMaxWidth, font, 10), {
          x: margin,
          y,
          size: 10,
          font,
          color: rgb(0, 0, 0),
        });
        page.drawText(amountStr, {
          x: width - margin - amountWidth,
          y,
          size: 10,
          font,
          color: rgb(0, 0, 0),
        });
        y -= 14; // one line only now — no second (label) line competing for this space
        // "Sum assured only" replaces the old inline "(sum assured)" text
        // that used to clutter the number itself — same information, but
        // as a proper tag in the line that already has working spacing for
        // this, not glued onto a dollar figure.
        const subLine = [
          r.member_id == null ? "Unassigned" : null,
          r.category !== "investments" && r.premium == null ? "Sum assured only" : null,
          r.is_giro ? "GIRO" : null,
        ]
          .filter(Boolean)
          .join(" · ");
        if (subLine) {
          page.drawText(subLine, { x: margin, y, size: 8, font, color: colorMuted });
          y -= 16;
        } else {
          y -= 6;
        }

        // FA's own recommendation for this specific item. Capped at 5
        // wrapped lines (long notes get a trailing "…") so one very long
        // note can't dominate the page — still generous room for a real
        // paragraph, not just a phrase. Space for the WHOLE block is
        // reserved with ensureSpace() before any of it is drawn, so a note
        // can't get split awkwardly across a page break mid-sentence.
        if (r.note) {
          const noteLines = wrapTextToWidth(r.note, contentWidth - 16, font, 9);
          const shown = noteLines.slice(0, 5);
          if (noteLines.length > 5) shown[4] = shown[4].replace(/\s*\S*$/, "") + "…";
          const noteBoxHeight = 16 + shown.length * 13 + 8;
          ensureSpace(noteBoxHeight + 20);
          page.drawRectangle({
            x: margin,
            y: y - noteBoxHeight,
            width: contentWidth,
            height: noteBoxHeight,
            color: rgb(0.95, 0.96, 0.98),
          });
          let noteY = y - 12;
          page.drawText("ADVISER'S NOTE", { x: margin + 8, y: noteY, size: 7, font: fontBold, color: colorPrimary });
          noteY -= 13;
          for (const line of shown) {
            page.drawText(line, { x: margin + 8, y: noteY, size: 9, font, color: rgb(0.15, 0.15, 0.18) });
            noteY -= 13;
          }
          y -= noteBoxHeight + 10;
        }
      }

      const totalLabel = catGroup.category === "investments" ? "Total value" : "Total sum assured";
      for (const st of sub.subtotals) {
        ensureSpace(80);
        const line = `${totalLabel}: ${fmtMoneyForPdf(st.amount, st.currency)}`;
        page.drawText(line, {
          x: width - margin - fontBold.widthOfTextAtSize(line, 9),
          y,
          size: 9,
          font: fontBold,
          color: colorPrimary,
        });
        y -= 14;
      }
      y -= 10;
    }
    y -= 10;
  }

  // Same edge case as the on-screen list: a category with hidden items but
  // zero VISIBLE ones never appears in categoryGroups at all, so without
  // this it would look identical to "no data exists" rather than "data
  // exists but isn't shared."
  const shownCategories = new Set(categoryGroups.map((g) => g.category));
  for (const cat of ["insurance", "investments"] as const) {
    const hiddenCount = data.hiddenCounts?.[cat] ?? 0;
    if (shownCategories.has(cat) || hiddenCount === 0) continue;
    ensureSpace(50);
    page.drawText(cat === "investments" ? "Investments" : "Insurance", {
      x: margin,
      y,
      size: 13,
      font: fontBold,
      color: colorPrimary,
    });
    y -= 18;
    page.drawText(`${hiddenCount} item${hiddenCount === 1 ? "" : "s"} not shared`, {
      x: margin,
      y,
      size: 9,
      font,
      color: colorMuted,
    });
    y -= 24;
  }

  // --- Provenance footer ---
  const footerY = 60;
  page.drawLine({
    start: { x: margin, y: footerY + 14 },
    end: { x: width - margin, y: footerY + 14 },
    thickness: 0.5,
    color: colorBorder,
  });
  const footerText =
    "Figures are self-reported by the client and have not been independently verified. Please confirm key figures with your client before relying on them for advice.";
  page.drawText(footerText, {
    x: margin,
    y: footerY,
    size: 7.5,
    font,
    color: colorMuted,
    maxWidth: contentWidth,
    lineHeight: 10,
  });

  return await pdfDoc.save();
}
