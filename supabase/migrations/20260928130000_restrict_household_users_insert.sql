-- Closes a membership loophole on public.household_users.
--
-- WHY: the INSERT policy allowed `user_id = auth.uid()` with no check on which
-- household or which role, so any signed-in user could (in theory) add
-- themselves to ANY household as 'owner' if they knew its ID (advisers and
-- invitees can learn household IDs). The app never needs this: new sign-ups
-- get their household from the SECURITY DEFINER trigger handle_new_auth_user
-- (bypasses RLS), and invite acceptance uses the server-side service role.
-- After this change only an existing OWNER of a household can add members to it.
--
-- RECORD KEEPING: run by hand in the Supabase SQL Editor; this folder is
-- documentation, not an auto-run pipeline.
--
-- ROLLBACK (restores the exact previous rule):
--   ALTER POLICY household_users_insert ON public.household_users
--     WITH CHECK ((user_id = auth.uid()) OR (EXISTS ( SELECT 1
--        FROM household_users hu
--       WHERE ((hu.household_id = household_users.household_id)
--         AND (hu.user_id = auth.uid()) AND (hu.role = 'owner'::text)))));

ALTER POLICY household_users_insert ON public.household_users
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.household_users hu
      WHERE hu.household_id = household_users.household_id
        AND hu.user_id = auth.uid()
        AND hu.role = 'owner'::text
    )
  );
