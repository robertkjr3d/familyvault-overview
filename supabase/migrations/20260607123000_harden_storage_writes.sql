-- Step 1 hardening: remove public write/delete access to storage buckets.
-- Keep read behavior unchanged for now.

-- Drop old permissive policies if they exist.
DROP POLICY IF EXISTS "vault docs write" ON storage.objects;
DROP POLICY IF EXISTS "vault docs update" ON storage.objects;
DROP POLICY IF EXISTS "vault docs delete" ON storage.objects;
DROP POLICY IF EXISTS "vault-docs write" ON storage.objects;
DROP POLICY IF EXISTS "vault-docs update" ON storage.objects;
DROP POLICY IF EXISTS "vault-docs delete" ON storage.objects;
DROP POLICY IF EXISTS "vault-docs public write" ON storage.objects;
DROP POLICY IF EXISTS "vault-docs public delete" ON storage.objects;

-- Create authenticated-only write policies for FamilyVault buckets.
CREATE POLICY "fv storage auth insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id IN ('vault-docs', 'inventory-photos')
);

CREATE POLICY "fv storage auth update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id IN ('vault-docs', 'inventory-photos')
)
WITH CHECK (
  bucket_id IN ('vault-docs', 'inventory-photos')
);

CREATE POLICY "fv storage auth delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id IN ('vault-docs', 'inventory-photos')
);
