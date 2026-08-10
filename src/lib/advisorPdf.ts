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
  sum_assured?: number | null;
  currency?: string | null;
  member_name?: string | null;
  end_date?: string | null;
  is_giro?: boolean | null;
  last_updated?: string | null;
};

export type AdvisorPdfData = {
  householdName: string;
  generatedAt: Date;
  netWorth: {
    totalAssets: number;
    totalLiabilities: number;
    netWorth: number;
    hasData: boolean;
  } | null;
  records: AdvisorPdfRecord[];
  staleAfterDays: number;
};

function fmtMoneyForPdf(n: number | null | undefined, currency?: string | null): string {
  if (n == null) return "—";
  const rounded = Math.round(n);
  const formatted = rounded.toLocaleString("en-US");
  const code = currency && currency !== "SGD" ? currency : "$";
  return code === "$" ? `$${formatted}` : `${code} ${formatted}`;
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
  const safeName = data.householdName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
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

  // --- Upcoming alerts (30-day horizon, computed by the caller) ---
  const now = Date.now();
  const soon = data.records.filter((r) => {
    if (!r.end_date) return false;
    const days = (new Date(r.end_date).getTime() - now) / (1000 * 60 * 60 * 24);
    return days <= 30;
  });
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
    page.drawText("UPCOMING", {
      x: margin + 10,
      y: alertY,
      size: 9,
      font: fontBold,
      color: colorUrgent,
    });
    alertY -= 16;
    for (const r of soon) {
      page.drawText(`${r.record_name} — ${fmtDateForPdf(r.end_date)}`, {
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

  // --- Itemized records, no year-by-year breakdown ---
  const byCategory: Record<string, AdvisorPdfRecord[]> = {};
  for (const r of data.records) {
    (byCategory[r.category] ??= []).push(r);
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
      const amount = category === "investments" ? r.sum_assured : (r.premium ?? r.sum_assured);
      page.drawText(r.record_name, { x: margin, y, size: 10, font, color: rgb(0, 0, 0) });
      const amountStr = fmtMoneyForPdf(amount, r.currency);
      page.drawText(amountStr, {
        x: width - margin - font.widthOfTextAtSize(amountStr, 10),
        y,
        size: 10,
        font,
        color: rgb(0, 0, 0),
      });
      y -= 14;
      const subLine = [r.insurance_category, r.member_name, r.is_giro ? "GIRO" : null]
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
