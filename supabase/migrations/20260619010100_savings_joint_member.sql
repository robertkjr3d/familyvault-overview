-- Joint account support for savings_accounts.
-- When joint_member_id is set, the account belongs to both the primary member_id
-- and this secondary member. Displayed as a "Joint with [name]" badge on the card
-- and a second member tag in the title row.
alter table public.savings_accounts
  add column if not exists joint_member_id uuid references public.members(id) on delete set null;
