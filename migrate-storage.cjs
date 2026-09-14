// Copies every actual file (not just the database records about them) from
// the OLD project's storage buckets into the NEW project's storage buckets.
//
// Earlier version of this script tried to list files by querying the
// "storage" schema directly like a database table. That failed with
// "Invalid schema: storage" — Supabase's Data API only exposes the
// "public" schema by default, not "storage", so that approach can't work
// without changing a project security setting we don't need to touch.
// Fixed version below uses the actual, dedicated Storage list() API
// instead (confirmed against Supabase's current official JS docs) —
// this needs no special schema access at all, it's the normal way any
// app is meant to browse files in a bucket.
//
// Run via: node migrate-storage.cjs
// Needs 4 environment variables (all provided by the GitHub Actions
// workflow automatically — nothing to fill in here by hand):
//   OLD_PROJECT_URL, OLD_SERVICE_ROLE_KEY, NEW_PROJECT_URL, NEW_SERVICE_ROLE_KEY

const { createClient } = require("@supabase/supabase-js");

const OLD_PROJECT_URL = process.env.OLD_PROJECT_URL;
const OLD_SERVICE_ROLE_KEY = process.env.OLD_SERVICE_ROLE_KEY;
const NEW_PROJECT_URL = process.env.NEW_PROJECT_URL;
const NEW_SERVICE_ROLE_KEY = process.env.NEW_SERVICE_ROLE_KEY;

if (!OLD_PROJECT_URL || !OLD_SERVICE_ROLE_KEY || !NEW_PROJECT_URL || !NEW_SERVICE_ROLE_KEY) {
  console.error("Missing one of the 4 required environment variables. Stopping.");
  process.exit(1);
}

// This app only ever uses these 2 buckets (confirmed by searching every
// .storage.from(...) call in the app's own source code).
const BUCKETS = ["vault-docs", "inventory-photos"];
const PAGE_SIZE = 1000;

// Recursively walks a bucket's folder structure. Supabase's list() only
// returns one folder level at a time, and doesn't distinguish files from
// folders except by one detail: a folder entry always has id === null,
// while a real file always has a real id. Confirmed directly from
// Supabase's own current API reference docs, not assumed.
async function listAllFiles(storageClient, bucket, prefix = "") {
  const filePaths = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await storageClient.storage
      .from(bucket)
      .list(prefix, { limit: PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) {
      throw new Error(`Failed listing ${bucket}/${prefix || "(root)"} (offset ${offset}): ${error.message}`);
    }
    if (!data || data.length === 0) break;
    for (const entry of data) {
      const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        // A folder — recurse into it to find the real files inside.
        const nested = await listAllFiles(storageClient, bucket, fullPath);
        filePaths.push(...nested);
      } else {
        filePaths.push(fullPath);
      }
    }
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return filePaths;
}

(async () => {
  const oldStorageClient = createClient(OLD_PROJECT_URL, OLD_SERVICE_ROLE_KEY);
  const newStorageClient = createClient(NEW_PROJECT_URL, NEW_SERVICE_ROLE_KEY);

  const allFiles = [];
  for (const bucket of BUCKETS) {
    console.log(`Listing files in bucket "${bucket}"...`);
    const files = await listAllFiles(oldStorageClient, bucket);
    console.log(`  found ${files.length} file(s)`);
    for (const path of files) {
      allFiles.push({ bucket, path });
    }
  }

  console.log(`\nFound ${allFiles.length} file(s) total to copy across both buckets.`);

  let copied = 0;
  let failed = 0;
  const failures = [];

  for (const { bucket, path } of allFiles) {
    process.stdout.write(`Copying ${bucket}/${path} ... `);
    try {
      const { data, error: downloadError } = await oldStorageClient.storage.from(bucket).download(path);
      if (downloadError) throw downloadError;

      const { error: uploadError } = await newStorageClient.storage.from(bucket).upload(path, data, {
        upsert: true,
        contentType: data.type || undefined,
      });
      if (uploadError) throw uploadError;

      copied += 1;
      console.log("ok");
    } catch (err) {
      failed += 1;
      failures.push({ bucket, path, error: String(err) });
      console.log(`FAILED: ${err}`);
    }
  }

  console.log("\n=== Storage migration summary ===");
  console.log(`Total files found on OLD project: ${allFiles.length}`);
  console.log(`Successfully copied:              ${copied}`);
  console.log(`Failed:                            ${failed}`);
  if (failures.length > 0) {
    console.log("\nFailed files (fix these individually, then re-run — copying is safe to");
    console.log("repeat, it overwrites rather than duplicates):");
    for (const f of failures) console.log(`  - ${f.bucket}/${f.path}: ${f.error}`);
  }

  // Fail the whole GitHub Actions run loudly if anything didn't copy, so a
  // partial failure can never look like a clean success.
  if (failed > 0) {
    process.exit(1);
  }
})();
