# Audit ledger — read first when reviewing FamilyHub SG

Short on purpose: what is already verified, what is deliberate, what is still open. Update it when something changes. Last updated: 2026-10-01.

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

**Fixed 2026-10-01**
- Browser-side Sentry is confirmed working end to end: a deliberate test error (`Sentry test 3`) run from the browser console arrived as a Sentry email within minutes. The URL-stripping change is also confirmed in PostHog (the pageview recorded for the `?test=` visit shows the bare address).
- Last step of tour 2 ("There it is"): the highlight covered only part of "Due in the Next 90 Days" (about 2.5 entries). Cause from reading the code: the tour measures a highlight twice (on arrival and ~400ms later) and the list fills in afterwards as reminders and other records load. The step now sets `trackLayout`, so while it is showing the tour watches the section and the page column around it (`src/lib/layoutWatch.ts`), re-centres and re-measures on any size change. Event-based, only on this step. Not yet confirmed on a real device.

**Fixed 2026-09-30**
- Signing out from Settings left the address on `/settings`, so the next email-code or passkey sign-in landed on Settings (Google always returns to `/`). Sign-out now clears cached data, ends any tour and returns to `/` (`src/routes/__root.tsx`).
- Saved browser state (selected household, member filter, "wizard dismissed", a running tour) leaked between accounts on one browser; a saved running tour started by itself for the next person. Saved state is now stamped with the signed-in user and reset when another user signs in (`claimUiForUser` in `src/lib/store.ts`, tested); a running tour, tour step and share sheet are no longer saved.
- The onboarding wizard no longer opens on top of a running tour (`src/routes/index.tsx`).
- The Worker's crash report to Sentry now sends the path only (`src/server.ts`, owner approved).
- Tour step 3 ("Quick check") pinned to the top-left corner on a slow first visit to Loans (Firefox). Cause from reading the code, not reproduced: the Dashboard and Loans both had a filter bar named `member-filter`, so while Loans was still downloading the tour grabbed the Dashboard's bar, which then disappeared. Loans' bar is now `member-filter-loans` (`tourTarget` prop on `MemberFilterBar`); a test fails if two pages ever share a target name.
- A slow save (about 8s) outlasted the tour's 5s wait for the new loan card, so the tour ended mid-save and "Want more tips & tricks?" appeared early. The last step and step 3 now wait up to 15s (new per-step `waitForElement`; it only sets an upper limit, driver.js still highlights the moment the target exists).
- The passkey prompt appeared seconds after the tour: finishing the tour marks it seen at once, which defeated the prompt's own "next visit" gate. It is now skipped in a visit where the tour question was just answered.
- The tour welcome popup no longer lands on the Dashboard straight after the onboarding wizard (whose last item scrolls to the net-worth chart); it waits until the person opens another tab.
- The error logger now prints its own failure reason, not just the original message.

**Fixed 2026-09-29**
- Lifetime chart kept charging a loan's or mortgage's full payment after its balance reached zero (and, with no end date, forever). Loans and mortgages with a rate AND a balance now pay only what is owed in the final year, then nothing (`loanYearRepayment` in `src/lib/lifetimeChartMath.ts`, tested). A `loan_end_date` still stops payments earlier.
- Browser error reporting was broken in the code: `src/lib/errorLogger.ts` used `reportToSentry`/`SENTRY_DSN` without importing or defining them (two of the old type errors), so the call would throw inside its try/catch before the `error_logs` insert. Fixed; needs `VITE_SENTRY_DSN` as a Cloudflare Build variable to reach Sentry.
- Invite/sign-in URLs (tokens, invited email in `?query`/`#hash`) no longer go to third parties: PostHog events are cleaned in `before_send` and session replay is skipped for page loads that arrive with a query or hash (`src/routes/__root.tsx`); `error_logs.page_url` and browser-side Sentry reports get the path only (`stripUrlSecrets` in `src/lib/sentryReport.ts`).
- In-app tips and privacy page now say: deleted items/documents stay in the Recycle Bin for 30 days; replacing or removing a photo on an existing item deletes it immediately; keep your own copy of important files.

**Deliberate / accepted**
- Adviser views are "Unrestricted" in Supabase's linter; rows are filtered inside by `has_advisor_access()`. Single-layer protection.
- `households` INSERT is open to any signed-in user (the sign-up trigger relies on the same table; empty households are harmless).
- Lifetime chart is an illustration (footer says "not financial advice"); insurance card is a "10-year benchmark", not an adequacy verdict.
- Sharing by email tells an owner whether an account exists (minor account-enumeration).

**Open**
- Photos/documents have no automatic backup (only data tables); users are told to keep their own copy, and Settings > Data has a full ZIP download. Backup headroom on the free plan is thin (~35 of 50 requests) and grows with table row counts (1 request per 1,000 rows).
- Sentry: browser reporting confirmed (1 Oct). The Worker-side crash report (path-only URL, `src/server.ts`) is deployed but has not been exercised by a real server crash. `sentryReport.ts` uses Sentry's legacy `/store/` endpoint, which works today; move to the envelope endpoint only if events ever stop.
- Tour 2 last step highlight fix (`trackLayout`) awaits a real-device check. If the highlight still stops mid-row, get a screenshot and the window size; if it simply runs off the bottom of a short window, the section is taller than the window and nothing can show all of it.
- Unexplained, not yet reproduced: an invited person's tour and onboarding wizard appeared together after several idle minutes, with the tour's first step skipped. Retest in a clean browser after the 2026-09-30 deploy; do not touch Driver.js until then.
- Lifetime chart does not use `loan_rate_schedule` (rates held constant); a loan with a rate but no balance recorded, or no rate, cannot be paid off in the projection and keeps charging until its end date.
- Old mortgage columns on `properties` (`mortgage_bank`, `mortgage_balance`, `monthly_payment`, `interest_rate`, `rate_type`, `fixed_rate_end`, `mortgage_end_date`): nothing writes them since 3 Oct 2026 (a mortgage is a linked loan) and the live values were cleared on 4 Oct 2026 (3 rows). DELIBERATELY KEPT for now: the columns, the fallbacks in `netWorthMath.ts`, `lifetimeChartMath.ts`, the dashboard and the Word summary, and the branch in `advisor_networth_components_view`. On clean data they do nothing, and they stop a mortgage silently dropping out of net worth if an old value ever reappears (for example a property restored from the Recycle Bin). Remove only after BOTH checks return 0: (1) properties with any of the seven columns not null, (2) `deleted_records` rows with `table_name = 'properties'` whose `record_data` has any of them not null. Then in this order: code fallbacks and their tests, the adviser view branch, the columns.
