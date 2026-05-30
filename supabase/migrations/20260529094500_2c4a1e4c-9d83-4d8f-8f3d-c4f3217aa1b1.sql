-- Phase 1.5 tenant defaults + auth bootstrap (still backward compatible)
-- This migration keeps current app behavior working while preparing for strict RLS.

-- Stable helper: choose a fallback household for legacy writes.
CREATE OR REPLACE FUNCTION public.default_household_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT h.id
  FROM public.households h
  ORDER BY h.created_at ASC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.default_household_id() TO anon, authenticated;

-- Ensure new records get a tenant key even before UI starts sending household_id.
ALTER TABLE public.members ALTER COLUMN household_id SET DEFAULT public.default_household_id();
ALTER TABLE public.app_settings ALTER COLUMN household_id SET DEFAULT public.default_household_id();
ALTER TABLE public.properties ALTER COLUMN household_id SET DEFAULT public.default_household_id();
ALTER TABLE public.property_rate_schedule ALTER COLUMN household_id SET DEFAULT public.default_household_id();
ALTER TABLE public.loans ALTER COLUMN household_id SET DEFAULT public.default_household_id();
ALTER TABLE public.loan_rate_schedule ALTER COLUMN household_id SET DEFAULT public.default_household_id();
ALTER TABLE public.insurance_policies ALTER COLUMN household_id SET DEFAULT public.default_household_id();
ALTER TABLE public.investments ALTER COLUMN household_id SET DEFAULT public.default_household_id();
ALTER TABLE public.savings_accounts ALTER COLUMN household_id SET DEFAULT public.default_household_id();
ALTER TABLE public.health_conditions ALTER COLUMN household_id SET DEFAULT public.default_household_id();
ALTER TABLE public.inventory_folders ALTER COLUMN household_id SET DEFAULT public.default_household_id();
ALTER TABLE public.inventory_items ALTER COLUMN household_id SET DEFAULT public.default_household_id();
ALTER TABLE public.gobag_items ALTER COLUMN household_id SET DEFAULT public.default_household_id();
ALTER TABLE public.record_history ALTER COLUMN household_id SET DEFAULT public.default_household_id();
ALTER TABLE public.record_documents ALTER COLUMN household_id SET DEFAULT public.default_household_id();
ALTER TABLE public.reminders ALTER COLUMN household_id SET DEFAULT public.default_household_id();

-- Keep child table tenant key in sync with parent rows where relationship exists.
CREATE OR REPLACE FUNCTION public.sync_prs_household_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.household_id IS NULL THEN
    SELECT p.household_id INTO NEW.household_id
    FROM public.properties p
    WHERE p.id = NEW.property_id;
  END IF;

  IF NEW.household_id IS NULL THEN
    NEW.household_id := public.default_household_id();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_prs_household_id ON public.property_rate_schedule;
CREATE TRIGGER trg_sync_prs_household_id
BEFORE INSERT OR UPDATE ON public.property_rate_schedule
FOR EACH ROW
EXECUTE FUNCTION public.sync_prs_household_id();

CREATE OR REPLACE FUNCTION public.sync_lrs_household_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.household_id IS NULL THEN
    SELECT l.household_id INTO NEW.household_id
    FROM public.loans l
    WHERE l.id = NEW.loan_id;
  END IF;

  IF NEW.household_id IS NULL THEN
    NEW.household_id := public.default_household_id();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_lrs_household_id ON public.loan_rate_schedule;
CREATE TRIGGER trg_sync_lrs_household_id
BEFORE INSERT OR UPDATE ON public.loan_rate_schedule
FOR EACH ROW
EXECUTE FUNCTION public.sync_lrs_household_id();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'inventory_items'
      AND column_name = 'folder_id'
  ) THEN
    EXECUTE $SQL$
      CREATE OR REPLACE FUNCTION public.sync_inventory_item_household_id()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $fn$
      BEGIN
        IF NEW.household_id IS NULL THEN
          SELECT f.household_id INTO NEW.household_id
          FROM public.inventory_folders f
          WHERE f.id = NEW.folder_id;
        END IF;

        IF NEW.household_id IS NULL THEN
          NEW.household_id := public.default_household_id();
        END IF;

        RETURN NEW;
      END;
      $fn$;
    $SQL$;

    DROP TRIGGER IF EXISTS trg_sync_inventory_item_household_id ON public.inventory_items;
    CREATE TRIGGER trg_sync_inventory_item_household_id
    BEFORE INSERT OR UPDATE ON public.inventory_items
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_inventory_item_household_id();
  END IF;
END $$;

-- Auth bootstrap profile table.
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS open_all ON public.user_profiles;
CREATE POLICY open_all ON public.user_profiles FOR ALL USING (true) WITH CHECK (true);

-- Add current auth users to profile table.
INSERT INTO public.user_profiles (user_id, email)
SELECT u.id, u.email
FROM auth.users u
LEFT JOIN public.user_profiles p ON p.user_id = u.id
WHERE p.user_id IS NULL;

-- Associate existing auth users with default household if not already associated.
INSERT INTO public.household_users (household_id, user_id, role)
SELECT public.default_household_id(), u.id, 'owner'
FROM auth.users u
WHERE public.default_household_id() IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.household_users hu
    WHERE hu.household_id = public.default_household_id()
      AND hu.user_id = u.id
  );

-- Auto-create user profile + default-household membership for new auth users.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (user_id) DO NOTHING;

  IF public.default_household_id() IS NOT NULL THEN
    INSERT INTO public.household_users (household_id, user_id, role)
    VALUES (public.default_household_id(), NEW.id, 'member')
    ON CONFLICT (household_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_household_bootstrap ON auth.users;
CREATE TRIGGER on_auth_user_created_household_bootstrap
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_auth_user();

-- Helper for future app-level household switching.
CREATE OR REPLACE FUNCTION public.current_household_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(auth.jwt() ->> 'household_id', '')::uuid,
    (
      SELECT hu.household_id
      FROM public.household_users hu
      WHERE hu.user_id = auth.uid()
      ORDER BY hu.created_at ASC
      LIMIT 1
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.current_household_id() TO anon, authenticated;
