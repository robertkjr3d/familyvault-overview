-- Phase 3 final tenant lock-down
-- Tighten writes: remove transitional write policies and require household membership
-- for INSERT / UPDATE / DELETE on tenant-scoped business tables.

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

    EXECUTE format('DROP POLICY IF EXISTS transitional_insert ON public.%I;', t);
    EXECUTE format('DROP POLICY IF EXISTS transitional_update ON public.%I;', t);
    EXECUTE format('DROP POLICY IF EXISTS transitional_delete ON public.%I;', t);

    EXECUTE format('DROP POLICY IF EXISTS tenant_insert ON public.%I;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_update ON public.%I;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_delete ON public.%I;', t);

    EXECUTE format(
      'CREATE POLICY tenant_insert ON public.%I FOR INSERT WITH CHECK (public.is_household_member(household_id));',
      t
    );

    EXECUTE format(
      'CREATE POLICY tenant_update ON public.%I FOR UPDATE USING (public.is_household_member(household_id)) WITH CHECK (public.is_household_member(household_id));',
      t
    );

    EXECUTE format(
      'CREATE POLICY tenant_delete ON public.%I FOR DELETE USING (public.is_household_member(household_id));',
      t
    );
  END LOOP;
END $$;

-- Tighten supporting tenancy tables as well.
ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS open_all ON public.households;
DROP POLICY IF EXISTS open_all ON public.household_users;
DROP POLICY IF EXISTS open_all ON public.user_profiles;

DROP POLICY IF EXISTS households_select ON public.households;
DROP POLICY IF EXISTS household_users_select ON public.household_users;
DROP POLICY IF EXISTS household_users_insert ON public.household_users;
DROP POLICY IF EXISTS household_users_update ON public.household_users;
DROP POLICY IF EXISTS household_users_delete ON public.household_users;
DROP POLICY IF EXISTS user_profiles_select ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_update ON public.user_profiles;

CREATE POLICY households_select
ON public.households
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.household_users hu
    WHERE hu.household_id = households.id
      AND hu.user_id = auth.uid()
  )
);

CREATE POLICY household_users_select
ON public.household_users
FOR SELECT
USING (user_id = auth.uid());

-- For now, only owners can manage household membership rows.
CREATE POLICY household_users_insert
ON public.household_users
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.household_users hu
    WHERE hu.household_id = household_users.household_id
      AND hu.user_id = auth.uid()
      AND hu.role = 'owner'
  )
);

CREATE POLICY household_users_update
ON public.household_users
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.household_users hu
    WHERE hu.household_id = household_users.household_id
      AND hu.user_id = auth.uid()
      AND hu.role = 'owner'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.household_users hu
    WHERE hu.household_id = household_users.household_id
      AND hu.user_id = auth.uid()
      AND hu.role = 'owner'
  )
);

CREATE POLICY household_users_delete
ON public.household_users
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.household_users hu
    WHERE hu.household_id = household_users.household_id
      AND hu.user_id = auth.uid()
      AND hu.role = 'owner'
  )
);

CREATE POLICY user_profiles_select
ON public.user_profiles
FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY user_profiles_update
ON public.user_profiles
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
