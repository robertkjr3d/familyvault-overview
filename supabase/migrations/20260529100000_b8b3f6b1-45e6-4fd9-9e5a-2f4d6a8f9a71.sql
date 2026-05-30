-- Phase 2 tenant enforcement (transitional)
-- Goals:
-- 1) household_id becomes required on core tables
-- 2) SELECT is tenant-restricted via household membership
-- 3) INSERT/UPDATE/DELETE remain temporarily permissive during app auth rollout

-- Safety backfill in case any late rows were inserted without household_id.
DO $$
DECLARE
  v_household_id uuid;
BEGIN
  SELECT public.default_household_id() INTO v_household_id;

  IF v_household_id IS NULL THEN
    INSERT INTO public.households (name, slug)
    VALUES ('Default Household', 'default-household')
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_household_id;
  END IF;

  UPDATE public.members SET household_id = v_household_id WHERE household_id IS NULL;
  UPDATE public.app_settings SET household_id = v_household_id WHERE household_id IS NULL;
  UPDATE public.properties SET household_id = v_household_id WHERE household_id IS NULL;

  UPDATE public.property_rate_schedule prs
  SET household_id = COALESCE(prs.household_id, p.household_id, v_household_id)
  FROM public.properties p
  WHERE prs.property_id = p.id
    AND prs.household_id IS NULL;

  UPDATE public.loans SET household_id = v_household_id WHERE household_id IS NULL;

  UPDATE public.loan_rate_schedule lrs
  SET household_id = COALESCE(lrs.household_id, l.household_id, v_household_id)
  FROM public.loans l
  WHERE lrs.loan_id = l.id
    AND lrs.household_id IS NULL;

  UPDATE public.insurance_policies SET household_id = v_household_id WHERE household_id IS NULL;
  UPDATE public.investments SET household_id = v_household_id WHERE household_id IS NULL;
  UPDATE public.savings_accounts SET household_id = v_household_id WHERE household_id IS NULL;
  UPDATE public.health_conditions SET household_id = v_household_id WHERE household_id IS NULL;
  UPDATE public.inventory_folders SET household_id = v_household_id WHERE household_id IS NULL;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'inventory_items'
      AND column_name = 'folder_id'
  ) THEN
    UPDATE public.inventory_items ii
    SET household_id = COALESCE(ii.household_id, f.household_id, v_household_id)
    FROM public.inventory_folders f
    WHERE ii.folder_id = f.id
      AND ii.household_id IS NULL;
  ELSE
    UPDATE public.inventory_items
    SET household_id = v_household_id
    WHERE household_id IS NULL;
  END IF;

  UPDATE public.gobag_items SET household_id = v_household_id WHERE household_id IS NULL;
  UPDATE public.record_history SET household_id = v_household_id WHERE household_id IS NULL;
  UPDATE public.record_documents SET household_id = v_household_id WHERE household_id IS NULL;
  UPDATE public.reminders SET household_id = v_household_id WHERE household_id IS NULL;
END $$;

-- Enforce household_id required on core tables.
ALTER TABLE public.members ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE public.app_settings ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE public.properties ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE public.property_rate_schedule ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE public.loans ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE public.loan_rate_schedule ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE public.insurance_policies ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE public.investments ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE public.savings_accounts ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE public.health_conditions ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE public.inventory_folders ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE public.inventory_items ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE public.gobag_items ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE public.record_history ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE public.record_documents ALTER COLUMN household_id SET NOT NULL;
ALTER TABLE public.reminders ALTER COLUMN household_id SET NOT NULL;

-- Replace permissive open_all policy with:
-- - membership-based SELECT
-- - temporary permissive writes (transitional)
DO $$
DECLARE
  t text;
  tables text[] := array[
    'members',
    'app_settings',
    'properties',
    'property_rate_schedule',
    'loans',
    'loan_rate_schedule',
    'insurance_policies',
    'investments',
    'savings_accounts',
    'health_conditions',
    'inventory_folders',
    'inventory_items',
    'gobag_items',
    'record_history',
    'record_documents',
    'reminders'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);

    EXECUTE format('DROP POLICY IF EXISTS open_all ON public.%I;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_select ON public.%I;', t);
    EXECUTE format('DROP POLICY IF EXISTS transitional_insert ON public.%I;', t);
    EXECUTE format('DROP POLICY IF EXISTS transitional_update ON public.%I;', t);
    EXECUTE format('DROP POLICY IF EXISTS transitional_delete ON public.%I;', t);

    EXECUTE format(
      'CREATE POLICY tenant_select ON public.%I FOR SELECT USING (public.is_household_member(household_id));',
      t
    );

    EXECUTE format(
      'CREATE POLICY transitional_insert ON public.%I FOR INSERT WITH CHECK (true);',
      t
    );

    EXECUTE format(
      'CREATE POLICY transitional_update ON public.%I FOR UPDATE USING (true) WITH CHECK (true);',
      t
    );

    EXECUTE format(
      'CREATE POLICY transitional_delete ON public.%I FOR DELETE USING (true);',
      t
    );
  END LOOP;
END $$;

-- NOTE:
-- The transitional_* write policies are intentionally broad and should be tightened
-- after auth UI/tenant context rollout by requiring is_household_member(household_id)
-- for INSERT/UPDATE/DELETE checks.
