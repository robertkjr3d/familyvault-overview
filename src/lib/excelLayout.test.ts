import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import {
  buildWorkbookBuffer,
  cleanValue,
  columnKind,
  computeLayout,
  displayWidth,
  headerMinWidth,
  resolveNumFmt,
  toLocalWallClock,
  wrapLineCount,
  type SheetSpec,
} from "./excelLayout";

describe("text measuring", () => {
  it("counts emoji as double width and ignores variation selectors", () => {
    expect(displayWidth("Aza")).toBe(3);
    expect(displayWidth("🌟 Aza")).toBe(6);
    expect(displayWidth("☀\uFE0F")).toBe(2);
  });
  it("wraps by words, respects line breaks and breaks over-long words", () => {
    expect(wrapLineCount("one two three", 20)).toBe(1);
    expect(wrapLineCount("one two three", 7)).toBe(2);
    expect(wrapLineCount("a\n\nb", 20)).toBe(3);
    expect(wrapLineCount("x".repeat(100), 30)).toBe(4);
    expect(wrapLineCount("see https://example.com/" + "a".repeat(60), 30)).toBeGreaterThanOrEqual(
      3,
    );
  });
});

describe("cleanValue", () => {
  it("turns empty and blank text into a truly empty cell", () => {
    expect(cleanValue("")).toBeNull();
    expect(cleanValue("   \n ")).toBeNull();
    expect(cleanValue(undefined)).toBeNull();
  });
  it("trims stray spaces and removes characters that corrupt an .xlsx file", () => {
    expect(cleanValue("Echelon ")).toBe("Echelon");
    expect(cleanValue("a\u0001b\u000Bc")).toBe("abc");
    expect(cleanValue("line1\r\nline2")).toBe("line1\nline2");
  });
  it("makes a lone web address a link, but not text that merely contains one", () => {
    expect(cleanValue("https://dcscc.com/login/ ")).toEqual({
      text: "https://dcscc.com/login/",
      hyperlink: "https://dcscc.com/login/",
    });
    expect(cleanValue("see https://x.com")).toBe("see https://x.com");
  });
  it("cuts text that is longer than Excel allows in one cell, and says so", () => {
    const out = cleanValue("x".repeat(40000)) as string;
    expect(out.length).toBeLessThan(32767);
    expect(out).toContain("cut short");
  });
  it("leaves numbers, dates and booleans alone", () => {
    const d = new Date();
    expect(cleanValue(5)).toBe(5);
    expect(cleanValue(d)).toBe(d);
  });
});

describe("number format", () => {
  it("never leaves a trailing dot on whole numbers (the old '#,##0.##' showed '30.')", () => {
    const col = { header: "Loan term", key: "t", numFmt: "#,##0.##" };
    expect(resolveNumFmt(col, [30, 25])).toBe("#,##0");
    expect(resolveNumFmt(col, [2.5, 30])).toBe("#,##0.00");
    expect(resolveNumFmt({ ...col, numFmt: "#,##0.00" }, [1])).toBe("#,##0.00");
  });
  it("shows a local clock time on the right calendar day", () => {
    const d = new Date(2026, 9, 2, 23, 30); // 2 Oct, 11.30pm on the user's own clock
    const w = toLocalWallClock(d);
    expect(w.getUTCFullYear()).toBe(2026);
    expect(w.getUTCMonth()).toBe(9);
    expect(w.getUTCDate()).toBe(2);
    expect(w.getUTCHours()).toBe(23);
  });
});

describe("column and header sizing", () => {
  it("never splits a header word and keeps headers to 3 lines", () => {
    for (const h of [
      "Currency",
      "Surrender value effective from (leave blank if already accessible)",
      "Last Updated In App",
      "Maintenance / repairs (monthly)",
    ]) {
      const w = headerMinWidth(h);
      const longest = Math.max(...h.split(" ").map((x) => x.length));
      expect(w).toBeGreaterThanOrEqual(longest + 4);
      expect(wrapLineCount(h, (w - 2) / 1.1)).toBeLessThanOrEqual(4);
    }
  });
  it("centres short labels and keeps long text left", () => {
    expect(columnKind({ header: "Status", key: "s" }, ["Settled", "Review"])).toBe("center");
    expect(
      columnKind({ header: "Action", key: "a" }, ["Ask the bank about repricing next month"]),
    ).toBe("text");
    expect(columnKind({ header: "Amount", key: "n" }, [1, 2])).toBe("number");
    expect(columnKind({ header: "Date", key: "d" }, [new Date()], "dd mmm yyyy")).toBe("date");
  });
  it("gives dates and money enough room that Excel never shows ####", () => {
    const spec: SheetSpec = {
      name: "T",
      columns: [
        { header: "Start", key: "d", numFmt: "dd mmm yyyy" },
        { header: "Balance", key: "m", numFmt: "#,##0.00" },
      ],
      rows: [{ d: new Date(Date.UTC(2026, 0, 1)), m: 12345678.9 }],
    };
    const L = computeLayout(spec);
    expect(L.columns[0].width).toBeGreaterThanOrEqual(11 + 3);
    expect(L.columns[1].width).toBeGreaterThanOrEqual("12,345,678.90".length + 3);
  });
  it("makes taller rows for wrapped text and never exceeds Excel's row limit", () => {
    const spec: SheetSpec = {
      name: "T",
      columns: [{ header: "Notes", key: "n", wrap: true }],
      rows: [
        { n: "short" },
        { n: Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n") },
        { n: "z\n".repeat(200) },
      ],
    };
    const L = computeLayout(spec);
    expect(L.rowHeights[1]).toBeGreaterThan(L.rowHeights[0] * 5);
    expect(L.rowHeights[2]).toBeLessThanOrEqual(409);
    expect(L.clippedRows).toEqual([4]);
  });
});

async function build(sheets: SheetSpec[], ctx: "standalone" | "backup-zip" = "standalone") {
  const buf = await buildWorkbookBuffer(ExcelJS, JSZip, sheets, ctx);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return { buf, wb };
}

describe("finished workbook", () => {
  const sheets: SheetSpec[] = [
    {
      name: "Savings & CPF",
      columns: [
        { header: "Institution", key: "i" },
        { header: "Owner", key: "o" },
        { header: "Last 4 digits", key: "l" },
        { header: "Hide from advisers", key: "h" },
        { header: "Rate %", key: "r", numFmt: '0.00"%"' },
        { header: "Term (years)", key: "t", numFmt: "#,##0.##" },
        { header: "Link", key: "u" },
        { header: "Notes", key: "n", wrap: true },
        { header: "Updated", key: "d", numFmt: "dd mmm yyyy" },
      ],
      rows: [
        {
          i: "Citibank ",
          o: "🌸 Chay",
          l: "4140",
          h: "No",
          r: 1.5,
          t: 30,
          u: "https://example.com/x",
          n: "a\nb\nc",
          d: new Date(Date.UTC(2026, 9, 2)),
        },
        { i: "UOB", o: "", l: "", h: "Yes", r: null, t: null, u: "", n: "", d: null },
      ],
    },
    { name: "Go-Bag", columns: [{ header: "Item", key: "i" }], rows: [] },
  ];

  it("has a Read Me first, then every sheet, with valid sheet names", async () => {
    const { wb } = await build(sheets);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Read Me", "Savings & CPF", "Go-Bag"]);
  });
  it("styles headers, freezes panes, filters, and sets up printing", async () => {
    const { wb } = await build(sheets);
    const ws = wb.getWorksheet("Savings & CPF")!;
    const h = ws.getCell("A1");
    expect(h.font?.name).toBe("Calibri");
    expect(h.font?.bold).toBe(true);
    expect(h.font?.size).toBe(11);
    expect(ws.autoFilter).toBeTruthy();
    expect(ws.views[0].state).toBe("frozen");
    expect(ws.pageSetup.orientation).toBe("landscape");
    expect(ws.pageSetup.paperSize).toBe(9);
    expect(ws.pageSetup.printTitlesRow).toBe("1:1");
  });
  it("trims text, leaves blanks truly empty, keeps real numbers, dates and links", async () => {
    const { wb } = await build(sheets);
    const ws = wb.getWorksheet("Savings & CPF")!;
    expect(ws.getCell("A2").value).toBe("Citibank");
    expect(ws.getCell("B3").value).toBeNull();
    expect(ws.getCell("E2").value).toBe(1.5);
    expect(ws.getCell("F2").numFmt).toBe("#,##0");
    expect(ws.getCell("I2").value).toBeInstanceOf(Date);
    expect((ws.getCell("G2").value as any).hyperlink).toBe("https://example.com/x");
  });
  it("wraps text cells and aligns them to the top so tall rows read cleanly", async () => {
    const { wb } = await build(sheets);
    const c = wb.getWorksheet("Savings & CPF")!.getCell("H2");
    expect(c.alignment?.wrapText).toBe(true);
    expect(c.alignment?.vertical).toBe("top");
  });
  it("shows an empty sheet as 'No items yet' instead of a blank grid", async () => {
    const { wb } = await build(sheets);
    expect(wb.getWorksheet("Go-Bag")!.getCell("A2").value).toBe("No items yet");
  });
  it("tells Excel not to flag text-that-looks-like-a-number, in a valid position in every sheet", async () => {
    const { buf } = await build(sheets);
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    expect(names.length).toBe(3);
    for (const n of names) {
      const xml = await zip.file(n)!.async("string");
      expect(xml.match(/<ignoredErrors>/g)?.length).toBe(1);
      const after = xml.slice(xml.indexOf("</ignoredErrors>") + 16);
      // only the closing tag (or drawings/tables/extensions) may follow it
      expect(
        after.replace(/<(drawing|legacyDrawing|tableParts|extLst)[\s\S]*$/, "</worksheet>"),
      ).toBe("</worksheet>");
      expect(xml.indexOf("<pageSetup")).toBeLessThan(xml.indexOf("<ignoredErrors>"));
    }
  });
  it("Read Me lists every sheet with its row count, for both export types", async () => {
    for (const ctx of ["standalone", "backup-zip"] as const) {
      const { wb } = await build(sheets, ctx);
      const text: string[] = [];
      wb.getWorksheet("Read Me")!.eachRow((r) => text.push(String(r.getCell(2).value ?? "")));
      expect(text.some((t) => t.startsWith("FamilyHub SG — Full"))).toBe(true);
      expect(text).toContain("Savings & CPF — 2 rows");
      expect(text).toContain("Go-Bag — 0 rows");
    }
  });
  it("keeps the file valid when a cell holds a character Excel forbids", async () => {
    const bad: SheetSpec = {
      name: "T",
      columns: [{ header: "N", key: "n" }],
      rows: [{ n: "ok\u0003still ok" }],
    };
    const { wb } = await build([bad]);
    expect(wb.getWorksheet("T")!.getCell("A2").value).toBe("okstill ok");
  });
});
