// Copies every actual file (not just the database records about them) from
// the OLD project's storage buckets into the NEW project's storage buckets.
// Based on Supabase's own official migration script (their docs guide),
// updated to supabase-js v2 (this app already uses v2, not the v1 the
// official snippet shows) and with pagination added — the official script's
// own comment warns the default query only returns a limited number of rows
// and says "paginate here" for real datasets, so this does that.
//
// Run via: node migrate-storage.js
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

const PAGE_SIZE = 1000;

async function fetchAllObjectRows(oldRestClient) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await oldRestClient
      .from("objects")
      .select("id, bucket_id, name, metadata")
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(`Failed listing storage objects (offset ${from}): ${error.message}`);
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

(async () => {
  // Talks to the OLD project's storage metadata table directly (this is
  // how you get the full, exact list of every file across every bucket).
  const oldRestClient = createClient(OLD_PROJECT_URL, OLD_SERVICE_ROLE_KEY, {
    db: { schema: "storage" },
  });
  const oldStorageClient = createClient(OLD_PROJECT_URL, OLD_SERVICE_ROLE_KEY);
  const newStorageClient = createClient(NEW_PROJECT_URL, NEW_SERVICE_ROLE_KEY);

  const objects = await fetchAllObjectRows(oldRestClient);
  console.log(`Found ${objects.length} files to copy across both buckets.`);

  let copied = 0;
  let failed = 0;
  const failures = [];

  for (const objectData of objects) {
    process.stdout.write(`Copying ${objectData.bucket_id}/${objectData.name} ... `);
    try {
      const { data, error: downloadError } = await oldStorageClient.storage
        .from(objectData.bucket_id)
        .download(objectData.name);
      if (downloadError) throw downloadError;

      const { error: uploadError } = await newStorageClient.storage
        .from(objectData.bucket_id)
        .upload(objectData.name, data, {
          upsert: true,
          contentType: objectData.metadata?.mimetype,
          cacheControl: objectData.metadata?.cacheControl,
        });
      if (uploadError) throw uploadError;

      copied += 1;
      console.log("ok");
    } catch (err) {
      failed += 1;
      failures.push({ bucket: objectData.bucket_id, name: objectData.name, error: String(err) });
      console.log(`FAILED: ${err}`);
    }
  }

  console.log("\n=== Storage migration summary ===");
  console.log(`Total files found on OLD project: ${objects.length}`);
  console.log(`Successfully copied:              ${copied}`);
  console.log(`Failed:                            ${failed}`);
  if (failures.length > 0) {
    console.log("\nFailed files (fix these individually, then re-run — copying is safe to");
    console.log("repeat, it overwrites rather than duplicates):");
    for (const f of failures) console.log(`  - ${f.bucket}/${f.name}: ${f.error}`);
  }

  // Fail the whole GitHub Actions run loudly if anything didn't copy, so a
  // partial failure can never look like a clean success.
  if (failed > 0) {
    process.exit(1);
  }
})();
