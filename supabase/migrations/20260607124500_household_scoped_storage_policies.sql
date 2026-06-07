-- Household-scoped storage hardening.
-- Requires uploaded object paths to begin with household UUID:
--   <household_id>/<subfolder>/<filename>
--
-- Legacy fallback: existing objects can still be updated/deleted by their owner.

DROP POLICY IF EXISTS "fv storage auth insert" ON storage.objects;
DROP POLICY IF EXISTS "fv storage auth update" ON storage.objects;
DROP POLICY IF EXISTS "fv storage auth delete" ON storage.objects;

DROP POLICY IF EXISTS "fv storage household insert" ON storage.objects;
DROP POLICY IF EXISTS "fv storage household update" ON storage.objects;
DROP POLICY IF EXISTS "fv storage household delete" ON storage.objects;

CREATE POLICY "fv storage household insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id IN ('vault-docs', 'inventory-photos')
  AND (
    CASE
      WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN public.is_household_member((split_part(name, '/', 1))::uuid)
      ELSE false
    END
  )
);

CREATE POLICY "fv storage household update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id IN ('vault-docs', 'inventory-photos')
  AND (
    owner = auth.uid()
    OR (
      CASE
        WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN public.is_household_member((split_part(name, '/', 1))::uuid)
        ELSE false
      END
    )
  )
)
WITH CHECK (
  bucket_id IN ('vault-docs', 'inventory-photos')
  AND (
    owner = auth.uid()
    OR (
      CASE
        WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN public.is_household_member((split_part(name, '/', 1))::uuid)
        ELSE false
      END
    )
  )
);

CREATE POLICY "fv storage household delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id IN ('vault-docs', 'inventory-photos')
  AND (
    owner = auth.uid()
    OR (
      CASE
        WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN public.is_household_member((split_part(name, '/', 1))::uuid)
        ELSE false
      END
    )
  )
);
