# FamilyHub SG — Architecture Reference

Plain-English reference doc, written for a non-technical reader. Read this
FIRST in a new chat before touching anything — it saves re-deriving the
whole schema/security model from scratch every session.

**Last refreshed: 2026-09-25, from a real live `information_schema.columns`
+ `pg_policies` dump the user ran and pasted in** (not derived from code or
migration files — see "Keeping this current" at the bottom for how this
was done and how to do it again).

## What this app is
TanStack Start + React + Vite + Tailwind + Bun, Supabase (Postgres + Auth +
Storage) on the Singapore region, deployed to Cloudflare Workers. Repo
`robertkjr3d/familyvault-overview`, branch `azariah`, auto-deploys on push.

## The golden rule about this repo's migrations folder
`supabase/migrations/` is **documentation only — not the live source of
truth.** Confirmed repeatedly, most recently 2026-09-25: the migration
history shows storage.objects' SELECT policy as still open/unscoped
("vault-docs public read", no household check), but a live query the same
day showed the REAL policy (`fv storage household read`) already properly
scoped — someone fixed this live without ever committing a matching
migration. **Never assume the migrations folder reflects what's actually
live, and never write "fix" SQL from migration history alone — always ask
for a live, targeted check first, even when a fix seems obviously needed.**

## Tables — real, live list as of 2026-09-25 (supersedes the generated types.ts, which is missing several of these)
Core financial records (all go through the shared `useDeleteMutation` →
Recycle Bin pattern): `properties`, `loans`, `insurance_policies`,
`investments`, `savings_accounts`, `other_assets`, `health_conditions`,
`credit_cards`.

Household/people: `households`, `household_users`, `household_invites`,
`members`.

Inventory: `inventory_items`, `inventory_folders`. (`inventory_locations`
was dropped live weeks ago but still shows in the generated `types.ts` —
confirmed gone for real this time, absent from the live column dump too.)

Supporting: `reminders`, `record_documents`, `record_history` (manual
notes/timeline entries a user adds — NOT the audit trail), `audit_log`
(the REAL audit trail — old_data/new_data/changed_fields, trigger-driven,
no direct client INSERT/UPDATE/DELETE policy exists for it — confirms
writes happen via a trigger running as table owner, not from the browser;
only a household-scoped SELECT policy exists), `deleted_records` (the
Recycle Bin, has `batch_id` for grouped folder-delete restores),
`dismissed_dashboard_items`, `app_settings`, `user_profiles`, `error_logs`
(INSERT-only from the client — own-row-only, `auth.uid() = user_id`; no
SELECT policy, so users can't read error logs back, only the admin/service
role can — by design), `fx_rates` (SELECT open to any authenticated user,
`qual: true` — correct, exchange rates aren't household-specific; no
client-facing write policies, only a service-role cron writes these).

Planning/checklists: `estate_checklist`, `travel_checklist_items`,
`gobag_items`, `planned_cashflow_events`, `loan_rate_schedule`,
`property_rate_schedule`.

Advisor sub-system: `advisor_household_links`, `advisor_invites`,
`advisor_link_members` (the one CASCADE-on-member-delete exception — every
other table SET NULLs a deleted member's records instead),
`advisor_policy_charts`, `advisor_record_notes`, plus two VIEWs
(`advisor_client_summary_view`, `advisor_networth_components_view` — views
don't carry their own RLS policies, they inherit from underlying tables).

**`household_invites` and `advisor_invites` deliberately have NO client-facing
RLS policies at all** — confirmed by their total absence from the live
`pg_policies` dump (not a truncation artifact — checked, the gap falls in
the middle of the alphabetical list where a LIMIT-100 cutoff couldn't
explain it) AND confirmed in the actual code: both are only ever queried
via `supabaseAdmin`, dynamically imported from
`@/integrations/supabase/client.server` (a server-only module, never
shipped to the browser) — never from the regular RLS-bound client. This
makes sense structurally: accepting an invite requires reading a token
BEFORE the person is a household member, so `is_household_member()` could
never work for them anyway. **One thing not yet confirmed live (should be,
for full certainty rather than "very likely"):** whether RLS is actually
*enabled* at the table level on these two (with zero policies, meaning
fully blocked for any direct client request) versus RLS being *disabled*
(meaning a direct REST API call with just the anon key could read them,
bypassing the app entirely even though the app itself never does this).
Check with:
```sql
select relname, relrowsecurity from pg_class where relname in ('household_invites','advisor_invites');
```
`relrowsecurity = true` for both confirms this is fully fine as designed.

## Storage
Two real buckets: `vault-docs` (documents) and `inventory-photos`
(photos). A third, `documents`, was confirmed empty and deleted 2026-09-21.

**Path convention:** `<household_id>/<subfolder>/<timestamp>-<filename>`.

**Confirmed fully fixed and secure, live, 2026-09-25:** both buckets are
`public = false`, AND all four operations on `storage.objects`
(`fv storage household read/insert/update/delete`) correctly scope by
parsing the household_id out of the path and checking
`is_household_member()` (read) / editor-equivalent for writes, with a
sensible `owner = auth.uid()` fallback on update/delete so whoever
literally uploaded a file can also manage it. The open "public read"
policies that used to exist (per migration history) are gone from the live
database. **No outstanding storage security issue as of this refresh.**

App code itself only ever uses `getDisplayUrl`/`getExportUrl` (signed
URLs) — confirmed via repo-wide grep, `getPublicUrl` is never called.

## RLS pattern
Two functions gate almost everything: `is_household_member()` (read) and
`is_household_editor()` (write) — the overwhelming majority of tables
follow the exact same four-policy shape (`tenant_select` /
`tenant_insert` / `tenant_update` / `tenant_delete`, or an
equivalently-named set). `current_household_id()` exists but appears
unused by any live policy — flagged as safe to drop, not yet dropped.

Advisor read access additionally goes through `has_advisor_access(household_id,
member_id, category)`, and insurance/investments respect a per-record
`hidden_from_advisors` flag even when advisor access is otherwise granted
— confirmed real, checked directly in the advisor SELECT policy's `qual`.

## Storage quota
`households.storage_tier` / `storage_bytes_used`, via
`increment_household_storage(household_id, delta)` — hardened 2026-09-21 to
recompute the true total from `storage.objects` directly, ignoring
whatever delta the caller passed.

## Net worth calculation — KNOWN BUG, not yet fixed
See Claude's memory file `networth-calc-bug` for the full report and fix
plan (not duplicated here since it's implementation-detail-heavy and this
doc is meant to stay a stable overview). Summary: loan/mortgage principal
repayment is currently treated as a full net-worth loss instead of being
roughly neutral — only interest should count. Not yet fixed as of
2026-09-25.

## Known safe-to-clean housekeeping (not yet done, low priority)
- Regenerate `types.ts` from the live schema (stale — was missing several
  real tables like `audit_log`/`fx_rates`/the advisor tables, and still
  lists the already-dropped `inventory_locations`).
- Drop `current_household_id()` (confirmed unused by any policy).
- `other_assets` has two DELETE triggers doing the same reminder-cleanup —
  redundant, not dangerous, worth deduplicating.
- 9 GitHub Actions secrets from the Seoul→Singapore migration remain by the
  user's own deliberate choice (Seoul holds only family data) — revisit
  before onboarding non-family households, not before.

## Checklist: everything a new record-type/tab must be wired into
See `familyhub-sg.md` in Claude's memory for the full 14-point checklist —
kept there rather than duplicated here since it changes more often than
this doc should.

## Keeping this current
This doc is a snapshot, not a live connection. To refresh it accurately,
run these two read-only queries in the Supabase SQL Editor (use "No limit"
if the editor offers it — the default 100-row cap can silently truncate
the policy list) and paste both results into a new chat:

```sql
select table_name, column_name, data_type, udt_name, is_nullable
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;
```

```sql
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname in ('public', 'storage')
order by tablename, policyname;
```

Ask Claude to refresh this file from the pasted results — much faster and
more reliable than re-deriving the schema from application code, and the
only way to catch a live-vs-migration divergence like the one found today.
