import { describe, it, expect } from "vitest";
import {
  ARCHIVE_PREFIX,
  FILE_PREFIX,
  MAX_ARCHIVE_PER_RUN,
  MAX_COPIES_PER_RUN,
  STATE_KEY,
  STORAGE_WARN_BYTES,
  planFileBackup,
  planHouseholds,
  r2KeyFor,
  runFileBackup,
  type HouseholdSummary,
  type ManifestEntry,
  type R2BucketForFiles,
  type SyncState,
} from "./fileBackupCron";

// ---- fakes: R2, Supabase, and the network ----------------------------------

const enc = (t: string) => new TextEncoder().encode(t);
const dec = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : undefined);

class FakeR2 implements R2BucketForFiles {
  objects = new Map<string, Uint8Array>();
  puts: string[] = [];
  deletes: string[] = [];
  log: string[] = []; // every put/delete in the order it happened
  failPutsWithPrefix: string | null = null;
  reportWrongSize = false; // R2 acknowledges a write but reports fewer bytes
  async list({ prefix, delimiter }: { prefix: string; delimiter?: string }) {
    const matching = [...this.objects.entries()].filter(([k]) => k.startsWith(prefix));
    if (!delimiter) {
      return {
        objects: matching.map(([key, v]) => ({ key, size: v.byteLength })),
        truncated: false,
      };
    }
    const direct: Array<{ key: string; size: number }> = [];
    const prefixes = new Set<string>();
    for (const [key, v] of matching) {
      const rest = key.slice(prefix.length);
      const i = rest.indexOf(delimiter);
      if (i === -1) direct.push({ key, size: v.byteLength });
      else prefixes.add(prefix + rest.slice(0, i + 1));
    }
    return { objects: direct, delimitedPrefixes: [...prefixes], truncated: false };
  }
  async put(key: string, value: ReadableStream | ArrayBuffer | string) {
    if (this.failPutsWithPrefix && key.startsWith(this.failPutsWithPrefix))
      throw new Error("R2 write refused");
    let data: Uint8Array;
    if (typeof value === "string") data = enc(value);
    else if (value instanceof ArrayBuffer) data = new Uint8Array(value);
    else data = new Uint8Array(await new Response(value).arrayBuffer());
    this.objects.set(key, data);
    this.puts.push(key);
    this.log.push(`put:${key}`);
    return {
      size: this.reportWrongSize && key !== STATE_KEY ? data.byteLength - 1 : data.byteLength,
    };
  }
  async get(key: string) {
    const data = this.objects.get(key);
    if (!data) return null;
    const blob = () =>
      new Blob([
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
      ]);
    return {
      size: data.byteLength,
      body: blob().stream() as ReadableStream,
      text: async () => dec(data) as string,
    };
  }
  async delete(key: string) {
    this.objects.delete(key);
    this.deletes.push(key);
    this.log.push(`delete:${key}`);
  }
  get stateJson(): SyncState | null {
    const raw = this.objects.get(STATE_KEY);
    return raw ? JSON.parse(dec(raw)!) : null;
  }
}

type Db = Record<string, Record<string, string>>; // household -> "bucket/path" -> content
const ID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ID_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ID_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function setup(
  db: Db,
  opts: {
    sizes?: Record<string, number>; // override the size the database reports ("bucket/path")
    broken?: string[]; // downloads that answer 500
    noLink?: string[]; // files whose signed link is refused
    summaryCountLie?: number; // report this row count for the summary
    manifestShort?: boolean; // household file lists come back one row short
  } = {},
) {
  const calls = {
    summary: 0,
    manifest: [] as string[],
    sign: [] as string[],
    downloads: 0,
    outside: 0,
  };
  const sizeOf = (key: string, content: string) => opts.sizes?.[key] ?? enc(content).byteLength;
  const manifestFor = (h: string): ManifestEntry[] =>
    Object.entries(db[h] ?? {})
      .map(([k, content]) => {
        const [bucket_id, ...rest] = k.split("/");
        return { bucket_id, name: `${h}/${rest.join("/")}`, size: sizeOf(k, content) };
      })
      .sort((a, b) => (a.bucket_id + a.name < b.bucket_id + b.name ? -1 : 1));
  const summaryRows = (): HouseholdSummary[] =>
    Object.keys(db)
      .filter((h) => Object.keys(db[h]).length > 0)
      .sort()
      .map((h) => {
        const m = manifestFor(h);
        return {
          household: h,
          files: m.length,
          bytes: m.reduce((n, e) => n + e.size, 0),
          digest: m.map((e) => `${e.bucket_id}/${e.name}:${e.size}`).join("|"),
        };
      });

  const admin = {
    rpc: (fn: string, args: { p_household?: string }) => {
      calls.outside++;
      return {
        range: async (from: number, to: number) => {
          let rows: unknown[];
          const isSummary = fn === "backup_storage_summary";
          if (isSummary) {
            calls.summary++;
            rows = summaryRows();
          } else {
            calls.manifest.push(args.p_household ?? "");
            rows = manifestFor(args.p_household ?? "");
          }
          const total =
            isSummary && opts.summaryCountLie !== undefined ? opts.summaryCountLie : rows.length;
          if (!isSummary && opts.manifestShort) rows = rows.slice(0, -1);
          return { data: rows.slice(from, to + 1), error: null, count: total };
        },
      };
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string) => {
          calls.outside++;
          calls.sign.push(`${bucket}/${path}`);
          if (opts.noLink?.includes(`${bucket}/${path}`))
            return { data: null, error: { message: "object not found" } };
          return { data: { signedUrl: `https://files.test/${bucket}/${path}` }, error: null };
        },
      }),
    },
  };

  const pings: string[] = [];
  const contentOf = (bucketAndName: string): string | undefined => {
    const [bucket, h, ...rest] = bucketAndName.split("/");
    return db[h]?.[`${bucket}/${rest.join("/")}`];
  };
  const fetchFn = (async (input: string, init?: { body?: string }) => {
    calls.outside++;
    if (input.startsWith("https://hc.test/")) {
      pings.push(input.replace("https://hc.test", "") + (init?.body ? ` :: ${init.body}` : ""));
      return new Response("ok");
    }
    calls.downloads++;
    const key = input.replace("https://files.test/", "");
    if (opts.broken?.includes(key)) return new Response("nope", { status: 500 });
    return new Response(contentOf(key) ?? "", {
      headers: { "content-type": "application/octet-stream" },
    });
  }) as unknown as typeof fetch;

  const r2 = new FakeR2();
  const env = {
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key",
    BACKUPS_BUCKET: r2,
    HEALTHCHECKS_FILES_PING_URL: "https://hc.test/abc",
  };
  const run = () => runFileBackup(env, { createAdmin: () => admin, fetchFn });
  const failed = () => pings.some((p) => p.includes("/fail"));
  return { r2, run, pings, env, admin, fetchFn, calls, failed };
}

const k = (h: string, rest: string, bucket = "vault-docs") =>
  `${FILE_PREFIX}${bucket}/${h}/${rest}`;

// ---- pure planning ----------------------------------------------------------

describe("planFileBackup", () => {
  const m = (bucket_id: string, name: string, size: number): ManifestEntry => ({
    bucket_id,
    name,
    size,
  });

  it("copies what R2 lacks and what R2 holds with a different size; leaves matching files alone", () => {
    const manifest = [
      m("vault-docs", `${ID_A}/a.pdf`, 10),
      m("vault-docs", `${ID_A}/b.pdf`, 20),
      m("vault-docs", `${ID_A}/c.pdf`, 30),
    ];
    const stored = [
      { key: r2KeyFor(manifest[0]), size: 10 },
      { key: r2KeyFor(manifest[1]), size: 999 },
    ];
    const plan = planFileBackup(manifest, stored);
    expect(plan.toCopy.map((e) => e.name)).toEqual([`${ID_A}/b.pdf`, `${ID_A}/c.pdf`]);
    expect(plan.toArchive).toEqual([]);
  });

  it("puts documents ahead of photos", () => {
    const plan = planFileBackup(
      [m("inventory-photos", `${ID_A}/p.jpg`, 1), m("vault-docs", `${ID_A}/d.pdf`, 1)],
      [],
    );
    expect(plan.toCopy.map((e) => e.bucket_id)).toEqual(["vault-docs", "inventory-photos"]);
  });

  it("marks files R2 holds but the database no longer has as to-move", () => {
    const plan = planFileBackup([], [{ key: k(ID_A, "gone.pdf"), size: 5 }]);
    expect(plan.toArchive).toHaveLength(1);
  });
});

describe("planHouseholds", () => {
  const sum = (household: string, digest: string): HouseholdSummary => ({
    household,
    files: 1,
    bytes: 1,
    digest,
  });
  const state = (h: SyncState["households"]): SyncState => ({ version: 1, households: h });

  it("lists changed and new households first, then deleted ones, then ONE self-check household", () => {
    const plan = planHouseholds(
      [sum("a", "d1"), sum("b", "NEW"), sum("c", "d3"), sum("d", "d4")],
      state({
        a: { digest: "d1", at: "2026-10-03T00:00:00Z", tried: "2026-10-03T00:00:00Z" },
        b: { digest: "old", at: "2026-10-01T00:00:00Z", tried: "2026-10-05T00:00:00Z" },
        c: { digest: "d3", at: "2026-10-01T00:00:00Z", tried: "2026-10-04T00:00:00Z" },
      }),
      ["a", "b", "c", "zz"],
    );
    expect(plan.changed).toEqual(["d", "b"]); // never-tried first, then least recently tried
    expect(plan.gone).toEqual(["zz"]);
    expect(plan.sweep).toEqual(["c"]); // verified longest ago among the in-sync ones
    expect(plan.order).toEqual(["d", "b", "zz", "c"]);
  });

  it("has no self-check when nothing is in sync yet", () => {
    expect(planHouseholds([sum("a", "x")], state({}), []).sweep).toEqual([]);
  });

  it("stays fast with 500 households (the file list is NOT part of this work any more)", () => {
    const summary = Array.from({ length: 500 }, (_, i) => sum(`h${i}`, `digest${i}`));
    const st = state(
      Object.fromEntries(
        summary.map((s, i) => [
          s.household,
          {
            digest: i % 10 ? s.digest : "old",
            at: "2026-10-01T00:00:00Z",
            tried: "2026-10-01T00:00:00Z",
          },
        ]),
      ),
    );
    const t0 = performance.now();
    const plan = planHouseholds(
      summary,
      st,
      summary.map((s) => s.household),
    );
    expect(performance.now() - t0).toBeLessThan(15);
    expect(plan.changed).toHaveLength(50);
  });
});

// ---- the run ----------------------------------------------------------------

describe("runFileBackup: copying", () => {
  it("copies every missing file byte-for-byte for every household, records them as backed up, and reports success", async () => {
    const db: Db = {
      [ID_A]: {
        "vault-docs/loan/1-will.pdf": "PDF-ONE",
        "inventory-photos/items/2-tv.jpg": "JPEG-TWO",
      },
      [ID_B]: { "vault-docs/ins/3-policy.pdf": "PDF-THREE" },
    };
    const { r2, run, pings, failed } = setup(db);
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.copied).toBe(3);
    expect(dec(r2.objects.get(k(ID_A, "loan/1-will.pdf")))).toBe("PDF-ONE");
    expect(dec(r2.objects.get(k(ID_A, "items/2-tv.jpg", "inventory-photos")))).toBe("JPEG-TWO");
    expect(dec(r2.objects.get(k(ID_B, "ins/3-policy.pdf")))).toBe("PDF-THREE");
    expect(Object.keys(r2.stateJson!.households).sort()).toEqual([ID_A, ID_B]);
    expect(r2.stateJson!.households[ID_A].digest).toBeTruthy();
    expect(pings[0]).toBe("/abc/start");
    expect(pings.at(-1)).toMatch(/^\/abc :: 3 files/);
    expect(failed()).toBe(false);
  });

  it("when nothing changed, a run copies nothing and looks at only ONE household (the self-check), not all of them", async () => {
    const db: Db = {};
    for (let i = 0; i < 20; i++)
      db[`h${String(i).padStart(2, "0")}`] = { "vault-docs/a.pdf": `content-${i}` };
    const { run, r2, calls } = setup(db);
    await run();
    await run();
    await run();
    r2.puts.length = 0;
    calls.manifest.length = 0;
    calls.downloads = 0;
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.copied).toBe(0);
    expect(calls.downloads).toBe(0);
    expect(calls.manifest).toHaveLength(1);
    expect(r2.puts).toEqual([STATE_KEY]); // only the small state file was written
  });

  it("only the household whose files changed is examined (plus the self-check), and only its new file is copied", async () => {
    const db: Db = {
      [ID_A]: { "vault-docs/a.pdf": "A1" },
      [ID_B]: { "vault-docs/b.pdf": "B1" },
      [ID_C]: { "vault-docs/c.pdf": "C1" },
    };
    const { run, calls, r2 } = setup(db);
    await run();
    calls.manifest.length = 0;
    db[ID_B]["vault-docs/b2.pdf"] = "B2-NEW";
    const result = await run();
    expect(result.copied).toBe(1);
    expect(calls.manifest).toContain(ID_B);
    expect(calls.manifest.length).toBeLessThanOrEqual(2);
    expect(dec(r2.objects.get(k(ID_B, "b2.pdf")))).toBe("B2-NEW");
  });

  it("copies at most MAX_COPIES_PER_RUN per run and finishes over later runs, without raising an alarm", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 25; i++)
      files[`vault-docs/${String(i).padStart(2, "0")}.pdf`] = `content-${i}`;
    const { r2, run, failed } = setup({ [ID_A]: files });
    const first = await run();
    expect(first.copied).toBe(MAX_COPIES_PER_RUN);
    expect(first.householdsPending).toBe(1);
    expect(first.ok).toBe(true);
    expect(failed()).toBe(false);
    await run();
    const third = await run();
    expect(third.householdsPending).toBe(0);
    expect([...r2.objects.keys()].filter((x) => x.startsWith(FILE_PREFIX)).length).toBe(25);
  });

  it("stops a run once the byte cap is reached", async () => {
    const files: Record<string, string> = {};
    const sizes: Record<string, number> = {};
    for (let i = 0; i < 6; i++) {
      files[`vault-docs/f${i}.pdf`] = "y".repeat(10);
      sizes[`vault-docs/f${i}.pdf`] = 12_000_000; // 6 x 12 MB; cap is 30 MB, so at most 2 per run
    }
    const { run } = setup({ [ID_A]: files }, { sizes });
    expect((await run()).failed).toBe(2); // each fails its size check (fake serves 10 bytes) but only 2 were TRIED
  });

  it("re-copies a file whose R2 copy has the wrong size", async () => {
    const { r2, run } = setup({ [ID_A]: { "vault-docs/a.pdf": "GOOD-CONTENT" } });
    r2.objects.set(k(ID_A, "a.pdf"), enc("short"));
    await run();
    expect(dec(r2.objects.get(k(ID_A, "a.pdf")))).toBe("GOOD-CONTENT");
  });

  it("the self-check notices a file that vanished from R2 by accident and copies it again", async () => {
    const { r2, run } = setup({ [ID_A]: { "vault-docs/a.pdf": "AAA" } });
    await run();
    r2.objects.delete(k(ID_A, "a.pdf"));
    const result = await run(); // the state file says "in sync", so only the self-check can catch this
    expect(result.copied).toBe(1);
    expect(dec(r2.objects.get(k(ID_A, "a.pdf")))).toBe("AAA");
  });
});

describe("runFileBackup: deletions go to the 30-day holding folder", () => {
  it("moves a deleted file into the holding folder, intact, and only THEN removes the original", async () => {
    const db: Db = {
      [ID_A]: { "vault-docs/keep.pdf": "KEEP", "vault-docs/gone.pdf": "DELETED-LATER" },
    };
    const { r2, run } = setup(db);
    await run();
    delete db[ID_A]["vault-docs/gone.pdf"];
    r2.log.length = 0;
    const result = await run();
    expect(result.archived).toBe(1);
    expect(r2.objects.has(k(ID_A, "gone.pdf"))).toBe(false);
    expect(dec(r2.objects.get(`${ARCHIVE_PREFIX}vault-docs/${ID_A}/gone.pdf`))).toBe(
      "DELETED-LATER",
    );
    expect(r2.objects.has(k(ID_A, "keep.pdf"))).toBe(true);
    expect(r2.log.filter((l) => l.includes("gone.pdf"))).toEqual([
      `put:${ARCHIVE_PREFIX}vault-docs/${ID_A}/gone.pdf`,
      `delete:${k(ID_A, "gone.pdf")}`,
    ]);
  });

  it("keeps the original if the holding copy cannot be written", async () => {
    const db: Db = { [ID_A]: { "vault-docs/keep.pdf": "KEEP", "vault-docs/gone.pdf": "PRECIOUS" } };
    const { r2, run, failed } = setup(db);
    await run();
    delete db[ID_A]["vault-docs/gone.pdf"];
    r2.failPutsWithPrefix = ARCHIVE_PREFIX;
    const result = await run();
    expect(result.archived).toBe(0);
    expect(r2.objects.has(k(ID_A, "gone.pdf"))).toBe(true);
    expect(r2.deletes).toEqual([]);
    expect(failed()).toBe(true);
  });

  it("keeps the original if the holding copy comes back a different size", async () => {
    const db: Db = { [ID_A]: { "vault-docs/keep.pdf": "KEEP", "vault-docs/gone.pdf": "PRECIOUS" } };
    const { r2, run } = setup(db);
    await run();
    delete db[ID_A]["vault-docs/gone.pdf"];
    r2.reportWrongSize = true;
    const result = await run();
    expect(result.archived).toBe(0);
    expect(r2.objects.has(k(ID_A, "gone.pdf"))).toBe(true);
    expect(r2.deletes).toEqual([]);
  });

  it("when a whole household is deleted, all its files move to the holding folder; other households are untouched", async () => {
    const db: Db = {
      [ID_A]: { "vault-docs/a1.pdf": "A1", "inventory-photos/a2.jpg": "A2" },
      [ID_B]: { "vault-docs/b1.pdf": "B1" },
    };
    const { r2, run } = setup(db);
    await run();
    delete db[ID_A];
    const result = await run();
    expect(result.archived).toBe(2);
    expect(dec(r2.objects.get(`${ARCHIVE_PREFIX}vault-docs/${ID_A}/a1.pdf`))).toBe("A1");
    expect(dec(r2.objects.get(`${ARCHIVE_PREFIX}inventory-photos/${ID_A}/a2.jpg`))).toBe("A2");
    expect([...r2.objects.keys()].some((x) => x.startsWith(FILE_PREFIX) && x.includes(ID_A))).toBe(
      false,
    );
    expect(dec(r2.objects.get(k(ID_B, "b1.pdf")))).toBe("B1");
    expect(r2.stateJson!.households[ID_A]).toBeUndefined();
  });

  it("also clears files of a deleted household the state file never knew about (nothing lingers in files/)", async () => {
    const { r2, run } = setup({ [ID_B]: { "vault-docs/b1.pdf": "B1" } });
    r2.objects.set(k(ID_A, "orphan.pdf"), enc("ORPHAN"));
    const result = await run();
    expect(result.archived).toBe(1);
    expect(r2.objects.has(k(ID_A, "orphan.pdf"))).toBe(false);
    expect(dec(r2.objects.get(`${ARCHIVE_PREFIX}vault-docs/${ID_A}/orphan.pdf`))).toBe("ORPHAN");
  });

  it("moves at most MAX_ARCHIVE_PER_RUN per run", async () => {
    const { r2, run } = setup({ [ID_B]: { "vault-docs/b1.pdf": "B1" } });
    for (let i = 0; i < MAX_ARCHIVE_PER_RUN + 5; i++)
      r2.objects.set(k(ID_A, `old${i}.pdf`), enc("x"));
    const result = await run();
    expect(result.archived).toBe(MAX_ARCHIVE_PER_RUN);
  });

  it("touches nothing and raises the alarm if the database reports NO files while R2 holds households", async () => {
    const { r2, run, failed } = setup({});
    r2.objects.set(k(ID_A, "a.pdf"), enc("data"));
    const result = await run();
    expect(result.ok).toBe(false);
    expect(r2.deletes).toEqual([]);
    expect(r2.objects.has(k(ID_A, "a.pdf"))).toBe(true);
    expect([...r2.objects.keys()].some((x) => x.startsWith(ARCHIVE_PREFIX))).toBe(false);
    expect(failed()).toBe(true);
  });
});

describe("runFileBackup: things going wrong", () => {
  it("one broken download does not stop the others, is reported, and the household is retried until it works", async () => {
    const db: Db = { [ID_A]: { "vault-docs/a.pdf": "AAA", "vault-docs/b.pdf": "BBB" } };
    const broken = [`vault-docs/${ID_A}/a.pdf`];
    const { r2, run, failed } = setup(db, { broken });
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.failed).toBe(1);
    expect(result.copied).toBe(1);
    expect(r2.objects.has(k(ID_A, "a.pdf"))).toBe(false);
    expect(r2.objects.has(k(ID_A, "b.pdf"))).toBe(true);
    expect(failed()).toBe(true);
    expect(r2.stateJson!.households[ID_A].digest).toBeNull(); // NOT recorded as backed up
    broken.length = 0;
    const next = await run();
    expect(next.ok).toBe(true);
    expect(dec(r2.objects.get(k(ID_A, "a.pdf")))).toBe("AAA");
    expect(r2.stateJson!.households[ID_A].digest).toBeTruthy();
  });

  it("never stores a truncated download (size differs from what the database reported)", async () => {
    const { r2, run } = setup(
      { [ID_A]: { "vault-docs/a.pdf": "ONLY-PART" } },
      { sizes: { "vault-docs/a.pdf": 500 } },
    );
    const result = await run();
    expect(result.ok).toBe(false);
    expect(r2.objects.has(k(ID_A, "a.pdf"))).toBe(false);
  });

  it("does not count a copy as done if R2 reports a different size than the database", async () => {
    const { r2, run } = setup({ [ID_A]: { "vault-docs/a.pdf": "AAAA" } });
    r2.reportWrongSize = true;
    const result = await run();
    expect(result.copied).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.ok).toBe(false);
  });

  it("a refused signed link fails only that file (one signed-link request per file)", async () => {
    const db: Db = { [ID_A]: { "vault-docs/a.pdf": "AAA", "vault-docs/b.pdf": "BBB" } };
    const { r2, run, calls } = setup(db, { noLink: [`vault-docs/${ID_A}/a.pdf`] });
    const result = await run();
    expect(calls.sign).toHaveLength(2);
    expect(result.failed).toBe(1);
    expect(r2.objects.has(k(ID_A, "b.pdf"))).toBe(true);
  });

  it("aborts without touching R2 if the household summary is incomplete", async () => {
    const lying = setup({ [ID_A]: { "vault-docs/a.pdf": "A" } }, { summaryCountLie: 3 });
    lying.r2.objects.set(k(ID_B, "x.pdf"), enc("x"));
    const result = await lying.run();
    expect(result.ok).toBe(false);
    expect(lying.r2.deletes).toEqual([]);
    expect(lying.r2.puts).toEqual([]);
  });

  it("a PARTIAL file list for one household moves nothing: its live files stay where they are", async () => {
    const db: Db = {
      [ID_A]: { "vault-docs/a.pdf": "A", "vault-docs/b.pdf": "B", "vault-docs/c.pdf": "C" },
    };
    const t = setup(db, { manifestShort: true }); // file list arrives one row short of what the database reports
    for (const n of ["a", "b", "c"]) t.r2.objects.set(k(ID_A, `${n}.pdf`), enc(n.toUpperCase()));
    const result = await t.run();
    expect(result.ok).toBe(false);
    expect(t.r2.deletes).toEqual([]);
    expect(t.r2.objects.has(k(ID_A, "c.pdf"))).toBe(true);
    expect([...t.r2.objects.keys()].some((x) => x.startsWith(ARCHIVE_PREFIX))).toBe(false);
    expect(t.failed()).toBe(true);
  });

  it("an unreadable state file is treated as empty: everything is re-checked, nothing is lost", async () => {
    const { r2, run } = setup({ [ID_A]: { "vault-docs/a.pdf": "AAA" } });
    await run();
    r2.objects.set(STATE_KEY, enc("{not json"));
    const result = await run();
    expect(result.ok).toBe(true);
    expect(dec(r2.objects.get(k(ID_A, "a.pdf")))).toBe("AAA");
    expect(r2.stateJson!.households[ID_A].digest).toBeTruthy();
  });

  it("one household that keeps failing cannot starve the others (least recently tried goes first)", async () => {
    const stuck: Record<string, string> = {};
    const broken: string[] = [];
    for (let i = 0; i < MAX_COPIES_PER_RUN; i++) {
      stuck[`vault-docs/s${i}.pdf`] = "x";
      broken.push(`vault-docs/${ID_A}/s${i}.pdf`);
    }
    const db: Db = {
      [ID_A]: stuck,
      [ID_B]: { "vault-docs/b.pdf": "B" },
      [ID_C]: { "vault-docs/c.pdf": "C" },
    };
    const { r2, run } = setup(db, { broken });
    await run(); // A goes first and uses the whole copy budget on failures
    await run(); // A was tried most recently, so B and C go first now
    expect(r2.objects.has(k(ID_B, "b.pdf"))).toBe(true);
    expect(r2.objects.has(k(ID_C, "c.pdf"))).toBe(true);
  });

  it("stops starting work before the 50-outside-request limit even when many households changed", async () => {
    const db: Db = {};
    for (let i = 0; i < 80; i++)
      db[`h${String(i).padStart(3, "0")}`] = { "vault-docs/f.pdf": `c${i}` };
    const { run, calls } = setup(db);
    const result = await run();
    expect(calls.outside).toBeLessThanOrEqual(50);
    expect(result.householdsChecked).toBeLessThan(80);
    expect(result.householdsPending).toBeGreaterThan(0);
    expect(result.ok).toBe(true); // waiting is not a failure
    const before = result.householdsPending;
    const second = await run();
    expect(second.householdsPending).toBeLessThan(before);
  });
});

describe("runFileBackup: request budget", () => {
  it("a household with many missing files cannot push the run past 50 outside requests when earlier households already used most of them", async () => {
    const db: Db = {};
    const { r2, run, calls } = setup(db);
    for (let i = 0; i < 38; i++) {
      const h = `h${String(i).padStart(2, "0")}`;
      db[h] = { "vault-docs/f.pdf": "c" };
      r2.objects.set(k(h, "f.pdf"), enc("c")); // already backed up: each costs only its file-list request
    }
    const many: Record<string, string> = {};
    for (let i = 0; i < 10; i++) many[`vault-docs/m${i}.pdf`] = `m${i}`;
    db["zzz"] = many; // sorts last, so it starts after ~40 requests are spent
    const result = await run();
    expect(calls.outside).toBeLessThanOrEqual(50);
    expect(result.ok).toBe(true);
    expect(result.householdsPending).toBeGreaterThan(0); // the rest waits for the next hour
  });
});

describe("runFileBackup: warnings and settings", () => {
  it("warns as the files approach the free 1 GB, while still copying normally", async () => {
    const files: Record<string, string> = { "vault-docs/new.pdf": "NEW" };
    const sizes: Record<string, number> = {};
    for (let i = 0; i < 80; i++) {
      files[`vault-docs/old${i}.pdf`] = "x";
      sizes[`vault-docs/old${i}.pdf`] = 10_000_000;
    }
    const { r2, run, pings } = setup({ [ID_A]: files }, { sizes });
    for (let i = 0; i < 80; i++) r2.objects.set(k(ID_A, `old${i}.pdf`), new Uint8Array(10_000_000));
    const result = await run();
    expect(result.totalBytes).toBeGreaterThanOrEqual(STORAGE_WARN_BYTES);
    expect(result.copied).toBe(1);
    expect(pings.some((p) => p.includes("/fail") && p.includes("1 GB"))).toBe(true);
  });

  it("a small project does not raise the 1 GB warning", async () => {
    const { run, failed } = setup({ [ID_A]: { "vault-docs/a.pdf": "A" } });
    await run();
    expect(failed()).toBe(false);
  });

  it("works with no Healthchecks URL set (pings are skipped, nothing throws)", async () => {
    const { env, admin, fetchFn, r2 } = setup({ [ID_A]: { "vault-docs/a.pdf": "A" } });
    const { HEALTHCHECKS_FILES_PING_URL: _unused, ...withoutUrl } = env;
    const result = await runFileBackup(withoutUrl, { createAdmin: () => admin, fetchFn });
    expect(result.ok).toBe(true);
    expect(r2.objects.has(k(ID_A, "a.pdf"))).toBe(true);
  });

  it("reports a clear failure, and does nothing else, when a required setting is missing", async () => {
    const result = await runFileBackup({ SUPABASE_URL: "https://x.supabase.co" });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});
