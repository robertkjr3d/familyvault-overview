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
  staleAfterDays: number;
  // Single source of truth for the "upcoming" window is
  // ADVISOR_ALERT_HORIZON_DAYS in advisorAccess.ts — passed in by the
  // caller rather than hardcoded here a second time, so the badge count on
  // the dashboard and this PDF can never silently drift apart.
  upcomingHorizonDays: number;
};

function fmtMoneyForPdf(n: number | null | undefined, currency?: string | null): string {
  if (n == null) return "—";
  const rounded = Math.round(n);
  const formatted = rounded.toLocaleString("en-US");
  const code = currency && currency !== "SGD" ? currency : "$";
  return code === "$" ? `$${formatted}` : `${code} ${formatted}`;
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

  const page = pdfDoc.addPage([595.28, 841.89]); // A4
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

  // --- Upcoming alerts, bounded on BOTH ends. The previous version only
  // checked `days <= horizonDays`, so a policy that lapsed over a year ago
  // (a large NEGATIVE days value) also passed and showed up as "upcoming" —
  // confirmed bug, not a display quirk. Requiring days >= 0 as well fixes
  // it. Sorted soonest-first, matching what "upcoming" should mean rather
  // than whatever order the query happened to return.
  const now = Date.now();
  const soon = data.records
    .filter((r) => {
      if (!r.end_date) return false;
      const days = (new Date(r.end_date).getTime() - now) / (1000 * 60 * 60 * 24);
      return days >= 0 && days <= data.upcomingHorizonDays;
    })
    .sort((a, b) => new Date(a.end_date!).getTime() - new Date(b.end_date!).getTime());
  if (soon.length > 0) {
    const boxHeight = 20 + soon.length * 16;
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
    for (const r of soon) {
      page.drawText(`${r.record_name} — due ${fmtDateForPdf(r.end_date)}`, {
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

  // --- Itemized records, no year-by-year breakdown. Sorted chronologically
  // (soonest end date first, undated items last) rather than alphabetically
  // — the query's default alpha-by-name order is fine for lookup, but a
  // premium/renewal list read top-to-bottom should read like a to-do list,
  // not a phone book.
  const byCategory: Record<string, AdvisorPdfRecord[]> = {};
  for (const r of data.records) {
    (byCategory[r.category] ??= []).push(r);
  }
  for (const items of Object.values(byCategory)) {
    items.sort((a, b) => {
      if (!a.end_date && !b.end_date) return 0;
      if (!a.end_date) return 1;
      if (!b.end_date) return -1;
      return new Date(a.end_date).getTime() - new Date(b.end_date).getTime();
    });
  }
  const categoryTitles: Record<string, string> = {
    insurance: "Insurance",
    investments: "Investments",
  };

  for (const [category, items] of Object.entries(byCategory)) {
    if (y < 120) break; // Single page for v1 -- see accompanying note to the user
    page.drawText(categoryTitles[category] ?? category, {
      x: margin,
      y,
      size: 13,
      font: fontBold,
      color: colorPrimary,
    });
    y -= 20;
    for (const r of items) {
      if (y < 100) break;
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
      const subLine = [r.insurance_category, r.member_id == null ? "Unassigned" : r.member_name, r.is_giro ? "GIRO" : null]
        .filter(Boolean)
        .join(" · ");
      if (subLine) {
        page.drawText(subLine, { x: margin, y, size: 8, font, color: colorMuted });
        y -= 14;
      } else {
        y -= 4;
      }
    }
    y -= 16;
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
