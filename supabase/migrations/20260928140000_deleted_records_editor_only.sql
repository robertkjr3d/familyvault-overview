-- Low-severity tightening: only household EDITORS (owner/member) may put records
-- in, or remove them from, the Recycle Bin table. Previously any household member,
-- including a read-only VIEWER, could clear trash entries (destroying recoverability).
-- The app never lets a viewer delete or restore anything, and the nightly purge uses
-- the service role (bypasses these rules), so normal use is unaffected.
--
-- RECORD KEEPING: run by hand in the Supabase SQL Editor (folder is documentation).
--
-- ROLLBACK:
--   ALTER POLICY "household members can move records to trash" ON public.deleted_records
--     WITH CHECK (is_household_member(household_id));
--   ALTER POLICY "household members can remove trash entries" ON public.deleted_records
--     USING (is_household_member(household_id));

ALTER POLICY "household members can move records to trash" ON public.deleted_records
  WITH CHECK (is_household_editor(household_id));

ALTER POLICY "household members can remove trash entries" ON public.deleted_records
  USING (is_household_editor(household_id));
