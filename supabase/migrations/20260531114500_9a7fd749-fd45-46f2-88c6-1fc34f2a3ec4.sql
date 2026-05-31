-- Invitation tokens for owner-driven email invites.

CREATE TABLE IF NOT EXISTS public.household_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  invited_email text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'viewer')),
  invited_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz
);

CREATE INDEX IF NOT EXISTS household_invites_household_id_idx
  ON public.household_invites(household_id);

CREATE INDEX IF NOT EXISTS household_invites_invited_email_idx
  ON public.household_invites(lower(invited_email));

CREATE INDEX IF NOT EXISTS household_invites_pending_idx
  ON public.household_invites(token)
  WHERE accepted_at IS NULL AND cancelled_at IS NULL;

ALTER TABLE public.household_invites ENABLE ROW LEVEL SECURITY;
