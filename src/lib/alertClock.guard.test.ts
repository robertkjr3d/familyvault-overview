import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// These are source-code guards. They exist because of a real bug: the dashboard
// asked the database for reminders using the REAL date while the rest of the app
// used the Test Mode date, so reminders silently went missing. Each guard fails
// with a message saying exactly what to fix.

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(SRC, p), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

describe("alert code uses the app's own 'today', never the raw clock", () => {
  const FILES = [
    "lib/alerts.ts",
    "lib/reminderRecurrence.ts",
    "components/AppHeader.tsx",
    "components/AlertsSheet.tsx",
    "components/RemindersList.tsx",
    "routes/index.tsx",
  ];
  for (const file of FILES) {
    it(`${file} has no raw new Date() / Date.now()`, () => {
      const lines = read(file).split("\n");
      const bad = lines
        .map((line, i) => ({ line, n: i + 1, prev: lines[i - 1] ?? "" }))
        .filter(
          ({ line, prev }) =>
            /new Date\(\)|Date\.now\(\)/.test(line) &&
            !isComment(line) &&
            !line.includes("real-clock-ok") &&
            !prev.includes("real-clock-ok"),
        )
        .map(({ n, line }) => `${file}:${n}: ${line.trim()}`);
      expect(
        bad,
        'Use `const { today } = useToday()` (src/lib/today.ts) so Test Mode works. If a real date is truly intended, add a comment containing "real-clock-ok" on or just above that line.',
      ).toEqual([]);
    });
  }
});

describe("reminders are never date-filtered in the database", () => {
  it("no .lte/.gte/.lt/.gt on remind_at anywhere in src", () => {
    const offenders = walk(SRC)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
      .filter((f) => /\.(lte|gte|lt|gt)\(\s*["']remind_at["']/.test(readFileSync(f, "utf8")))
      .map((f) => f.replace(SRC + "/", ""));
    expect(
      offenders,
      "Load all open reminders and let buildUpcomingItems() apply the window using the app's 'today'.",
    ).toEqual([]);
  });
});

describe("every alert caller passes every alert source", () => {
  const typeBlock = read("lib/alerts.ts").match(/export type AlertSourceData = \{([\s\S]*?)\n\};/);
  const keys = (typeBlock?.[1] ?? "")
    .split("\n")
    .filter((l) => !isComment(l))
    .map((l) => l.match(/^\s+(\w+)\??:/)?.[1])
    .filter((k): k is string => !!k);

  it("found the AlertSourceData keys", () => {
    expect(keys.length).toBeGreaterThanOrEqual(10);
  });

  for (const file of [
    "components/AppHeader.tsx",
    "components/AlertsSheet.tsx",
    "routes/index.tsx",
  ]) {
    it(`${file} passes all ${"AlertSourceData"} keys to buildUpcomingItems`, () => {
      const src = read(file);
      const start = src.indexOf("buildUpcomingItems(\n");
      expect(start, `${file}: call to buildUpcomingItems not found`).toBeGreaterThan(-1);
      const call = src.slice(start, start + 1400);
      const missing = keys.filter((k) => !new RegExp(`\\b${k}\\b`).test(call));
      expect(
        missing,
        "The bell badge (AppHeader), the bell list (AlertsSheet) and the dashboard must all feed the same sources, or their counts drift apart.",
      ).toEqual([]);
    });
  }
});

describe("every reminder-able tab is covered by the tests", () => {
  const COVERED = [
    "insurance",
    "savings",
    "loan",
    "property",
    "investment",
    "inventory",
    "other_asset",
    "credit_card",
    "health",
  ];
  it("every entityType used with RemindersList / ReminderButton is in reminderCoverage.test.ts", () => {
    const used = new Set<string>();
    for (const f of walk(SRC).filter((f) => /\.tsx$/.test(f) && !/\.test\./.test(f))) {
      for (const m of readFileSync(f, "utf8").matchAll(
        /<(?:RemindersList|ReminderButton)[^>]*entityType="(\w+)"/g,
      )) {
        used.add(m[1]);
      }
    }
    const uncovered = [...used].filter((t) => !COVERED.includes(t));
    expect(
      uncovered,
      "Add the new type to TYPES in reminderCoverage.test.ts, to entityLookup and reminderHref in alerts.ts, and to COVERED here.",
    ).toEqual([]);
    expect(used.size).toBeGreaterThanOrEqual(9);
  });
});
