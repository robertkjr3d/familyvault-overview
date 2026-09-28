-- Adds property-only mortgages to the adviser net worth view.
--
-- WHY: advisor_networth_components_view only emitted a "loan" row from the
-- loans table. A mortgage entered only on the Property tab (properties.
-- mortgage_balance, no linked loans row) was never counted as a liability, so
-- the adviser dashboard/PDF overstated net worth. Family dashboard fixed the
-- same day (src/routes/index.tsx).
--
-- RECORD KEEPING: this file was run by hand in the Supabase SQL Editor.
-- supabase/migrations/ is documentation, not an auto-run pipeline.
--
-- BEFORE RUNNING: confirm the view's existing options/grants first (see chat
-- diagnostic). CREATE OR REPLACE VIEW can reset view options, so any option
-- found there must be re-applied with ALTER VIEW ... SET (...) right after.
--
-- ROLLBACK: re-create the view from the previous definition (the six-branch
-- version ending in the "loan" branch), or simply delete the new branch below.

CREATE OR REPLACE VIEW public.advisor_networth_components_view AS
 SELECT properties.household_id,
    'property'::text AS source_type,
    properties.current_value AS amount,
    properties.currency,
    NULL::text AS account_type,
    properties.member_id
   FROM properties
  WHERE has_advisor_access(properties.household_id, properties.member_id, 'networth_summary'::text)
UNION ALL
 SELECT investments.household_id,
    'investment'::text AS source_type,
    investments.current_value AS amount,
    investments.currency,
    NULL::text AS account_type,
    investments.member_id
   FROM investments
  WHERE has_advisor_access(investments.household_id, investments.member_id, 'networth_summary'::text)
UNION ALL
 SELECT savings_accounts.household_id,
    'savings'::text AS source_type,
    savings_accounts.balance AS amount,
    savings_accounts.currency,
    savings_accounts.account_type,
    savings_accounts.member_id
   FROM savings_accounts
  WHERE has_advisor_access(savings_accounts.household_id, savings_accounts.member_id, 'networth_summary'::text)
UNION ALL
 SELECT other_assets.household_id,
    'other_asset'::text AS source_type,
    other_assets.estimated_value AS amount,
    other_assets.currency,
    NULL::text AS account_type,
    other_assets.member_id
   FROM other_assets
  WHERE has_advisor_access(other_assets.household_id, other_assets.member_id, 'networth_summary'::text)
UNION ALL
 SELECT insurance_policies.household_id,
    'insurance_surrender'::text AS source_type,
        CASE
            WHEN insurance_policies.surrender_value_date IS NULL OR insurance_policies.surrender_value_date <= CURRENT_DATE THEN insurance_policies.surrender_value
            ELSE 0::numeric
        END AS amount,
    insurance_policies.currency,
    NULL::text AS account_type,
    insurance_policies.member_id
   FROM insurance_policies
  WHERE has_advisor_access(insurance_policies.household_id, insurance_policies.member_id, 'networth_summary'::text)
UNION ALL
 SELECT loans.household_id,
    'loan'::text AS source_type,
    loans.balance AS amount,
    loans.currency,
    NULL::text AS account_type,
    loans.member_id
   FROM loans
  WHERE has_advisor_access(loans.household_id, loans.member_id, 'networth_summary'::text)
UNION ALL
 -- NEW: a property's own mortgage, only when no loans row is linked to it
 -- (a linked loan is already counted by the "loan" branch above).
 SELECT properties.household_id,
    'property_mortgage'::text AS source_type,
    properties.mortgage_balance AS amount,
    properties.currency,
    NULL::text AS account_type,
    properties.member_id
   FROM properties
  WHERE has_advisor_access(properties.household_id, properties.member_id, 'networth_summary'::text)
    AND properties.mortgage_balance IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM loans WHERE loans.property_id = properties.id);
