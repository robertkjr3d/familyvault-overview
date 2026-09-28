# supabase/ — what is authoritative here

**Read this before trusting anything in this folder.**

| Item | What it is | Trust level |
|---|---|---|
| The **live database** (Supabase, Singapore) | The real source of truth. | Authoritative — always verify against it. |
| `schema-snapshot/schema.sql` | A generated copy of the live database's structure (tables, constraints, functions, views, RLS policies, triggers, grants, storage buckets). **No user data.** | Authoritative **as of the date in its first line**. Regenerate to refresh. |
| `migrations/*.sql` dated **before 2026-09-28** | The original Lovable-era history. **Incomplete and partly stale** (missing tables such as `deleted_records`, `fx_rates`, `audit_log`, `credit_cards`, several views/functions; some early files made storage buckets public, which the live buckets are not). | Historical only. Do not rebuild a database from these. |
| `migrations/*.sql` dated **2026-09-28 or later** | A change log: each file is a change that was **run by hand in the Supabase SQL Editor**, with why, and a rollback. | Accurate record of what was run; not an auto-run pipeline. |
| `config.toml` | Supabase CLI config from the original template. The project is not managed with the CLI. | Ignore for auditing. |

## Why it is like this
The app is built without a command line: SQL is pasted into the Supabase SQL Editor by hand. Nothing forces the repo to follow the database, so the old migration folder drifted. Two habits keep it honest from now on:

1. **Every SQL statement that changes the database is committed as a dated file in `migrations/` in the same sitting** (`YYYYMMDDHHMMSS_short_name.sql`, with a WHY comment and a ROLLBACK comment).
2. **After a batch of changes, refresh `schema-snapshot/schema.sql`** (see `schema-snapshot/README.md`). Comparing a fresh dump with the committed snapshot is also how to detect SQL that was run without a file.

## Auditing checklist for another AI/human
- Do not conclude a table is unprotected (or a bucket public) from `migrations/` alone. Check `schema-snapshot/schema.sql`, and if the snapshot looks old, ask for a fresh dump or the specific live catalog query.
- Security claims must cite live evidence (a `pg_policies` / `pg_get_functiondef` result and its date). See `../docs/AUDIT-LEDGER.md` for claims already checked.
