-- Fix the default_household_id() safety-net function.
-- The original version returned the earliest-created household — a silent wrong-tenant
-- routing bug for any future multi-household scenario (e.g. an insert that forgets to
-- supply household_id would silently land in the first household in the DB, which today
-- is Azariah's family).
-- The new version returns the authenticated user's own household. If unauthenticated,
-- it returns NULL so the NOT NULL constraint surfaces a clear error instead.
CREATE OR REPLACE FUNCTION public.default_household_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT hu.household_id
  FROM public.household_users hu
  WHERE hu.user_id = auth.uid()
  LIMIT 1;
$$;
