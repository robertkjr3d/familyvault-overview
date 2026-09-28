# supabase/

The **live Supabase database is the source of truth.** This folder holds two files about it:

- `schema.sql` — a description of the live database's structure (tables, security rules, functions, views, triggers, file buckets). No user data. **Read-only reference: never run it.** Its first line shows when it was generated.
- `dump-schema.sql` — the read-only query that produces `schema.sql`. Instructions are at its top.

## The one rule
After **any** change to the database (SQL pasted into the SQL Editor), re-run `dump-schema.sql` and replace `schema.sql`. The git history of `schema.sql` is then the change log, so there is no folder of migration files to keep in sync.

## For an auditor (human or AI)
Trust `schema.sql` over anything else in the repo about database security, and check its date. If it looks out of date, ask for a fresh dump. Already-checked claims are in `../docs/AUDIT-LEDGER.md`.
