-- Adds an optional category label to travel checklist items (e.g. "Documents",
-- "Hygiene", "Clothes", "Electronics") so the Travel Checklist can group items
-- under bold category headings in the UI. Purely additive: existing rows get
-- category = NULL (shown as "Other" in the UI) — nothing is deleted or changed.
-- NOTE: travel_checklist_items is one of the ad-hoc tables not created via a
-- migration originally (see project notes) — this file documents the change,
-- but you must run the ALTER TABLE below yourself in Supabase's SQL Editor
-- for it to take effect on the live database.

ALTER TABLE travel_checklist_items ADD COLUMN IF NOT EXISTS category text;

NOTIFY pgrst, 'reload schema';
