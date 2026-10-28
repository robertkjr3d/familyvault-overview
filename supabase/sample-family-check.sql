-- sample-family-check.sql — READ-ONLY. Run after sample-family-seed.sql.
-- One result table. Compare with the "expected" column.
SELECT * FROM (
  SELECT 1 AS n, 'household name'                  AS what, (SELECT name FROM households WHERE id = 'a750df45-c320-46fd-b2c8-82389878db07')::text AS got, 'Sample family — FamilyHub SG' AS expected
  UNION ALL SELECT 2, 'members',          (SELECT count(*) FROM members WHERE household_id = 'a750df45-c320-46fd-b2c8-82389878db07')::text, '5'
  UNION ALL SELECT 3, 'properties',       (SELECT count(*) FROM properties WHERE household_id = 'a750df45-c320-46fd-b2c8-82389878db07')::text, '1'
  UNION ALL SELECT 4, 'loans',            (SELECT count(*) FROM loans WHERE household_id = 'a750df45-c320-46fd-b2c8-82389878db07')::text, '2'
  UNION ALL SELECT 5, 'insurance',        (SELECT count(*) FROM insurance_policies WHERE household_id = 'a750df45-c320-46fd-b2c8-82389878db07')::text, '10'
  UNION ALL SELECT 6, 'investments',      (SELECT count(*) FROM investments WHERE household_id = 'a750df45-c320-46fd-b2c8-82389878db07')::text, '5'
  UNION ALL SELECT 7, 'savings and CPF',  (SELECT count(*) FROM savings_accounts WHERE household_id = 'a750df45-c320-46fd-b2c8-82389878db07')::text, '13'
  UNION ALL SELECT 8, 'credit cards',     (SELECT count(*) FROM credit_cards WHERE household_id = 'a750df45-c320-46fd-b2c8-82389878db07')::text, '2'
  UNION ALL SELECT 9, 'other assets',     (SELECT count(*) FROM other_assets WHERE household_id = 'a750df45-c320-46fd-b2c8-82389878db07')::text, '3'
  UNION ALL SELECT 10, 'health',          (SELECT count(*) FROM health_conditions WHERE household_id = 'a750df45-c320-46fd-b2c8-82389878db07')::text, '4'
  UNION ALL SELECT 11, 'inventory rooms / items', (SELECT count(*) FROM inventory_folders WHERE household_id = 'a750df45-c320-46fd-b2c8-82389878db07')::text || ' / ' || (SELECT count(*) FROM inventory_items WHERE household_id = 'a750df45-c320-46fd-b2c8-82389878db07')::text, '5 / 8'
  UNION ALL SELECT 12, 'photos linked (rooms + items)', ((SELECT count(*) FROM inventory_folders WHERE household_id = 'a750df45-c320-46fd-b2c8-82389878db07' AND photo_url <> '') + (SELECT count(*) FROM inventory_items WHERE household_id = 'a750df45-c320-46fd-b2c8-82389878db07' AND photo_url <> ''))::text, '6'
  UNION ALL SELECT 13, 'reminders',       (SELECT count(*) FROM reminders WHERE household_id = 'a750df45-c320-46fd-b2c8-82389878db07')::text, '7'
  UNION ALL SELECT 14, 'edit-history rows (should be empty)', (SELECT count(*) FROM audit_log WHERE household_id = 'a750df45-c320-46fd-b2c8-82389878db07')::text, '0'
  UNION ALL SELECT 15, 'people who belong to the sample family (owner + guests)',
       (SELECT count(*) FILTER (WHERE role = 'owner') || ' owner, ' || count(*) FILTER (WHERE role = 'viewer') || ' viewers, ' || count(*) FILTER (WHERE role NOT IN ('owner','viewer')) || ' other' FROM household_users WHERE household_id = 'a750df45-c320-46fd-b2c8-82389878db07'), '1 owner, (any) viewers, 0 other'
  UNION ALL SELECT 16, 'other households the placeholder owner is in',
       (SELECT count(*) FROM household_users WHERE user_id = '6429b783-999a-4356-b695-4858a1e93330' AND household_id <> 'a750df45-c320-46fd-b2c8-82389878db07')::text, '0'
  UNION ALL SELECT 17, 'file bytes counted for the family',
       (SELECT storage_bytes_used FROM households WHERE id = 'a750df45-c320-46fd-b2c8-82389878db07')::text, 'more than 0, well under 10485760'
  UNION ALL SELECT 18, 'owner email visible in any sample record text (should be none)',
       (SELECT count(*) FROM (SELECT notes FROM insurance_policies WHERE household_id = 'a750df45-c320-46fd-b2c8-82389878db07' AND notes ILIKE '%@%') x)::text, '0'
  UNION ALL SELECT 19, 'anonymous guests signed up right now',
       (SELECT count(*) FROM auth.users WHERE is_anonymous)::text, 'any number (0 before launch)'
) t ORDER BY n;
