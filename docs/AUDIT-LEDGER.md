# Audit ledger — read first when reviewing FamilyHub SG

Short on purpose: what is already verified, what is deliberate, what is still open. Update it when something changes. Last updated: 2026-09-28.

**Where the truth lives**
- Database structure and security: `supabase/schema.sql` (generated from the live database; see `supabase/README.md`).
- Mortgage-as-liability rule: `src/lib/netWorthMath.ts` (tested), used by the dashboard and the Word estate summary; adviser side is the SQL view `advisor_networth_components_view` + `src/lib/advisorAccess.ts`.
- Nightly jobs: `wrangler.jsonc` (two cron triggers), `src/lib/scheduledJobs.ts`, `src/lib/backupCron.ts`.
- Plain-English overview: `familyhub-architecture.md`. Public-claims guidance: `trust-safety-scorecard.md`.

**Claims that were checked and are FALSE (do not re-report)**
- "Viewers can write to the database": false. All financial tables allow writes only via `is_household_editor()` (owner/member). (Old migration files misled an earlier audit.)
- "Storage buckets are public": false. Both buckets are private (`schema.sql`, bucket lines).

**Fixed 2026-09-28** (all live; see `schema.sql` and git history)
- Mortgages entered only on the Property tab were missing from net worth (dashboard, adviser view, Word summary). One shared rule now.
- Loan interest in the lifetime chart is now monthly.
- `household_users` insert loophole closed (only an owner can add members).
- Recycle Bin table writes limited to editors.
- Nightly backup was exceeding Cloudflare's free 50-request limit; backup now has its own cron trigger.
- Storage file writes/deletes limited to editors; unused broad adviser read rules removed from 6 tables (SQL run status: see chat/`schema.sql`).

**Deliberate / accepted**
- Adviser views are "Unrestricted" in Supabase's linter; rows are filtered inside by `has_advisor_access()`. Single-layer protection.
- `households` INSERT is open to any signed-in user (the sign-up trigger relies on the same table; empty households are harmless).
- Lifetime chart is an illustration (footer says "not financial advice"); insurance card is a "10-year benchmark", not an adequacy verdict.
- Sharing by email tells an owner whether an account exists (minor account-enumeration).

**Open**
- Photos/documents are not backed up (only data tables). Backup headroom on the free plan is thin (~35 of 50 requests).
- Confirm Sentry actually reports events.
- Mortgage can still be entered in two places (Property tab and Loans tab); a dashboard note warns of double entry.
