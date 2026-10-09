import { createClient } from "@supabase/supabase-js";

// Copies every uploaded photo and document from Supabase Storage into the same
// R2 bucket the nightly database backup uses (binding BACKUPS_BUCKET). Added
// Oct 5 2026. Supabase's own backups never include uploaded files (their docs
// say so, free and Pro alike), so without this a file deleted by mistake, or a
// lost project, is gone for good.
//
// HOW IT STAYS INSIDE CLOUDFLARE'S FREE PLAN (10 ms of CPU and 50 outside
// requests per run, checked against Cloudflare's docs Oct 2026):
//  - A measured fact: just building and comparing a full list of files costs
//    about 4 ms of CPU at 1,000 files and 10 ms at 3,000, before anything else.
//    So this job NEVER compares the full list. Instead:
//      1. The database gives one small summary row per household: its file
//         count, total bytes and a checksum of its file names and sizes
//         (backup_storage_summary()).
//      2. A small state file in R2 (state/files-sync.json) remembers the
//         checksum each household had when it was last fully backed up.
//      3. Each run compares only the households whose checksum changed (new
//         upload, deletion, replaced photo), plus ONE household re-checked in
//         rotation as a self-check (so a file removed from R2 by accident, or a
//         wrong lifecycle rule, is noticed and re-copied within days).
//    Work per run therefore grows with what CHANGED, not with the total.
//  - Files are STREAMED from Supabase into R2 (FixedLengthStream) instead of
//    being read into memory, because copying bytes in JavaScript costs CPU.
//  - Every request to the outside world is counted, and no new copy starts once
//    MAX_OUTSIDE_REQUESTS is reached. The job has its own cron trigger (hourly),
//    separate from the nightly database backup, so it has its own budget of 50.
//
// WHAT IT DOES FOR ONE HOUSEHOLD:
//  - copies the files R2 is missing (or holds with a different size), checking
//    after each copy that R2's size equals Supabase's;
//  - MOVES files that R2 holds but Supabase no longer has into files-deleted/.
//    A lifecycle rule on files-deleted/ (set in the Cloudflare dashboard, not in
//    code) removes them 30 days later. Nothing leaves files/ until its copy in
//    files-deleted/ is verified.
//  - only then records the household's checksum in the state file.
//
// SAFETY RULES (each one has a test that fails if the rule is removed):
//  - the list from the database must be complete (row count checked) or the run
//    stops before touching R2;
//  - an EMPTY summary while the state file knows of households is treated as an
//    outage: nothing is moved;
//  - households are processed least-recently-tried first, so one household with a
//    permanently failing file cannot starve the others.
//
// Never throws: every problem is logged and reported through Healthchecks.

export const FILE_PREFIX = "files/";
export const ARCHIVE_PREFIX = "files-deleted/";
export const STATE_KEY = "state/files-sync.json";

export const MAX_COPIES_PER_RUN = 10;
// Also capped by bytes, so a file that can never be verified (and so is retried
// every hour) cannot burn through Supabase's 5 GB/month free download allowance.
export const MAX_BYTES_PER_RUN = 30 * 1000 * 1000;
export const MAX_ARCHIVE_PER_RUN = 20;
// Cloudflare's free plan allows 50 requests to the outside world per run.
// Stop starting new work well before that, leaving room for the closing ping.
export const MAX_OUTSIDE_REQUESTS = 44;
// The real per-file caps are 10 MB (documents) and 5 MB (photos). Anything far
// above that is not something this app produced; skip it and say so.
const BUCKETS = ["vault-docs", "inventory-photos"] as const;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const PAGE_SIZE = 1000;
const MAX_PAGES = 100; // runaway guard
const SIGNED_URL_SECONDS = 300;
// Supabase's free plan allows 1 GB of files. Warn well before it, so there is
// time to decide about Pro ($25/month, 100 GB). Raise this after upgrading.
export const STORAGE_WARN_BYTES = 800 * 1000 * 1000;

export type ManifestEntry = { bucket_id: string; name: string; size: number };
export type StoredEntry = { key: string; size: number };
export type HouseholdSummary = { household: string; files: number; bytes: number; digest: string };
export type SyncState = {
  version: 1;
  households: Record<string, { digest: string | null; at: string | null; tried: string }>;
};

type R2ObjectLike = { key?: string; size: number; httpMetadata?: { contentType?: string } };
type R2PutOptions = {
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
};
export type R2BucketForFiles = {
  list(options: { prefix: string; cursor?: string; limit?: number; delimiter?: string }): Promise<{
    objects: Array<{ key: string; size: number }>;
    delimitedPrefixes?: string[];
    truncated: boolean;
    cursor?: string;
  }>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | string,
    options?: R2PutOptions,
  ): Promise<R2ObjectLike>;
  get(
    key: string,
  ): Promise<(R2ObjectLike & { body: ReadableStream; text(): Promise<string> }) | null>;
  delete(key: string): Promise<void>;
};

export type FileBackupEnv = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  BACKUPS_BUCKET?: R2BucketForFiles;
  // Optional, like HEALTHCHECKS_PING_URL: if the secret is not set, every ping
  // is silently skipped. Must be a DIFFERENT Healthchecks check from the
  // nightly database backup's.
  HEALTHCHECKS_FILES_PING_URL?: string;
};

export type FileBackupResult = {
  ok: boolean;
  totalFiles: number;
  totalBytes: number;
  householdsChecked: number;
  householdsPending: number; // changed households not yet fully backed up after this run
  copied: number;
  failed: number;
  archived: number;
  message: string;
};

export function r2KeyFor(entry: Pick<ManifestEntry, "bucket_id" | "name">): string {
  return `${FILE_PREFIX}${entry.bucket_id}/${entry.name}`;
}

export function archiveKeyFor(storedKey: string): string {
  return ARCHIVE_PREFIX + storedKey.slice(FILE_PREFIX.length);
}

// Pure: decides what to copy and what to move, from the two lists. No I/O.
export function planFileBackup(manifest: ManifestEntry[], stored: StoredEntry[]) {
  const storedByKey = new Map<string, number>();
  for (const s of stored) storedByKey.set(s.key, s.size);

  const wantedKeys = new Set<string>();
  const toCopy: ManifestEntry[] = [];
  let totalBytes = 0;
  for (const m of manifest) {
    const key = r2KeyFor(m);
    wantedKeys.add(key);
    totalBytes += m.size;
    if (storedByKey.get(key) !== m.size) toCopy.push(m);
  }
  // Documents are the irreplaceable ones; photos go second.
  toCopy.sort(
    (a, b) => Number(b.bucket_id === "vault-docs") - Number(a.bucket_id === "vault-docs"),
  );

  const toArchive = stored.filter((s) => !wantedKeys.has(s.key));
  return { toCopy, toArchive, totalBytes, totalFiles: manifest.length };
}

// Pure: which households need a look this run, in the order to do them.
// changed = checksum differs from the state file (or never backed up);
// gone = has a folder in R2 but is no longer in the database (deleted account);
// then ONE already-verified household, the one verified longest ago (self-check).
// Within each group, least recently TRIED first, so a household that keeps
// failing cannot use up every run's budget.
export function planHouseholds(
  summary: HouseholdSummary[],
  state: SyncState,
  householdsInR2: string[],
) {
  const triedAt = (id: string) => state.households[id]?.tried ?? "";
  const byTried = (a: string, b: string) =>
    triedAt(a) < triedAt(b) ? -1 : triedAt(a) > triedAt(b) ? 1 : a < b ? -1 : 1;

  const inDb = new Set(summary.map((h) => h.household));
  const changed = summary
    .filter((h) => state.households[h.household]?.digest !== h.digest)
    .map((h) => h.household)
    .sort(byTried);
  const gone = householdsInR2.filter((id) => !inDb.has(id)).sort(byTried);
  const verified = summary
    .filter((h) => state.households[h.household]?.digest === h.digest)
    .map((h) => h.household)
    .sort((a, b) => {
      const A = state.households[a]?.at ?? "";
      const B = state.households[b]?.at ?? "";
      return A < B ? -1 : A > B ? 1 : a < b ? -1 : 1;
    });
  const sweep = verified.length > 0 ? [verified[0]] : [];
  return { changed, gone, sweep, order: [...changed, ...gone, ...sweep] };
}

// Copies bytes from a download into R2 without holding the file in memory.
// FixedLengthStream exists only in the Workers runtime; elsewhere (tests) fall
// back to reading the whole body.
async function putStream(
  r2: R2BucketForFiles,
  key: string,
  body: ReadableStream | null,
  size: number,
  options: R2PutOptions,
): Promise<R2ObjectLike> {
  const FixedLength = (globalThis as { FixedLengthStream?: new (n: number) => TransformStream })
    .FixedLengthStream;
  if (FixedLength && body) {
    const { readable, writable } = new FixedLength(size);
    const pipe = body.pipeTo(writable);
    const [stored] = await Promise.all([r2.put(key, readable, options), pipe]);
    return stored;
  }
  const bytes = body ? await new Response(body).arrayBuffer() : new ArrayBuffer(0);
  if (bytes.byteLength !== size) {
    throw new Error(`download was ${bytes.byteLength} bytes, expected ${size}`);
  }
  return r2.put(key, bytes, options);
}

async function ping(
  url: string | undefined,
  suffix: "" | "/start" | "/fail",
  detail: string | undefined,
  fetchFn: typeof fetch,
): Promise<void> {
  if (!url) return;
  try {
    await fetchFn(url + suffix, {
      method: detail ? "POST" : "GET",
      body: detail ? detail.slice(0, 5000) : undefined,
    });
  } catch {
    // A Healthchecks outage must never break the backup itself.
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any;

// Reads every row of a database function, page by page, and refuses to return
// anything unless the number of rows received equals the count the database
// reported.
async function readRows<T>(
  admin: SupabaseLike,
  fn: string,
  args: Record<string, unknown>,
  spend: () => void,
): Promise<T[]> {
  const rows: T[] = [];
  let expected: number | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    spend();
    const { data, error, count } = await admin
      .rpc(fn, args, { count: "exact" })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${fn}: ${error.message ?? error}`);
    if (page === 0) {
      if (count === null || count === undefined) {
        throw new Error(`${fn}: no row count returned, cannot check it is complete`);
      }
      expected = count;
    }
    rows.push(...((data ?? []) as T[]));
    if (rows.length >= (expected ?? 0) || !data || data.length === 0) break;
  }
  if (rows.length !== expected) {
    throw new Error(`${fn}: read ${rows.length} rows but the database reports ${expected}`);
  }
  return rows;
}

async function listStored(r2: R2BucketForFiles, prefixes: string[]): Promise<StoredEntry[]> {
  const out: StoredEntry[] = [];
  for (const prefix of prefixes) {
    let cursor: string | undefined;
    for (let i = 0; ; i++) {
      if (i >= 100) throw new Error("R2 listing did not finish after 100 pages");
      const page = await r2.list({ prefix, cursor, limit: 1000 });
      for (const o of page.objects) out.push({ key: o.key, size: o.size });
      if (!page.truncated) break;
      cursor = page.cursor;
    }
  }
  return out;
}

// The household folders R2 holds, found with a delimiter so only one entry per
// household comes back (not one per file).
async function listHouseholdsInR2(r2: R2BucketForFiles): Promise<string[]> {
  const ids = new Set<string>();
  for (const bucket of BUCKETS) {
    const base = `${FILE_PREFIX}${bucket}/`;
    let cursor: string | undefined;
    for (let i = 0; ; i++) {
      if (i >= 100) throw new Error("R2 folder listing did not finish after 100 pages");
      const page = await r2.list({ prefix: base, delimiter: "/", cursor, limit: 1000 });
      for (const p of page.delimitedPrefixes ?? []) {
        const id = p.slice(base.length).replace(/\/$/, "");
        if (id) ids.add(id);
      }
      if (!page.truncated) break;
      cursor = page.cursor;
    }
  }
  return [...ids];
}

async function loadState(r2: R2BucketForFiles): Promise<SyncState> {
  const empty: SyncState = { version: 1, households: {} };
  try {
    const obj = await r2.get(STATE_KEY);
    if (!obj) return empty;
    const parsed = JSON.parse(await obj.text());
    if (parsed?.version === 1 && parsed.households && typeof parsed.households === "object") {
      return parsed as SyncState;
    }
  } catch {
    // Unreadable state is treated as empty: every household is re-checked.
    // That costs time, never data.
  }
  return empty;
}

export async function runFileBackup(
  env: FileBackupEnv,
  deps: {
    createAdmin?: (url: string, key: string) => SupabaseLike;
    fetchFn?: typeof fetch;
  } = {},
): Promise<FileBackupResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const url = env.HEALTHCHECKS_FILES_PING_URL;
  const result: FileBackupResult = {
    ok: false,
    totalFiles: 0,
    totalBytes: 0,
    householdsChecked: 0,
    householdsPending: 0,
    copied: 0,
    failed: 0,
    archived: 0,
    message: "",
  };
  const fail = async (message: string): Promise<FileBackupResult> => {
    result.ok = false;
    result.message = message;
    console.error(`[file-backup] ${message}`);
    await ping(url, "/fail", message, fetchFn);
    return result;
  };

  let outside = 0; // requests made to the outside world so far this run
  const spend = () => {
    outside++;
  };
  spend();
  await ping(url, "/start", undefined, fetchFn);

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BACKUPS_BUCKET: r2 } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return fail("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!r2) return fail("Missing BACKUPS_BUCKET binding");

  try {
    const admin = (
      deps.createAdmin ??
      ((u, k) =>
        createClient(u, k, {
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        }))
    )(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // One retry for a transient blip; a real problem fails loudly the second time.
    let summary: HouseholdSummary[];
    try {
      summary = await readRows<HouseholdSummary>(admin, "backup_storage_summary", {}, spend);
    } catch {
      await new Promise((r) => setTimeout(r, 500));
      summary = await readRows<HouseholdSummary>(admin, "backup_storage_summary", {}, spend);
    }
    summary = summary.map((h) => ({
      household: h.household,
      files: Number(h.files),
      bytes: Number(h.bytes),
      digest: h.digest,
    }));
    const summaryById = new Map(summary.map((h) => [h.household, h]));
    result.totalFiles = summary.reduce((n, h) => n + h.files, 0);
    result.totalBytes = summary.reduce((n, h) => n + h.bytes, 0);

    const state = await loadState(r2);
    const problems: string[] = [];

    const householdsInR2 = await listHouseholdsInR2(r2);

    // An empty database answer while R2 holds households looks like an outage
    // or a bug, not "everyone deleted everything". Touch nothing.
    if (summary.length === 0 && householdsInR2.length > 0) {
      return fail(
        `Supabase reports no files but R2 holds ${householdsInR2.length} households; nothing was moved. Check the project is healthy.`,
      );
    }

    const plan = planHouseholds(summary, state, householdsInR2);
    const now = new Date().toISOString();
    let copiedBytes = 0;
    let attempted = 0;
    let stateChanged = false;

    for (const id of plan.order) {
      // Each household needs at least 1 outside request (its file list) plus 2 per copy.
      if (outside + 1 > MAX_OUTSIDE_REQUESTS) break;
      result.householdsChecked++;
      const entry = state.households[id] ?? { digest: null, at: null, tried: "" };
      // "tried" only moves forward for a household that actually did (or attempted)
      // work this run. One that was merely looked at, but got no budget because an
      // earlier household used it all, keeps its place at the front of the queue.
      let didWork = false;
      const summaryRow = summaryById.get(id); // undefined => household is gone from the database
      const hProblems: string[] = [];
      let complete = true;

      let manifest: ManifestEntry[] = [];
      if (summaryRow) {
        try {
          manifest = await readRows<ManifestEntry>(
            admin,
            "backup_storage_manifest",
            { p_household: id },
            spend,
          );
          manifest = manifest.map((m) => ({
            bucket_id: m.bucket_id,
            name: m.name,
            size: Number(m.size),
          }));
          if (manifest.length !== summaryRow.files) {
            complete = false; // files changed between the two reads; the next run settles it
          }
        } catch (e) {
          hProblems.push(`file list for household ${id}: ${(e as Error)?.message ?? e}`);
          problems.push(...hProblems);
          entry.tried = now;
          state.households[id] = entry;
          stateChanged = true;
          continue;
        }
      }

      const stored = await listStored(r2, [
        `${FILE_PREFIX}vault-docs/${id}/`,
        `${FILE_PREFIX}inventory-photos/${id}/`,
      ]);
      const diff = planFileBackup(manifest, stored);

      // ---- copy missing files ----
      let copiedHere = 0;
      for (const m of diff.toCopy) {
        if (m.size > MAX_FILE_BYTES) {
          hProblems.push(
            `skipped ${m.bucket_id}/${m.name}: ${m.size} bytes is over the size limit`,
          );
          result.failed++;
          continue;
        }
        if (
          attempted >= MAX_COPIES_PER_RUN ||
          (attempted > 0 && copiedBytes + m.size > MAX_BYTES_PER_RUN) ||
          outside + 2 > MAX_OUTSIDE_REQUESTS
        ) {
          break; // out of budget for this run; the rest waits for the next hour
        }
        attempted++;
        didWork = true;
        copiedBytes += m.size;
        try {
          // One signed link per file: a plain 1:1 call, nothing to match up afterwards.
          spend();
          const { data: link, error: linkError } = await admin.storage
            .from(m.bucket_id)
            .createSignedUrl(m.name, SIGNED_URL_SECONDS);
          if (linkError || !link?.signedUrl) {
            throw new Error(`no download link (${linkError?.message ?? "empty answer"})`);
          }
          spend();
          const res = await fetchFn(link.signedUrl);
          if (!res.ok) throw new Error(`download answered ${res.status}`);
          const stored1 = await putStream(r2, r2KeyFor(m), res.body, m.size, {
            httpMetadata: { contentType: res.headers.get("content-type") ?? undefined },
            customMetadata: { backed_up_at: new Date().toISOString() },
          });
          if (stored1.size !== m.size)
            throw new Error(`R2 holds ${stored1.size} bytes, expected ${m.size}`);
          result.copied++;
          copiedHere++;
        } catch (e) {
          result.failed++;
          hProblems.push(`copy of ${m.bucket_id}/${m.name} failed: ${(e as Error)?.message ?? e}`);
        }
      }
      // Complete only if EVERY missing file was copied, none failed, none skipped,
      // and none was left waiting for budget.
      if (copiedHere !== diff.toCopy.length) complete = false;

      // ---- move files Supabase no longer has into the 30-day holding folder ----
      let archivedHere = 0;
      for (const s of diff.toArchive) {
        if (result.archived >= MAX_ARCHIVE_PER_RUN) break;
        didWork = true;
        try {
          const src = await r2.get(s.key);
          if (!src) {
            archivedHere++; // already gone
            continue;
          }
          const moved = await putStream(r2, archiveKeyFor(s.key), src.body, src.size, {
            httpMetadata: src.httpMetadata,
            customMetadata: { moved_at: new Date().toISOString() },
          });
          if (moved.size !== src.size) {
            throw new Error(`holding copy is ${moved.size} bytes, expected ${src.size}`);
          }
          await r2.delete(s.key); // only after the holding copy is verified
          result.archived++;
          archivedHere++;
        } catch (e) {
          hProblems.push(
            `could not move ${s.key} to the holding folder: ${(e as Error)?.message ?? e}`,
          );
        }
      }
      if (archivedHere !== diff.toArchive.length) complete = false;

      problems.push(...hProblems);

      // ---- record the household as fully backed up (or leave it to be retried) ----
      if (didWork) entry.tried = now;
      if (complete) {
        if (summaryRow) {
          entry.digest = summaryRow.digest;
          entry.at = now;
          state.households[id] = entry;
        } else {
          delete state.households[id];
        }
        stateChanged = true;
      } else if (didWork) {
        state.households[id] = entry;
        stateChanged = true;
      }
    }

    result.householdsPending = plan.changed.filter(
      (id) => state.households[id]?.digest !== summaryById.get(id)?.digest,
    ).length;

    if (stateChanged) {
      await r2.put(STATE_KEY, JSON.stringify(state));
    }

    // ---- free-plan headroom ----
    const mb = Math.round(result.totalBytes / 1_000_000);
    if (result.totalBytes >= STORAGE_WARN_BYTES) {
      problems.push(
        `Supabase files are at ${mb} MB, close to the free plan's 1 GB. Time to decide about Supabase Pro.`,
      );
    }

    const summaryText =
      `${result.totalFiles} files (${mb} MB) in ${summary.length} households; checked ${result.householdsChecked}, ` +
      `copied ${result.copied}, moved ${result.archived} to the holding folder, ${result.householdsPending} still waiting.`;
    if (problems.length > 0) return fail(`${summaryText} Problems: ${problems.join(" | ")}`);
    result.ok = true;
    result.message = summaryText;
    console.log(`[file-backup] ${summaryText}`);
    await ping(url, "", summaryText, fetchFn);
    return result;
  } catch (e) {
    return fail(`Run failed: ${(e as Error)?.message ?? e}`);
  }
}
