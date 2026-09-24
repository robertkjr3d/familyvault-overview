# FamilyHub SG — Trust & Safety Scorecard

*Written 23 Sep 2026. Ratings are against "what's genuinely good for a free/low-cost app run by one non-technical founder, for families" — not against a bank or a funded startup with a security team. An 8-10 here means "as good as this app realistically needs to be," not "not quite perfect." 🟢 8-10 · 🟡 5-7 · 🔴 1-4.*

*How to read the last two columns: **Tradeoffs** explains the honest cost of the current choice (or of improving it) — not every low score needs fixing. **Recommendation** is the actual call: keep as-is, or do something, in plain words.*

## Security & data protection

| Feature | Rating | Options to improve | Tradeoffs | Recommendation |
|---|:---:|---|---|---|
| Data encryption (Supabase — AES-256 at rest, TLS in transit) | 🟢 9 | Full "zero-knowledge" end-to-end encryption | Would make a lost password unrecoverable and break the app's own calculations (net worth, charts) — already deliberately rejected for this reason | **Keep as-is.** This is the industry-standard approach; going further trades away real functionality for marginal gain at this scale. |
| Login (passkeys + Google + email code) | 🟢 9 | Add 2FA/TOTP on top | Extra friction for a non-technical family audience, for a login method that's already phishing-resistant | **Keep as-is.** Passkeys are genuinely ahead of what most small apps offer. |
| One family's data kept separate from another's (core tables) | 🟢 8 | Tighten the 2 adviser-only views and the database's general public-facing permissions (see next row) | Needs a dedicated review session, not a quick patch | **Fine for now** (family/friend testing). Do the review below before any adviser outside the family gets real access. |
| 2 adviser-dashboard views flagged "Unrestricted" by Supabase | 🟢 8 (checked 23 Sep — safe today) | Give these views their own database-level access rule anyway, for a backup layer | None — this only adds a backup layer, doesn't remove anything a real adviser is meant to see | **Not urgent.** Verified the actual function correctly blocks anyone not a genuine logged-in adviser. Supabase's red icon will keep showing regardless — that's expected, it doesn't understand this view's protection method. |
| Who's allowed to even ask the database for data (`anon` role grants) | 🟡 6 | Narrow these to only what's actually needed | Real review work; low urgency while everything is filtered by the rule above anyway | **Revisit alongside the adviser-views item** — same root cause, same session. |
| Consent notice at sign-in (Singapore PDPA) | 🟢 7 | Add a logged tick-box + timestamp | Extra sign-up friction for no legal requirement at this stage | **Fine for now.** Add explicit logging before charging money or scaling past family/friends. |
| Session handling (no auto-logout, no 2FA) | 🟢 7 | Add an idle timeout | Real friction on a family's own trusted devices, for a threat that mostly doesn't apply here | **Keep as-is** — a deliberate, sensible choice for this kind of app. |

## Data safety & backups

| Feature | Rating | Options to improve | Tradeoffs | Recommendation |
|---|:---:|---|---|---|
| Nightly database backup (32 tables, completeness-checked) | 🟢 8 | Copy outside Cloudflare too; a full scheduled database dump | More cost, more moving parts | **Good as-is for beta.** Revisit once real paying households depend on it. |
| Backup failure alerts (new) | 🟢 8 | — | Unproven in real production yet (just added) | **Keep, re-confirm in a few weeks.** |
| Photos & documents backup | 🟡 5 | Sync files to backup storage too | Needs a paid tier or extra infrastructure | **Fine for now** — users can already download everything themselves anytime. Revisit before this matters to real irreplaceable documents. |
| Self-service full export (Excel + ZIP, notes/reminders included, no longer CDN-dependent) | 🟢 9 | — | None | **Keep — this is genuinely strong and safe to advertise.** |
| Recycle Bin (30-day undo) | 🟡 7 | Extend to inventory, members, single documents | More code paths to maintain | **Fine as-is.** Don't claim "everything is undoable" publicly — it isn't, yet. |
| Storage limits enforced honestly (can't be tricked into using more than paid for) | 🟢 9 | — | None | **Keep.** |
| Free-tier cost headroom as the app grows | 🟡 7 | Move to Cloudflare's paid tier ($5/month) when needed | A real but predictable, small, planned cost — not a surprise | **Not urgent.** Being watched via the failure-alert system above. |

## Reliability & support

| Feature | Rating | Options to improve | Tradeoffs | Recommendation |
|---|:---:|---|---|---|
| Real-time error alerts (Sentry, new) | 🟡 6 (setup done, not yet confirmed working) | Retest properly — a DevTools-console-typed error doesn't count as a real test | None | **Retest before trusting this.** A first test showed 0 events reaching Sentry; the test method itself was likely the issue, not the wiring — see notes for the correct retest. Don't rely on this catching real bugs until confirmed. |
| Rate limiting on invites | 🟢 7 | Extend the same idea to other sensitive actions | Minor extra work | **Fine for now.** |
| App no longer depends on another company's website at the moment someone downloads a file | 🟢 9 | — | None | **Keep — fixed this session, verified with a real test.** |

## Adviser (financial adviser) features

| Feature | Rating | Options to improve | Tradeoffs | Recommendation |
|---|:---:|---|---|---|
| Selective, per-category, per-member sharing with an adviser | 🟢 8 | — | None | **Keep — genuinely differentiated, safe to advertise once the "Unrestricted" item above is closed.** |
| Audit trail on core financial records | 🟢 8 | Extend to Credit Cards, Health, Inventory | Slightly more to maintain | **Fine as-is.** Extend only if users specifically ask "who changed this." |

---

## Ready-to-use FAQ wording (pulled only from the 🟢 rows above)

Use these as starting points, not final copy — adjust tone to match your site:

- *"Is my data encrypted? Yes — bank-standard encryption both while stored and while it travels between your device and our servers."*
- *"How do I log in securely? With a passkey — the same phishing-resistant technology Apple, Google, and major banks use, backed up by Google sign-in or a one-time email code."*
- *"Can I get my data out at any time? Yes, in full — a spreadsheet covering every record plus all your uploaded documents and photos, in one download, with nothing locked in."*
- *"What if I delete something by accident? Most records can be restored yourself within 30 days."*
- *"Is my family's data mixed up with anyone else's? No — every family's data is kept completely separate at the database level, the same approach professional finance apps use."*
- *"Can I control exactly what my adviser sees?"* — hold this one until the "Unrestricted" item below is resolved.

**Don't yet claim publicly** (not false, just not fully true today): "everything is backed up" (photos/documents aren't yet), "every action is undoable" (only the main records are), "SOC 2 / bank-grade" or similar formal compliance language (no such certification exists or is warranted at this size).
