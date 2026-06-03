-- Make app_settings household-scoped instead of singleton id=1.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'app_settings_singleton'
      AND conrelid = 'public.app_settings'::regclass
  ) THEN
    ALTER TABLE public.app_settings DROP CONSTRAINT app_settings_singleton;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'app_settings_household_id_key'
      AND conrelid = 'public.app_settings'::regclass
  ) THEN
    ALTER TABLE public.app_settings
      ADD CONSTRAINT app_settings_household_id_key UNIQUE (household_id);
  END IF;
END $$;

INSERT INTO public.app_settings (
  household_id,
  family_name
)
SELECT
  h.id,
  'Our Family'
FROM public.households h
LEFT JOIN public.app_settings s ON s.household_id = h.id
WHERE s.household_id IS NULL;

CREATE OR REPLACE FUNCTION public.ensure_household_app_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.app_settings (household_id, family_name)
  VALUES (NEW.id, COALESCE(NULLIF(trim(NEW.name), ''), 'Our Family'))
  ON CONFLICT (household_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_household_created_app_settings ON public.households;
CREATE TRIGGER on_household_created_app_settings
AFTER INSERT ON public.households
FOR EACH ROW
EXECUTE FUNCTION public.ensure_household_app_settings();
