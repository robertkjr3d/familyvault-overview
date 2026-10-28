-- sample-family-seed.sql
-- Fills the shared "Sample family — FamilyHub SG" household (the one guests can look at).
--
-- HOW: Supabase -> SQL Editor -> paste this whole file -> Run. Then run
--      supabase/sample-family-check.sql.
-- SAFE TO RE-RUN: it wipes ONLY this one household's records and rebuilds them with dates
--      counted from today. Re-run about once a month so renewal dates stay in the future.
-- ALL OR NOTHING: it is one block. If anything fails, nothing is changed.
-- NEEDS: the placeholder owner account (sample-owner@example.com) and the 6 photos in
--      Storage > inventory-photos > <sample family id> > items. It stops with a clear
--      message, changing nothing, if either is missing.
-- NEVER delete the placeholder owner account: while it is a member, the app's clean-up rule
--      for "households with no members" can never remove the sample family.
-- All people, numbers and policies are made up. Policy numbers are fake.

DO $seed$
DECLARE
  hh  constant uuid := 'a750df45-c320-46fd-b2c8-82389878db07';
  own constant uuid := '6429b783-999a-4356-b695-4858a1e93330';
  d   date := (now() AT TIME ZONE 'Asia/Singapore')::date;        -- today, Singapore
  yr  int  := extract(year FROM (now() AT TIME ZONE 'Asia/Singapore'))::int;

  m_dan uuid := gen_random_uuid();  m_mei uuid := gen_random_uuid();
  m_eth uuid := gen_random_uuid();  m_chl uuid := gen_random_uuid();
  m_ama uuid := gen_random_uuid();

  p_hdb uuid := gen_random_uuid();  ln_hdb uuid := gen_random_uuid();
  f_liv uuid := gen_random_uuid();  f_bed uuid := gen_random_uuid();
  f_din uuid := gen_random_uuid();  f_kit uuid := gen_random_uuid();
  f_sto uuid := gen_random_uuid();
  i_oven uuid := gen_random_uuid(); i_tv uuid := gen_random_uuid();
  ins_ci uuid := gen_random_uuid(); ins_car uuid := gen_random_uuid();
  sav_fd uuid := gen_random_uuid(); inv_robo uuid := gen_random_uuid();
  hc_ama uuid := gen_random_uuid(); hc_dan uuid := gen_random_uuid();

  ph_name text[] := ARRAY['living-room-sofa','bedroom-wardrobe','dining-table',
                          'kitchen-cabinets-oven','store-room-shelf','suitcase-travel'];
  ph_path text[] := ARRAY[]::text[];
  ph_size bigint[] := ARRAY[]::bigint[];
  n text; v_name text; v_size bigint; missing text := '';
  at9 text := ' 09:00';
BEGIN
  ------------------------------------------------------------------ checks first
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = own AND email = 'sample-owner@example.com') THEN
    RAISE EXCEPTION 'Placeholder owner sample-owner@example.com (id %) not found. Nothing changed.', own;
  END IF;

  FOREACH n IN ARRAY ph_name LOOP
    v_name := NULL; v_size := NULL;
    SELECT o.name, coalesce((o.metadata->>'size')::bigint, 0) INTO v_name, v_size
    FROM storage.objects o
    WHERE o.bucket_id = 'inventory-photos'
      AND left(o.name, length(hh::text || '/items/' || n)) = hh::text || '/items/' || n
    ORDER BY o.name LIMIT 1;
    IF v_name IS NULL THEN
      missing := missing || ' ' || n;
      v_name := ''; v_size := 0;
    END IF;
    ph_path := ph_path || v_name;
    ph_size := ph_size || v_size;
  END LOOP;
  IF missing <> '' THEN
    RAISE EXCEPTION 'Photos not found in inventory-photos/%/items/:%. Nothing changed.', hh, missing;
  END IF;

  ------------------------------------------------------------------ the household row
  INSERT INTO households (id, name, storage_tier)
  VALUES (hh, 'Sample family — FamilyHub SG', 'free')
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

  INSERT INTO household_users (household_id, user_id, role)
  VALUES (hh, own, 'owner')
  ON CONFLICT (household_id, user_id) DO UPDATE SET role = 'owner';

  ------------------------------------------------------------------ wipe this household's records
  DELETE FROM reminders                WHERE household_id = hh;
  DELETE FROM dismissed_dashboard_items WHERE household_id = hh;
  DELETE FROM deleted_records          WHERE household_id = hh;
  DELETE FROM record_documents         WHERE household_id = hh;
  DELETE FROM record_history           WHERE household_id = hh;
  DELETE FROM planned_cashflow_events  WHERE household_id = hh;
  DELETE FROM estate_checklist         WHERE household_id = hh;
  DELETE FROM gobag_items              WHERE household_id = hh;
  DELETE FROM travel_checklist_items   WHERE household_id = hh;
  DELETE FROM inventory_items          WHERE household_id = hh;
  DELETE FROM inventory_folders        WHERE household_id = hh;
  DELETE FROM loan_rate_schedule       WHERE household_id = hh;
  DELETE FROM property_rate_schedule   WHERE household_id = hh;
  DELETE FROM loans                    WHERE household_id = hh;
  DELETE FROM insurance_policies       WHERE household_id = hh;
  DELETE FROM investments              WHERE household_id = hh;
  DELETE FROM savings_accounts         WHERE household_id = hh;
  DELETE FROM credit_cards             WHERE household_id = hh;
  DELETE FROM other_assets             WHERE household_id = hh;
  DELETE FROM health_conditions        WHERE household_id = hh;
  DELETE FROM properties               WHERE household_id = hh;
  DELETE FROM members                  WHERE household_id = hh;

  ------------------------------------------------------------------ family members
  INSERT INTO members (id, household_id, name, short_name, emoji, color, sort_order, birth_year) VALUES
    (m_dan, hh, 'Daniel Lim',      'DAN', '👨',  '#4F8EF7', 0, yr - 42),
    (m_mei, hh, 'Mei Ling Lim',    'MEI', '👩',  '#E5738B', 1, yr - 40),
    (m_eth, hh, 'Ethan Lim',       'ETH', '🧒',  '#3FA796', 2, yr - 12),
    (m_chl, hh, 'Chloe Lim',       'CHL', '👧',  '#E0A030', 3, yr - 9),
    (m_ama, hh, 'Ah Ma (Mdm Tan)', 'AMA', '👵',  '#8E6BC1', 4, yr - 73);

  ------------------------------------------------------------------ settings
  INSERT INTO app_settings (household_id, family_name, monthly_income, monthly_expenses,
      retirement_year, cpf_payout_age, cpf_monthly_payout, investment_growth_rate,
      property_appreciation_rate, inflation_rate, planning_horizon_age,
      mortgage_days, insurance_days, fd_days, warranty_days, onboarding_dismissed)
  VALUES (hh, 'Lim Family', 11800, 7400, yr + 21, 65, 1900, 5, 2, 2.5, 85, 90, 60, 30, 90, true)
  ON CONFLICT (household_id) DO UPDATE SET
      family_name = EXCLUDED.family_name, monthly_income = EXCLUDED.monthly_income,
      monthly_expenses = EXCLUDED.monthly_expenses, retirement_year = EXCLUDED.retirement_year,
      cpf_payout_age = EXCLUDED.cpf_payout_age, cpf_monthly_payout = EXCLUDED.cpf_monthly_payout,
      investment_growth_rate = EXCLUDED.investment_growth_rate,
      property_appreciation_rate = EXCLUDED.property_appreciation_rate,
      inflation_rate = EXCLUDED.inflation_rate, planning_horizon_age = EXCLUDED.planning_horizon_age,
      mortgage_days = EXCLUDED.mortgage_days, insurance_days = EXCLUDED.insurance_days,
      fd_days = EXCLUDED.fd_days, warranty_days = EXCLUDED.warranty_days,
      onboarding_dismissed = true, simulated_date = NULL;

  ------------------------------------------------------------------ property + loans
  INSERT INTO properties (id, household_id, member_id, joint_member_id, name, address, purpose,
      purchase_price, purchase_date, current_value, status, is_demo, notes)
  VALUES (p_hdb, hh, m_dan, m_mei, '4-room HDB flat, Sengkang', 'Sengkang, Singapore', 'own_home',
      465000, (d - interval '7 years 6 months')::date, 640000, 'settled', true,
      'Sample data. Home since the year the family moved in.');

  INSERT INTO loans (id, household_id, member_id, bank, purpose, property_id, original_amount,
      balance, start_date, term_years, rate, monthly_payment, loan_end_date, status, is_demo, notes)
  VALUES
    (ln_hdb, hh, m_dan, 'Other', 'HDB housing loan', p_hdb, 372000, 284500,
      (d - interval '7 years 6 months')::date, 25, 2.6, 1688,
      (d - interval '7 years 6 months' + interval '25 years')::date, 'settled', true,
      'Paid partly from CPF Ordinary Account.'),
    (gen_random_uuid(), hh, m_dan, 'DBS', 'Car loan', NULL, 70000, 41700,
      (d - interval '3 years')::date, 7, 2.78, 918,
      (d - interval '3 years' + interval '7 years')::date, 'settled', true, NULL);

  ------------------------------------------------------------------ insurance
  INSERT INTO insurance_policies (id, household_id, member_id, name, category, provider, policy_number,
      premium, frequency, sum_assured, start_date, end_date, next_due_date, is_giro, status, is_demo, coverage, notes) VALUES
    (gen_random_uuid(), hh, m_dan, 'Term life, 25 years', 'Life', 'Great Eastern', 'SAMPLE-0001',
      620, 'annual', 500000, (d - interval '6 years')::date, (d - interval '6 years' + interval '25 years')::date,
      d + 41, true, 'settled', true, 'Death and total permanent disability', NULL),
    (ins_ci, hh, m_dan, 'Critical illness cover', 'Critical Illness', 'AIA', 'SAMPLE-0002',
      2340, 'annual', 200000, (d - interval '5 years')::date, (d - interval '5 years' + interval '30 years')::date,
      d + 12, false, 'review', true, 'Multi-stage critical illness', 'Renewal notice received. Check the premium before it is paid.'),
    (gen_random_uuid(), hh, m_dan, 'Hospital plan (integrated shield)', 'Health', 'Prudential', 'SAMPLE-0003',
      1420, 'annual', 0, (d - interval '9 years')::date, NULL, d + 175, true, 'settled', true, 'Private hospital, B1 ward', NULL),
    (gen_random_uuid(), hh, m_mei, 'Term life, 25 years', 'Life', 'NTUC Income', 'SAMPLE-0004',
      480, 'annual', 400000, (d - interval '6 years')::date, (d - interval '6 years' + interval '25 years')::date,
      d + 160, true, 'settled', true, 'Death and total permanent disability', NULL),
    (gen_random_uuid(), hh, m_mei, 'Hospital plan (integrated shield)', 'Health', 'Great Eastern', 'SAMPLE-0005',
      1150, 'annual', 0, (d - interval '9 years')::date, NULL, d + 230, true, 'settled', true, 'Private hospital, B1 ward', NULL),
    (gen_random_uuid(), hh, m_eth, 'Child hospital and surgical', 'Health', 'Great Eastern', 'SAMPLE-0006',
      380, 'annual', 0, (d - interval '8 years')::date, NULL, d + 96, false, 'settled', true, NULL, NULL),
    (gen_random_uuid(), hh, m_chl, 'Child hospital and surgical', 'Health', 'Great Eastern', 'SAMPLE-0007',
      360, 'annual', 0, (d - interval '7 years')::date, NULL, d + 96, false, 'settled', true, NULL, NULL),
    (ins_car, hh, m_dan, 'Car insurance', 'Car', 'NTUC Income', 'SAMPLE-0008',
      1450, 'annual', 0, (d - interval '1 year' + interval '38 days')::date, NULL, d + 38, false, 'review', true,
      'Comprehensive', 'Compare quotes before renewing.'),
    (gen_random_uuid(), hh, m_dan, 'Home contents', 'Home', 'Etiqa', 'SAMPLE-0009',
      168, 'annual', 60000, (d - interval '2 years')::date, NULL, d + 250, false, 'settled', true, NULL, NULL),
    (gen_random_uuid(), hh, m_ama, 'Personal accident', 'Personal Accident', 'NTUC Income', 'SAMPLE-0010',
      220, 'annual', 50000, (d - interval '3 years')::date, NULL, d + 130, false, 'settled', true, NULL, NULL);

  ------------------------------------------------------------------ investments
  INSERT INTO investments (id, household_id, member_id, name, group_name, cost_basis, current_value,
      projected_return_pct, last_updated, premium_amount, premium_frequency, premium_start_date,
      premium_end_date, payout_amount, payout_start_date, payout_end_date, payout_frequency, status, is_demo, notes) VALUES
    (gen_random_uuid(), hh, m_dan, 'Singapore index ETF', 'Exchange Traded Fund (ETF)', 22000, 25800, 6, d - 10,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'settled', true, NULL),
    (inv_robo, hh, m_mei, 'Global robo portfolio', 'Robo-Advisor Portfolio', 30000, 34200, 5.5, d - 20,
      500, 'monthly', (d - interval '4 years')::date, NULL, NULL, NULL, NULL, NULL, 'settled', true, 'Monthly top-up.'),
    (gen_random_uuid(), hh, m_eth, 'Education endowment (Ethan)', 'Endowment', 18000, 17200, 3.5, d - 40,
      3600, 'annual', (d - interval '5 years')::date, (d + interval '2 years')::date,
      60000, (d + interval '6 years')::date, (d + interval '6 years')::date, 'one-off', 'settled', true,
      'Pays out when Ethan starts university.'),
    (gen_random_uuid(), hh, m_dan, 'SRS unit trust', 'SRS', 20000, 24000, 5, d - 15,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'settled', true, NULL),
    (gen_random_uuid(), hh, m_mei, 'Singapore REITs', 'REITs', 11000, 12400, 5, d - 30,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'review', true, 'Check the yield against the fixed deposit rate.');

  ------------------------------------------------------------------ savings, CPF, SRS
  INSERT INTO savings_accounts (id, household_id, member_id, joint_member_id, institution, account_type,
      balance, interest_rate, monthly_contribution, maturity_date, last_updated, status, is_demo, notes) VALUES
    (gen_random_uuid(), hh, m_mei, m_dan, 'OCBC', 'Savings Account', 42500, 2.0, 1500, NULL, d - 5, 'settled', true, 'Joint account. Household bills come from here.'),
    (gen_random_uuid(), hh, m_dan, NULL, 'DBS', 'Savings Account', 18600, 1.0, NULL, NULL, d - 5, 'settled', true, NULL),
    (sav_fd, hh, m_dan, NULL, 'UOB', 'Fixed Deposit (FD)', 30000, 3.0, NULL, d + 47, d - 60, 'review', true, 'Decide: roll over or move.'),
    (gen_random_uuid(), hh, m_mei, NULL, 'MAS', 'T-Bills / Singapore Savings Bonds', 20000, 2.9, NULL, d + 420, d - 30, 'settled', true, NULL),
    (gen_random_uuid(), hh, m_dan, NULL, 'CPF Board', 'CPF-Ordinary Account (OA)', 78000, 2.5, NULL, NULL, d - 12, 'settled', true, NULL),
    (gen_random_uuid(), hh, m_dan, NULL, 'CPF Board', 'CPF-Special Account (SA)', 61000, 4.0, NULL, NULL, d - 12, 'settled', true, NULL),
    (gen_random_uuid(), hh, m_dan, NULL, 'CPF Board', 'CPF-Medisave Account (MA)', 48000, 4.0, NULL, NULL, d - 12, 'settled', true, NULL),
    (gen_random_uuid(), hh, m_mei, NULL, 'CPF Board', 'CPF-Ordinary Account (OA)', 69000, 2.5, NULL, NULL, d - 12, 'settled', true, NULL),
    (gen_random_uuid(), hh, m_mei, NULL, 'CPF Board', 'CPF-Special Account (SA)', 52000, 4.0, NULL, NULL, d - 12, 'settled', true, NULL),
    (gen_random_uuid(), hh, m_mei, NULL, 'CPF Board', 'CPF-Medisave Account (MA)', 44000, 4.0, NULL, NULL, d - 12, 'settled', true, NULL),
    (gen_random_uuid(), hh, m_dan, NULL, 'DBS', 'SRS (Supplementary Retirement Scheme)', 14000, 0.05, NULL, NULL, d - 20, 'settled', true, NULL),
    (gen_random_uuid(), hh, m_eth, NULL, 'Post Office', 'Other', 3150, 0, NULL, NULL, d - 90, 'settled', true, 'Edusave'),
    (gen_random_uuid(), hh, m_chl, NULL, 'Post Office', 'Other', 2480, 0, NULL, NULL, d - 90, 'settled', true, 'Edusave');

  ------------------------------------------------------------------ cards
  INSERT INTO credit_cards (household_id, member_id, name, issuer, network, last4, card_status,
      reward_type, points_balance, points_expiry_date, min_spend, annual_fee, status, is_demo, notes) VALUES
    (hh, m_mei, 'Everyday cashback card', 'UOB', 'Visa', '1111', 'Active', 'Cashback', NULL, NULL, 600, 0, 'settled', true, NULL),
    (hh, m_dan, 'Miles card', 'DBS', 'Mastercard', '2222', 'Active', 'Miles', 38200, d + 55, NULL, 196, 'review', true, 'Use or transfer the miles before they expire.');

  ------------------------------------------------------------------ other assets
  INSERT INTO other_assets (household_id, member_id, name, category, estimated_value, last_updated, status, is_demo, notes) VALUES
    (hh, m_dan, 'Family car', 'Vehicle', 52000, d - 30, 'settled', true, 'Certificate of Entitlement (COE) ends in about 7 years.'),
    (hh, m_mei, 'Wedding jewellery', 'Jewellery', 9500, d - 200, 'settled', true, NULL),
    (hh, m_eth, 'Digital piano', 'Instrument', 3200, d - 120, 'settled', true, NULL);

  ------------------------------------------------------------------ health
  INSERT INTO health_conditions (id, household_id, member_id, name, supplements, actions, details, status, is_demo) VALUES
    (hc_dan, hh, m_dan, 'Annual health screening', '[]'::jsonb, '["Book the yearly screening","Review last year''s results"]'::jsonb,
      'Last done about 11 months ago.', 'review', true),
    (gen_random_uuid(), hh, m_eth, 'Hay fever', '["Antihistamine when needed"]'::jsonb, '["Keep the bedroom dust-free"]'::jsonb, NULL, 'settled', true),
    (gen_random_uuid(), hh, m_chl, 'Dry skin', '["Moisturiser twice a day"]'::jsonb, '["Skin clinic visit once a year"]'::jsonb, NULL, 'settled', true),
    (hc_ama, hh, m_ama, 'High blood pressure', '["Morning medication"]'::jsonb, '["Polyclinic check every 3 months","Keep a home reading log"]'::jsonb,
      'Next polyclinic visit is due soon.', 'review', true);

  ------------------------------------------------------------------ inventory (room photos are the 5 room pictures; suitcase is an item)
  INSERT INTO inventory_folders (id, household_id, name, photo_url, photo_size_bytes, sort_order) VALUES
    (f_liv, hh, 'Living room',    ph_path[1], ph_size[1], 0),
    (f_bed, hh, 'Master bedroom', ph_path[2], ph_size[2], 1),
    (f_din, hh, 'Dining area',    ph_path[3], ph_size[3], 2),
    (f_kit, hh, 'Kitchen',        ph_path[4], ph_size[4], 3),
    (f_sto, hh, 'Store room',     ph_path[5], ph_size[5], 4);

  INSERT INTO inventory_items (id, household_id, folder_id, member_id, name, description, quantity, category, warranty_date, photo_url, photo_size_bytes, notes) VALUES
    (gen_random_uuid(), hh, f_liv, m_dan, '3-seater sofa', 'Grey fabric', 1, 'Furniture', NULL, NULL, NULL, NULL),
    (i_tv,              hh, f_liv, m_dan, '55-inch TV', 'On the TV console', 1, 'Electronics', d + 200, NULL, NULL, 'Receipt in the document folder.'),
    (gen_random_uuid(), hh, f_bed, m_mei, 'Wardrobe', '3-door', 1, 'Furniture', NULL, NULL, NULL, NULL),
    (gen_random_uuid(), hh, f_din, m_mei, 'Dining table', 'Seats six', 1, 'Furniture', NULL, NULL, NULL, NULL),
    (i_oven,            hh, f_kit, m_mei, 'Oven', 'Built-in', 1, 'Appliance', d + 25, NULL, NULL, 'Warranty ends soon.'),
    (gen_random_uuid(), hh, f_kit, m_mei, 'Fridge', 'Two-door', 1, 'Appliance', d - 40, NULL, NULL, 'Warranty ended.'),
    (gen_random_uuid(), hh, f_kit, m_mei, 'Washing machine', 'Front-load, 8 kg', 1, 'Appliance', d + 400, NULL, NULL, NULL),
    (gen_random_uuid(), hh, f_sto, m_dan, 'Orange cabin suitcase', 'Used for family trips', 1, 'Travel', NULL, ph_path[6], ph_size[6], NULL);

  ------------------------------------------------------------------ reminders (9am Singapore time)
  INSERT INTO reminders (household_id, entity_type, entity_id, what, remind_at, recurrence) VALUES
    (hh, 'insurance', ins_ci,  'Renew critical illness policy',      ((d + 5)::text  || at9)::timestamp AT TIME ZONE 'Asia/Singapore', NULL),
    (hh, 'insurance', ins_car, 'Get 2 car insurance quotes',         ((d + 20)::text || at9)::timestamp AT TIME ZONE 'Asia/Singapore', NULL),
    (hh, 'savings',   sav_fd,  'Fixed deposit matures: roll over?',  ((d + 40)::text || at9)::timestamp AT TIME ZONE 'Asia/Singapore', NULL),
    (hh, 'loan',      ln_hdb,  'Compare HDB loan with bank loans',   ((d + 90)::text || at9)::timestamp AT TIME ZONE 'Asia/Singapore', 'yearly'),
    (hh, 'health',    hc_ama,  'Book Ah Ma''s polyclinic visit',     ((d + 8)::text  || at9)::timestamp AT TIME ZONE 'Asia/Singapore', NULL),
    (hh, 'inventory', i_oven,  'Oven warranty ends this month',      ((d + 20)::text || at9)::timestamp AT TIME ZONE 'Asia/Singapore', NULL),
    (hh, 'investment', inv_robo, 'Top up the robo portfolio',        ((d + 3)::text  || at9)::timestamp AT TIME ZONE 'Asia/Singapore', 'monthly');

  ------------------------------------------------------------------ plans
  INSERT INTO planned_cashflow_events (household_id, label, year, amount, type) VALUES
    (hh, 'Ethan university fees', yr + 6, 30000, 'outflow'),
    (hh, 'Chloe university fees', yr + 9, 30000, 'outflow'),
    (hh, 'Replace the car', yr + 7, 95000, 'outflow');

  INSERT INTO estate_checklist (household_id, item_id, checked) VALUES
    (hh, 'cpf-nomination', true),
    (hh, 'lpa-basic', true);

  ------------------------------------------------------------------ tidy up
  -- Inserting records above wrote edit-history rows. Remove them: the sample should start clean.
  DELETE FROM audit_log WHERE household_id = hh;

  UPDATE households SET storage_bytes_used = coalesce((
      SELECT sum((o.metadata->>'size')::bigint) FROM storage.objects o
      WHERE o.bucket_id IN ('vault-docs','inventory-photos')
        AND left(o.name, length(hh::text) + 1) = hh::text || '/'), 0)
  WHERE id = hh;

  -- The owner may have an empty auto-made household from account creation. Remove it, but only
  -- if it truly has no records: removing the owner from it lets the app's own empty-household
  -- clean-up delete it. Any problem here is reported but does not undo the seed.
  BEGIN
    DELETE FROM household_users hu
    WHERE hu.user_id = own AND hu.household_id <> hh
      AND NOT EXISTS (SELECT 1 FROM properties   x WHERE x.household_id = hu.household_id)
      AND NOT EXISTS (SELECT 1 FROM loans        x WHERE x.household_id = hu.household_id)
      AND NOT EXISTS (SELECT 1 FROM insurance_policies x WHERE x.household_id = hu.household_id)
      AND NOT EXISTS (SELECT 1 FROM investments  x WHERE x.household_id = hu.household_id)
      AND NOT EXISTS (SELECT 1 FROM savings_accounts x WHERE x.household_id = hu.household_id)
      AND NOT EXISTS (SELECT 1 FROM inventory_items x WHERE x.household_id = hu.household_id)
      AND NOT EXISTS (SELECT 1 FROM household_users o2 WHERE o2.household_id = hu.household_id AND o2.user_id <> own);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not remove the owner''s empty extra household (%). Sample data is fine.', SQLERRM;
  END;
END
$seed$;
