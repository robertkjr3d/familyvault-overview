-- Owner transfer helper to hand off a household to another existing member by email.

CREATE OR REPLACE FUNCTION public.transfer_household_ownership_by_email(
  p_household_id uuid,
  p_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_target_user_id uuid;
  v_email text := lower(trim(COALESCE(p_email, '')));
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF p_household_id IS NULL THEN
    RAISE EXCEPTION 'Household is required.';
  END IF;

  IF v_email = '' THEN
    RAISE EXCEPTION 'Email is required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.household_users hu
    WHERE hu.household_id = p_household_id
      AND hu.user_id = v_actor
      AND hu.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only household owners can transfer ownership.';
  END IF;

  SELECT u.id
  INTO v_target_user_id
  FROM auth.users u
  WHERE lower(u.email) = v_email
  LIMIT 1;

  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'No account found for that email.';
  END IF;

  IF v_target_user_id = v_actor THEN
    RAISE EXCEPTION 'You are already the owner.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.household_users hu
    WHERE hu.household_id = p_household_id
      AND hu.user_id = v_target_user_id
  ) THEN
    RAISE EXCEPTION 'Target user must already be a member of this household.';
  END IF;

  -- Enforce a single owner after transfer.
  UPDATE public.household_users
  SET role = 'member'
  WHERE household_id = p_household_id
    AND role = 'owner';

  UPDATE public.household_users
  SET role = 'owner'
  WHERE household_id = p_household_id
    AND user_id = v_target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_household_ownership_by_email(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_household_ownership_by_email(uuid, text) TO authenticated;