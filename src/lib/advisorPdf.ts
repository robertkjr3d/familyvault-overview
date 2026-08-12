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
};

// Deliberately just {date, label, overdue?} — the caller's alerts.ts engine
// already produced the correct label text ("X — premium due" / "— premium
// overdue"), so this function only ever displays it, never recomputes it.
export type AdvisorPdfUpcomingItem = {
  date: string;
  label: string;
  overdue?: boolean;
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
};

// Mirrors src/lib/format.ts's fmtMoney exactly (SGD keeps "$", every other
// currency shows its 3-letter code instead — deliberately, per that file's
// own comment: a shared "$" across SGD/USD/AUD/HKD/CAD/NZD would be
// silently misleading). Reimplemented here rather than imported, since this
// file is deliberately kept free of other app-module imports (see the note
// at the top of this file) — but the LOGIC still needs to match exactly,
// not just resemble it, or this PDF would show different money formatting
// than the rest of the app for no real reason.
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

function fmtAmountForPdf(r: AdvisorPdfRecord): { value: string; label: string } {
  if (r.category === "investments") {
    return { value: fmtMoneyForPdf(r.sum_assured, r.currency), label: "Current value" };
  }
  const amount = r.premium ?? r.sum_assured;
  const value = fmtMoneyForPdf(amount, r.currency);
  if (r.premium == null) return { value, label: "Sum assured" };
  const freqLabel = r.frequency ? FREQ_LABEL[r.frequency] : null;
  return { value, label: freqLabel ? `Premium / ${freqLabel}` : "Premium" };
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
  const colorAsset = rgb(0.2, 0.5, 0.35);
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

  // --- Net worth focal point ---
  if (data.netWorth?.hasData) {
    page.drawText("NET WORTH (COMBINED TOTAL)", { x: margin, y, size: 9, font, color: colorMuted });
    y -= 30;
    const netWorthStr = fmtMoneyForPdf(data.netWorth.netWorth, "SGD");
    page.drawText(netWorthStr, { x: margin, y, size: 34, font: fontBold, color: colorPrimary });
    y -= 26;

    // Simple assets-vs-liabilities bar -- deliberately not a multi-year
    // projection (see file header comment for why).
    const barWidth = contentWidth;
    const barHeight = 14;
    const total = Math.max(data.netWorth.totalAssets, 1);
    const liabilityFraction = Math.min(data.netWorth.totalLiabilities / total, 1);
    page.drawRectangle({
      x: margin,
      y: y - barHeight,
      width: barWidth,
      height: barHeight,
      color: colorAsset,
    });
    if (liabilityFraction > 0) {
      page.drawRectangle({
        x: margin,
        y: y - barHeight,
        width: barWidth * liabilityFraction,
        height: barHeight,
        color: colorLiability,
      });
    }
    y -= barHeight + 14;
    page.drawText(`Assets: ${fmtMoneyForPdf(data.netWorth.totalAssets, "SGD")}`, {
      x: margin,
      y,
      size: 10,
      font,
      color: colorAsset,
    });
    const liabText = `Liabilities: ${fmtMoneyForPdf(data.netWorth.totalLiabilities, "SGD")}`;
    page.drawText(liabText, {
      x: width - margin - font.widthOfTextAtSize(liabText, 10),
      y,
      size: 10,
      font,
      color: colorLiability,
    });
    y -= 34;
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
    page.drawText(`UPCOMING PREMIUMS — NEXT ${data.upcomingHorizonDays} DAYS`, {
      x: margin + 10,
      y: alertY,
      size: 9,
      font: fontBold,
      color: colorUrgent,
    });
    alertY -= 16;
    for (const item of soon) {
      page.drawText(`${item.label} — ${fmtDateForPdf(item.date)}`, {
        x: margin + 10,
        y: alertY,
        size: 10,
        font,
        color: colorUrgent,
      });
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
    y -= 20;

    for (const sub of catGroup.subgroups) {
      ensureSpace(100);
      page.drawText(sub.name.toUpperCase(), {
        x: margin,
        y,
        size: 9,
        font: fontBold,
        color: colorMuted,
      });
      y -= 16;

      for (const r of sub.items) {
        ensureSpace(90);
        const { value: amountStr, label: amountLabel } = fmtAmountForPdf(r);
        page.drawText(r.record_name, { x: margin, y, size: 10, font, color: rgb(0, 0, 0) });
        page.drawText(amountStr, {
          x: width - margin - font.widthOfTextAtSize(amountStr, 10),
          y,
          size: 10,
          font,
          color: rgb(0, 0, 0),
        });
        y -= 11;
        page.drawText(amountLabel, {
          x: width - margin - font.widthOfTextAtSize(amountLabel, 7.5),
          y,
          size: 7.5,
          font,
          color: colorMuted,
        });
        y -= 3;
        // insurance_category is dropped from this sub-line now that it's
        // the subgroup heading above — repeating it per item would be
        // redundant.
        // Every item on this page is either this member's own record or
        // Unassigned — the page is already scoped to one member, so
        // repeating their name on every line was pure redundancy. Only
        // Unassigned is worth flagging, since that's the one case that
        // ISN'T implied by being on this page.
        const subLine = [r.member_id == null ? "Unassigned" : null, r.is_giro ? "GIRO" : null]
          .filter(Boolean)
          .join(" · ");
        if (subLine) {
          page.drawText(subLine, { x: margin, y, size: 8, font, color: colorMuted });
          y -= 14;
        } else {
          y -= 4;
        }
      }

      const totalLabel = catGroup.category === "investments" ? "Total value" : "Total sum assured";
      for (const st of sub.subtotals) {
        ensureSpace(80);
        const line = `${totalLabel}: ${fmtMoneyForPdf(st.amount, st.currency)}`;
        page.drawText(line, {
          x: width - margin - font.widthOfTextAtSize(line, 9),
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
