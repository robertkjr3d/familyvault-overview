-- Owner-only helper for sharing a household with another existing user by email.

CREATE OR REPLACE FUNCTION public.share_household_by_email(
  p_household_id uuid,
  p_email text,
  p_role text DEFAULT 'member'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_target_user_id uuid;
  v_email text := lower(trim(COALESCE(p_email, '')));
  v_role text := lower(trim(COALESCE(p_role, 'member')));
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

  IF v_role NOT IN ('member', 'viewer') THEN
    RAISE EXCEPTION 'Role must be member or viewer.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.household_users hu
    WHERE hu.household_id = p_household_id
      AND hu.user_id = v_actor
      AND hu.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only household owners can share access.';
  END IF;

  SELECT u.id
  INTO v_target_user_id
  FROM auth.users u
  WHERE lower(u.email) = v_email
  LIMIT 1;

  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'No account found for that email yet. Ask them to sign in first, then share again.';
  END IF;

  INSERT INTO public.household_users (household_id, user_id, role, invited_by)
  VALUES (p_household_id, v_target_user_id, v_role, v_actor)
  ON CONFLICT (household_id, user_id)
  DO UPDATE SET
    role = EXCLUDED.role,
    invited_by = EXCLUDED.invited_by;

  RETURN v_target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.share_household_by_email(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.share_household_by_email(uuid, text, text) TO authenticated;