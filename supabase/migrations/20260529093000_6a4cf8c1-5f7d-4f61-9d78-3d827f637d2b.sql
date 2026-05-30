-- Phase 1 multi-tenant foundation (backward compatible)
-- This migration intentionally does NOT enforce auth-based RLS yet.
-- It only introduces household tenancy structures and backfills existing data.

-- Households (tenant root)
CREATE TABLE IF NOT EXISTS public.households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- User membership in households
CREATE TABLE IF NOT EXISTS public.household_users (
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member', 'viewer')),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id)
);

CREATE INDEX IF NOT EXISTS household_users_user_id_idx ON public.household_users(user_id);

ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS open_all ON public.households;
DROP POLICY IF EXISTS open_all ON public.household_users;
CREATE POLICY open_all ON public.households FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY open_all ON public.household_users FOR ALL USING (true) WITH CHECK (true);

-- Add tenant key columns (nullable for now to avoid breaking existing app behavior)
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS household_id uuid;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS household_id uuid;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS household_id uuid;
ALTER TABLE public.property_rate_schedule ADD COLUMN IF NOT EXISTS household_id uuid;
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS household_id uuid;
ALTER TABLE public.loan_rate_schedule ADD COLUMN IF NOT EXISTS household_id uuid;
ALTER TABLE public.insurance_policies ADD COLUMN IF NOT EXISTS household_id uuid;
ALTER TABLE public.investments ADD COLUMN IF NOT EXISTS household_id uuid;
ALTER TABLE public.savings_accounts ADD COLUMN IF NOT EXISTS household_id uuid;
ALTER TABLE public.health_conditions ADD COLUMN IF NOT EXISTS household_id uuid;
ALTER TABLE public.inventory_folders ADD COLUMN IF NOT EXISTS household_id uuid;
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS household_id uuid;
ALTER TABLE public.gobag_items ADD COLUMN IF NOT EXISTS household_id uuid;
ALTER TABLE public.record_history ADD COLUMN IF NOT EXISTS household_id uuid;
ALTER TABLE public.record_documents ADD COLUMN IF NOT EXISTS household_id uuid;
ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS household_id uuid;

-- Backfill existing data to a default household
DO $$
DECLARE
  v_household_id uuid;
BEGIN
  SELECT id INTO v_household_id
  FROM public.households
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_household_id IS NULL THEN
    INSERT INTO public.households (name, slug)
    VALUES ('Default Household', 'default-household')
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

-- Add household foreign keys safely (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_household_id_fkey') THEN
    ALTER TABLE public.members
      ADD CONSTRAINT members_household_id_fkey
      FOREIGN KEY (household_id) REFERENCES public.households(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_settings_household_id_fkey') THEN
    ALTER TABLE public.app_settings
      ADD CONSTRAINT app_settings_household_id_fkey
      FOREIGN KEY (household_id) REFERENCES public.households(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_household_id_fkey') THEN
    ALTER TABLE public.properties
      ADD CONSTRAINT properties_household_id_fkey
      FOREIGN KEY (household_id) REFERENCES public.households(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'property_rate_schedule_household_id_fkey') THEN
    ALTER TABLE public.property_rate_schedule
      ADD CONSTRAINT property_rate_schedule_household_id_fkey
      FOREIGN KEY (household_id) REFERENCES public.households(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loans_household_id_fkey') THEN
    ALTER TABLE public.loans
      ADD CONSTRAINT loans_household_id_fkey
      FOREIGN KEY (household_id) REFERENCES public.households(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loan_rate_schedule_household_id_fkey') THEN
    ALTER TABLE public.loan_rate_schedule
      ADD CONSTRAINT loan_rate_schedule_household_id_fkey
      FOREIGN KEY (household_id) REFERENCES public.households(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'insurance_policies_household_id_fkey') THEN
    ALTER TABLE public.insurance_policies
      ADD CONSTRAINT insurance_policies_household_id_fkey
      FOREIGN KEY (household_id) REFERENCES public.households(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'investments_household_id_fkey') THEN
    ALTER TABLE public.investments
      ADD CONSTRAINT investments_household_id_fkey
      FOREIGN KEY (household_id) REFERENCES public.households(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'savings_accounts_household_id_fkey') THEN
    ALTER TABLE public.savings_accounts
      ADD CONSTRAINT savings_accounts_household_id_fkey
      FOREIGN KEY (household_id) REFERENCES public.households(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'health_conditions_household_id_fkey') THEN
    ALTER TABLE public.health_conditions
      ADD CONSTRAINT health_conditions_household_id_fkey
      FOREIGN KEY (household_id) REFERENCES public.households(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_folders_household_id_fkey') THEN
    ALTER TABLE public.inventory_folders
      ADD CONSTRAINT inventory_folders_household_id_fkey
      FOREIGN KEY (household_id) REFERENCES public.households(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_items_household_id_fkey') THEN
    ALTER TABLE public.inventory_items
      ADD CONSTRAINT inventory_items_household_id_fkey
      FOREIGN KEY (household_id) REFERENCES public.households(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gobag_items_household_id_fkey') THEN
    ALTER TABLE public.gobag_items
      ADD CONSTRAINT gobag_items_household_id_fkey
      FOREIGN KEY (household_id) REFERENCES public.households(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'record_history_household_id_fkey') THEN
    ALTER TABLE public.record_history
      ADD CONSTRAINT record_history_household_id_fkey
      FOREIGN KEY (household_id) REFERENCES public.households(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'record_documents_household_id_fkey') THEN
    ALTER TABLE public.record_documents
      ADD CONSTRAINT record_documents_household_id_fkey
      FOREIGN KEY (household_id) REFERENCES public.households(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reminders_household_id_fkey') THEN
    ALTER TABLE public.reminders
      ADD CONSTRAINT reminders_household_id_fkey
      FOREIGN KEY (household_id) REFERENCES public.households(id);
  END IF;
END $$;

-- Helpful indexes for upcoming RLS and tenant scoping
CREATE INDEX IF NOT EXISTS members_household_id_idx ON public.members(household_id);
CREATE INDEX IF NOT EXISTS app_settings_household_id_idx ON public.app_settings(household_id);
CREATE INDEX IF NOT EXISTS properties_household_id_idx ON public.properties(household_id);
CREATE INDEX IF NOT EXISTS property_rate_schedule_household_id_idx ON public.property_rate_schedule(household_id);
CREATE INDEX IF NOT EXISTS loans_household_id_idx ON public.loans(household_id);
CREATE INDEX IF NOT EXISTS loan_rate_schedule_household_id_idx ON public.loan_rate_schedule(household_id);
CREATE INDEX IF NOT EXISTS insurance_policies_household_id_idx ON public.insurance_policies(household_id);
CREATE INDEX IF NOT EXISTS investments_household_id_idx ON public.investments(household_id);
CREATE INDEX IF NOT EXISTS savings_accounts_household_id_idx ON public.savings_accounts(household_id);
CREATE INDEX IF NOT EXISTS health_conditions_household_id_idx ON public.health_conditions(household_id);
CREATE INDEX IF NOT EXISTS inventory_folders_household_id_idx ON public.inventory_folders(household_id);
CREATE INDEX IF NOT EXISTS inventory_items_household_id_idx ON public.inventory_items(household_id);
CREATE INDEX IF NOT EXISTS gobag_items_household_id_idx ON public.gobag_items(household_id);
CREATE INDEX IF NOT EXISTS record_history_household_id_idx ON public.record_history(household_id);
CREATE INDEX IF NOT EXISTS record_documents_household_id_idx ON public.record_documents(household_id);
CREATE INDEX IF NOT EXISTS reminders_household_id_idx ON public.reminders(household_id);

-- Helper functions for later policy hardening (phase 2/3)
CREATE OR REPLACE FUNCTION public.current_user_household_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
AS $$
  SELECT hu.household_id
  FROM public.household_users hu
  WHERE hu.user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_household_member(target_household_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.household_users hu
    WHERE hu.household_id = target_household_id
      AND hu.user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.current_user_household_ids() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_household_member(uuid) TO anon, authenticated;
