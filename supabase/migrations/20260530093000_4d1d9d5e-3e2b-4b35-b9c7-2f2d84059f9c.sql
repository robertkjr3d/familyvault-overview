-- Stop auto-joining new users to the default household.
-- New users will get their own private household and become owner of it.

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_household_id uuid;
  v_household_name text;
BEGIN
  INSERT INTO public.user_profiles (user_id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (user_id) DO NOTHING;

  v_household_name := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
    NULLIF(trim(NEW.raw_user_meta_data ->> 'name'), ''),
    CONCAT(split_part(COALESCE(NEW.email, 'user'), '@', 1), '''s Household')
  );

  INSERT INTO public.households (name)
  VALUES (v_household_name)
  RETURNING id INTO v_household_id;

  INSERT INTO public.household_users (household_id, user_id, role)
  VALUES (v_household_id, NEW.id, 'owner')
  ON CONFLICT (household_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_household_bootstrap ON auth.users;
CREATE TRIGGER on_auth_user_created_household_bootstrap
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_auth_user();
