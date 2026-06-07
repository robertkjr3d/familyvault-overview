-- Ensure each household has at least one member row.
-- Creates a default member when a household is created and backfills any empty households.

CREATE OR REPLACE FUNCTION public.ensure_household_default_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.members m
    WHERE m.household_id = NEW.id
  ) THEN
    INSERT INTO public.members (
      household_id,
      name,
      short_name,
      color,
      sort_order,
      emoji
    )
    VALUES (
      NEW.id,
      'Default Member',
      'ME',
      'hsl(221 83% 53%)',
      0,
      '👤'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_household_created_default_member ON public.households;
CREATE TRIGGER on_household_created_default_member
AFTER INSERT ON public.households
FOR EACH ROW
EXECUTE FUNCTION public.ensure_household_default_member();

-- Backfill: any existing household without members gets one default member.
INSERT INTO public.members (
  household_id,
  name,
  short_name,
  color,
  sort_order,
  emoji
)
SELECT
  h.id,
  'Default Member',
  'ME',
  'hsl(221 83% 53%)',
  0,
  '👤'
FROM public.households h
WHERE NOT EXISTS (
  SELECT 1
  FROM public.members m
  WHERE m.household_id = h.id
);
