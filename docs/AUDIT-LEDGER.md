# Audit ledger — read this first if you are reviewing FamilyHub SG

Purpose: so any AI or human auditor starts from what has **already been verified**, does not re-report closed findings, and knows where the evidence lives. Keep it updated (add a row, change a status, date it). Last updated: **2026-09-28**.

Companion docs: `../familyhub-architecture.md` (plain-English overview), `../supabase/README.md` (what is authoritative in the database folder), `../trust-safety-scorecard.md`.

## Where the truth lives
- **Database structure/security:** live Supabase DB -> `supabase/schema-snapshot/schema.sql` (see its README; not yet generated as of the date above) -> `supabase/migrations/` dated 2026-09-28+ (change log). Older migration files are incomplete/stale.
- **Mortgage-as-liability rule** (one rule, four places): `src/lib/netWorthMath.ts` (tested) used by `src/routes/index.tsx` (dashboard Net Worth) and `src/routes/settings.tsx` (Asset & Liability Summary .docx); adviser side: view `advisor_networth_components_view` (`migrations/20260928120000_...sql`) + `src/lib/advisorAccess.ts`; projection: `src/lib/lifetimeChartMath.ts`.
- **Nightly jobs:** `wrangler.jsonc` (two cron triggers), `src/lib/scheduledJobs.ts`, `src/server.ts`, `src/lib/backupCron.ts`, `fxRateCron.ts`, `trashCleanupCron.ts`.
- **Tests:** `bun run test` (vitest). Route-level UI is not unit-tested; extracted logic in `src/lib/*` is.

## Findings register
Verdicts: TRUE / FALSE / PARTLY. "Live-verified" = checked against the running database by pasted SQL output.

| # | Claim (origin) | Verdict | Evidence | Status |
|---|---|---|---|---|
| 1 | Whole loan payment treated as net-worth loss (chart) | TRUE | `lifetimeChartMath.ts` | Fixed 2026-09-26 |
| 2 | Loan interest computed yearly on opening balance, not monthly (ChatGPT audit) | TRUE, minor | code + hand check ($100k, 5%, $1k/mo -> year-1 interest $4,837) | Fixed 2026-09-28 (`principalPaidOverYear`, tests) |
| 3 | Property `mortgage_balance` vs `loans` rows: property-only mortgages never subtracted from net worth (ChatGPT audit; code-verified) | TRUE, high | dashboard, adviser view (live `pg_get_viewdef`), and the estate Word summary all summed only `loans.balance` | Fixed 2026-09-28 in all three; adviser SQL run + user-confirmed. **Residual:** two entry fields still exist; dashboard shows a note if an unlinked loan and a property mortgage may both be entered. Structural follow-up: make one the sole source. |
| 4 | Viewers can write via API because RLS uses `is_household_member` (ChatGPT audit, from old migrations) | **FALSE on live** | Live `pg_policies` 2026-09-28: INSERT/UPDATE/DELETE on all financial tables use `is_household_editor()`; live function body restricts to roles `owner`,`member` | Closed. Old migration files are misleading. |
| 5 | `household_users` INSERT policy allowed `user_id = auth.uid()` with any household/role (found while verifying #4) | TRUE (not exploited; needed knowing a household UUID) | live policy text; app never inserts from browser (service role / SECURITY DEFINER trigger `handle_new_auth_user`) | Fixed 2026-09-28 (`20260928130000_...sql`), run + user-tested (new sign-up, invite) |
| 6 | Viewers could clear Recycle Bin rows (`deleted_records` used `is_household_member`) | TRUE, low | live `pg_policies` | Fix written `20260928140000_...sql` (**run status: see below**) |
| 7 | Migrations do not reproduce the live DB (ChatGPT audit) | TRUE | missing objects listed in `supabase/README.md` | Process fixed; snapshot dump written and tested locally; **schema.sql not yet generated** |
| 8 | Storage buckets public (ChatGPT audit, from old migrations) | **FALSE on live** | live check 2026-09-25: buckets private; read/insert/update/delete policies household-scoped | Closed. Repo history is misleading; snapshot will make it explicit. |
| 9 | Backups cover DB rows only, not photos/documents/auth users | TRUE | `familyhub-architecture.md` §5 | Open (accepted; user export exists). Options: storage copy job, GitHub Actions, paid plan. |
| 9b | Nightly backup failed 2026-09-28 | TRUE | Cloudflare log "Too many subrequests"; R2 has no 2026-09-27 file | Fixed 2026-09-28 (separate cron trigger). **Verify next night:** R2 `backups/2026-09-28.json` present, Healthchecks green. Headroom ~15 of 50 requests. |
| 10 | Lifetime chart is an illustration, not a forecast (ChatGPT audit) | TRUE | annual simplifications, foreign currency held flat, coarse salary/insurance modelling | Accepted. Chart footer already says "Projection only ... not financial advice". |
| 11 | "Adequately covered" overstates a monthly-income x 120 benchmark | TRUE | `index.tsx` insurance card | Relabelled "Insurance Coverage Snapshot" / "Meets 10-year benchmark" |
| 12 | Privacy page stale (sign-in methods, advisers, Sentry) | TRUE | `privacy.tsx` | Updated 2026-09-28 |
| 13 | Market/pricing conclusions (ChatGPT audit) | Business opinion | see notes outside repo | Not a code item. Advice accepted: get 5-10 real households before more features. |
| 14 | Sentry reporting unconfirmed | Open | architecture §9a | Open |

## Known deliberate / accepted behaviours (do not report as bugs without new evidence)
- Adviser views (`advisor_client_summary_view`, `advisor_networth_components_view`) grant SELECT broadly but rows are filtered by `has_advisor_access()` (which reads `auth.uid()`); flagged "Unrestricted" by Supabase's linter. Checked 2026-09-23 and re-read 2026-09-28. Single-layer protection is a known soft spot.
- `households` INSERT policy is `true` (any signed-in user can create an empty household). Real households are created by the signup trigger.
- Foreign-currency amounts convert at cached daily rates (base SGD: `rates[CUR]` = units of CUR per 1 SGD); a missing rate contributes $0 rather than face value.

## Change log of database SQL run by hand (see `supabase/migrations/`)
2026-09-28: `..._advisor_networth_property_mortgage.sql` (run, verified), `..._restrict_household_users_insert.sql` (run, user-tested), `..._deleted_records_editor_only.sql` (written; mark as run when done).

## How to verify quickly (read-only SQL for the Supabase SQL Editor)
- Write policies by table: `select tablename, cmd, policyname, coalesce(with_check, qual) from pg_policies where schemaname='public' order by 1,2;`
- Function bodies: `select proname, pg_get_functiondef(oid) from pg_proc where pronamespace='public'::regnamespace;`
- Buckets: `select id, public from storage.buckets;` and `select policyname, cmd from pg_policies where schemaname='storage';`
- Whole structure: run `supabase/schema-snapshot/dump-schema.sql`.
