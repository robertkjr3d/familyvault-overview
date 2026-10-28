-- REFERENCE ONLY: a description of the live database, not a script to run.
SET check_function_bodies = false;
SET search_path = public, extensions;

-- Schema snapshot generated 2026-10-27T05:30:11Z \| database postgres \| PostgreSQL 17.6

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

CREATE TYPE public.entity_type AS ENUM ('property', 'loan', 'insurance', 'investment', 'savings', 'health', 'inventory', 'other_asset', 'other_assets', 'credit_card');

CREATE TYPE public.property_purpose AS ENUM ('own_home', 'rental_yield', 'capital_growth', 'mixed');

CREATE TYPE public.record_status AS ENUM ('urgent', 'review', 'settled');

CREATE TABLE public.advisor_household_links (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  household_id uuid NOT NULL,
  advisor_user_id uuid NOT NULL,
  can_view_insurance boolean DEFAULT true NOT NULL,
  can_view_investments boolean DEFAULT true NOT NULL,
  can_view_networth_summary boolean DEFAULT true NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  linked_at timestamp with time zone DEFAULT now() NOT NULL,
  consent_renewed_at timestamp with time zone DEFAULT now() NOT NULL,
  revoked_at timestamp with time zone,
  last_digest_sent_at timestamp with time zone,
  can_view_property boolean DEFAULT false NOT NULL,
  can_view_loans boolean DEFAULT false NOT NULL
);

CREATE TABLE public.advisor_invites (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  household_id uuid NOT NULL,
  invited_email text NOT NULL,
  can_view_insurance boolean DEFAULT true NOT NULL,
  can_view_investments boolean DEFAULT true NOT NULL,
  can_view_networth_summary boolean DEFAULT true NOT NULL,
  invited_by_user_id uuid NOT NULL,
  token text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
  accepted_at timestamp with time zone,
  accepted_by_user_id uuid,
  cancelled_at timestamp with time zone,
  member_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  can_view_property boolean DEFAULT false NOT NULL,
  can_view_loans boolean DEFAULT false NOT NULL
);

CREATE TABLE public.advisor_link_members (
  link_id uuid NOT NULL,
  member_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.advisor_policy_charts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  link_id uuid NOT NULL,
  household_id uuid NOT NULL,
  member_id uuid,
  advisor_user_id uuid NOT NULL,
  title text,
  phases jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  record_id uuid NOT NULL,
  record_category text NOT NULL
);

CREATE TABLE public.advisor_record_notes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  link_id uuid NOT NULL,
  household_id uuid NOT NULL,
  member_id uuid,
  advisor_user_id uuid NOT NULL,
  record_category text NOT NULL,
  record_id uuid NOT NULL,
  note text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  status text
);

CREATE TABLE public.app_settings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  family_name text DEFAULT 'Our Family'::text NOT NULL,
  simulated_date date,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  household_id uuid DEFAULT default_household_id() NOT NULL,
  monthly_income numeric DEFAULT 0,
  monthly_expenses numeric DEFAULT 0,
  retirement_year integer,
  cpf_payout_age integer DEFAULT 65,
  cpf_monthly_payout numeric DEFAULT 0,
  investment_growth_rate numeric DEFAULT 0,
  property_appreciation_rate numeric DEFAULT 0,
  inflation_rate numeric DEFAULT 0,
  planning_horizon_age integer DEFAULT 85,
  mortgage_days integer DEFAULT 90 NOT NULL,
  insurance_days integer DEFAULT 60 NOT NULL,
  fd_days integer DEFAULT 30 NOT NULL,
  warranty_days integer DEFAULT 90 NOT NULL,
  onboarding_dismissed boolean DEFAULT false NOT NULL
);

CREATE TABLE public.audit_log (
  id bigint DEFAULT nextval('audit_log_id_seq'::regclass) NOT NULL,
  household_id uuid,
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  action text NOT NULL,
  changed_by uuid,
  changed_fields text[],
  old_data jsonb,
  new_data jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.credit_cards (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  household_id uuid NOT NULL,
  member_id uuid,
  name text NOT NULL,
  issuer text,
  network text,
  last4 text,
  card_status text DEFAULT 'Active'::text NOT NULL,
  reward_type text,
  points_balance numeric,
  points_expiry_date date,
  min_spend numeric,
  annual_fee numeric,
  action text,
  external_url text,
  notes text,
  status record_status DEFAULT 'settled'::record_status NOT NULL,
  is_demo boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.deleted_records (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  household_id uuid NOT NULL,
  table_name text NOT NULL,
  entity_type text,
  record_id uuid NOT NULL,
  record_data jsonb NOT NULL,
  deleted_by uuid,
  deleted_at timestamp with time zone DEFAULT now() NOT NULL,
  related_reminders jsonb DEFAULT '[]'::jsonb NOT NULL,
  batch_id uuid
);

CREATE TABLE public.dismissed_dashboard_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  household_id uuid NOT NULL,
  source_type text NOT NULL,
  record_id text NOT NULL,
  label text NOT NULL,
  dismissed_at timestamp with time zone DEFAULT now() NOT NULL,
  dismissed_date date DEFAULT '1970-01-01'::date NOT NULL,
  permanently_deleted boolean DEFAULT false NOT NULL,
  reminder_id uuid
);

CREATE TABLE public.error_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  user_id uuid,
  error_type text NOT NULL,
  error_message text,
  error_stack text,
  page_url text,
  component_name text,
  metadata jsonb
);

CREATE TABLE public.estate_checklist (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  household_id uuid NOT NULL,
  item_id text NOT NULL,
  checked boolean DEFAULT false NOT NULL,
  external_url text,
  notes text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.fx_rates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  rate_date date NOT NULL,
  base_currency text DEFAULT 'SGD'::text NOT NULL,
  rates jsonb NOT NULL,
  fetched_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.gobag_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  label text NOT NULL,
  checked boolean DEFAULT false NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  household_id uuid DEFAULT default_household_id() NOT NULL
);

CREATE TABLE public.health_conditions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  member_id uuid,
  action_member_id uuid,
  name text NOT NULL,
  supplements jsonb DEFAULT '[]'::jsonb NOT NULL,
  actions jsonb DEFAULT '[]'::jsonb NOT NULL,
  details text,
  notes text,
  status record_status DEFAULT 'review'::record_status NOT NULL,
  is_demo boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  household_id uuid DEFAULT default_household_id() NOT NULL
);

CREATE TABLE public.household_invites (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  household_id uuid NOT NULL,
  invited_email text NOT NULL,
  role text DEFAULT 'member'::text NOT NULL,
  invited_by_user_id uuid NOT NULL,
  token text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
  accepted_at timestamp with time zone,
  accepted_by_user_id uuid,
  cancelled_at timestamp with time zone
);

CREATE TABLE public.household_users (
  household_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text DEFAULT 'member'::text NOT NULL,
  invited_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  has_seen_tour boolean DEFAULT false NOT NULL,
  has_seen_passkey_prompt boolean DEFAULT false NOT NULL
);

CREATE TABLE public.households (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  slug text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  storage_tier text DEFAULT 'free'::text NOT NULL,
  storage_bytes_used bigint DEFAULT 0 NOT NULL
);

CREATE TABLE public.insurance_policies (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  member_id uuid,
  action_member_id uuid,
  name text NOT NULL,
  category text,
  provider text,
  policy_number text,
  premium numeric,
  frequency text DEFAULT 'annual'::text,
  num_payments integer,
  payment_end_date date,
  sum_assured numeric,
  start_date date,
  end_date date,
  next_due_date date,
  action text,
  notes text,
  status record_status DEFAULT 'review'::record_status NOT NULL,
  is_demo boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  household_id uuid DEFAULT default_household_id() NOT NULL,
  currency text DEFAULT 'SGD'::text,
  payout_amount numeric,
  payout_start_date date,
  payout_frequency text,
  payout_end_date date,
  coverage text,
  beneficiary text,
  also_covers text[] DEFAULT '{}'::text[] NOT NULL,
  surrender_value numeric,
  external_url text,
  is_giro boolean DEFAULT false NOT NULL,
  hidden_from_advisors boolean DEFAULT false NOT NULL,
  surrender_value_date date,
  surrender_value_last_updated date
);

CREATE TABLE public.inventory_folders (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  parent_id uuid,
  name text NOT NULL,
  photo_url text,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  household_id uuid DEFAULT default_household_id() NOT NULL,
  photo_size_bytes bigint
);

CREATE TABLE public.inventory_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  folder_id uuid,
  member_id uuid,
  name text NOT NULL,
  description text,
  quantity integer DEFAULT 1,
  image_url text,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  household_id uuid DEFAULT default_household_id() NOT NULL,
  category text,
  action text,
  warranty_date date,
  photo_url text,
  photo_size_bytes bigint
);

CREATE TABLE public.investments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  member_id uuid,
  action_member_id uuid,
  name text NOT NULL,
  group_name text,
  cost_basis numeric,
  current_value numeric,
  projected_return_pct numeric,
  strategy text,
  action text,
  notes text,
  status record_status DEFAULT 'review'::record_status NOT NULL,
  is_demo boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  household_id uuid DEFAULT default_household_id() NOT NULL,
  premium_start_date date,
  premium_frequency text,
  premium_end_date date,
  coverage text,
  premium_amount numeric,
  payout_amount numeric,
  payout_start_date date,
  payout_end_date date,
  payout_frequency text,
  currency text DEFAULT 'SGD'::text,
  last_updated date,
  external_url text,
  is_giro boolean DEFAULT false NOT NULL,
  hidden_from_advisors boolean DEFAULT false NOT NULL
);

CREATE TABLE public.loan_rate_schedule (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  loan_id uuid NOT NULL,
  year_label text NOT NULL,
  rate numeric,
  rate_type text,
  sort_order integer DEFAULT 0 NOT NULL,
  household_id uuid DEFAULT default_household_id() NOT NULL
);

CREATE TABLE public.loans (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  member_id uuid,
  action_member_id uuid,
  bank text NOT NULL,
  purpose text,
  original_amount numeric,
  balance numeric,
  start_date date,
  term_years numeric,
  rate numeric,
  rate_label text,
  reprice_date date,
  action text,
  notes text,
  status record_status DEFAULT 'review'::record_status NOT NULL,
  is_demo boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  household_id uuid DEFAULT default_household_id() NOT NULL,
  monthly_payment numeric,
  property_id uuid,
  loan_end_date date,
  external_url text,
  currency text DEFAULT 'SGD'::text,
  hidden_from_advisors boolean DEFAULT false NOT NULL
);

CREATE TABLE public.members (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  emoji text,
  color text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  short_name text,
  sort_order integer DEFAULT 0 NOT NULL,
  household_id uuid DEFAULT default_household_id() NOT NULL,
  birth_year integer
);

CREATE TABLE public.other_assets (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  member_id uuid,
  action_member_id uuid,
  name text NOT NULL,
  category text DEFAULT 'Other'::text NOT NULL,
  estimated_value numeric,
  last_updated date,
  notes text,
  action text,
  status record_status DEFAULT 'review'::record_status NOT NULL,
  is_demo boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  household_id uuid NOT NULL,
  currency text DEFAULT 'SGD'::text
);

CREATE TABLE public.planned_cashflow_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  household_id uuid NOT NULL,
  label text NOT NULL,
  year integer NOT NULL,
  amount numeric NOT NULL,
  type text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.properties (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  member_id uuid,
  action_member_id uuid,
  name text NOT NULL,
  address text,
  purpose text,
  currency text DEFAULT 'SGD'::text NOT NULL,
  purchase_price numeric,
  purchase_date date,
  current_value numeric,
  mortgage_bank text,
  mortgage_balance numeric,
  monthly_payment numeric,
  interest_rate numeric,
  rate_type text,
  fixed_rate_end date,
  monthly_rent numeric,
  market_rent numeric,
  cost_management numeric,
  cost_property_tax numeric,
  cost_fire_insurance numeric,
  cost_maintenance numeric,
  cost_other_label text,
  cost_other numeric,
  strategy text,
  action_note text,
  notes text,
  status record_status DEFAULT 'review'::record_status NOT NULL,
  is_demo boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  household_id uuid DEFAULT default_household_id() NOT NULL,
  mortgage_end_date date,
  beneficiary text,
  external_url text,
  joint_member_id uuid,
  hidden_from_advisors boolean DEFAULT false NOT NULL
);

CREATE TABLE public.property_rate_schedule (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  property_id uuid NOT NULL,
  year_label text NOT NULL,
  rate numeric,
  rate_type text,
  sort_order integer DEFAULT 0 NOT NULL,
  household_id uuid DEFAULT default_household_id() NOT NULL
);

CREATE TABLE public.record_documents (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  bucket text DEFAULT 'vault-docs'::text NOT NULL,
  path text NOT NULL,
  label text,
  reminder_date date,
  uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
  household_id uuid DEFAULT default_household_id() NOT NULL,
  size_bytes bigint DEFAULT 0 NOT NULL
);

CREATE TABLE public.record_history (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  note text NOT NULL,
  occurred_on date DEFAULT CURRENT_DATE NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  household_id uuid DEFAULT default_household_id() NOT NULL
);

CREATE TABLE public.reminders (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  entity_type text,
  entity_id uuid,
  what text,
  remind_at timestamp with time zone,
  dismissed boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  household_id uuid DEFAULT default_household_id() NOT NULL,
  recurrence text,
  recurrence_end_of_month boolean DEFAULT false NOT NULL
);

CREATE TABLE public.savings_accounts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  member_id uuid,
  action_member_id uuid,
  institution text NOT NULL,
  account_type text,
  account_number text,
  group_name text,
  balance numeric,
  interest_rate numeric,
  monthly_contribution numeric,
  maturity_date date,
  last_updated date,
  note text,
  action text,
  notes text,
  status record_status DEFAULT 'review'::record_status NOT NULL,
  is_demo boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  household_id uuid DEFAULT default_household_id() NOT NULL,
  withdrawal_date date,
  estimated_monthly_payout numeric,
  joint_member_id uuid,
  currency text DEFAULT 'SGD'::text
);

CREATE TABLE public.travel_checklist_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  household_id uuid NOT NULL,
  label text NOT NULL,
  checked boolean DEFAULT false NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  category text
);

CREATE TABLE public.user_profiles (
  user_id uuid NOT NULL,
  email text,
  display_name text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.advisor_household_links ADD CONSTRAINT advisor_household_links_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.advisor_invites ADD CONSTRAINT advisor_invites_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.advisor_link_members ADD CONSTRAINT advisor_link_members_pkey PRIMARY KEY (link_id, member_id);

ALTER TABLE ONLY public.advisor_policy_charts ADD CONSTRAINT advisor_policy_charts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.advisor_record_notes ADD CONSTRAINT advisor_record_notes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.app_settings ADD CONSTRAINT app_settings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.credit_cards ADD CONSTRAINT credit_cards_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.deleted_records ADD CONSTRAINT deleted_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dismissed_dashboard_items ADD CONSTRAINT dismissed_dashboard_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.error_logs ADD CONSTRAINT error_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.estate_checklist ADD CONSTRAINT estate_checklist_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.fx_rates ADD CONSTRAINT fx_rates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.gobag_items ADD CONSTRAINT gobag_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.health_conditions ADD CONSTRAINT health_conditions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.household_invites ADD CONSTRAINT household_invites_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.household_users ADD CONSTRAINT household_users_pkey PRIMARY KEY (household_id, user_id);

ALTER TABLE ONLY public.households ADD CONSTRAINT households_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.insurance_policies ADD CONSTRAINT insurance_policies_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.inventory_folders ADD CONSTRAINT inventory_folders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.inventory_items ADD CONSTRAINT inventory_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.investments ADD CONSTRAINT investments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.loan_rate_schedule ADD CONSTRAINT loan_rate_schedule_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.loans ADD CONSTRAINT loans_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.members ADD CONSTRAINT members_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.other_assets ADD CONSTRAINT other_assets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.planned_cashflow_events ADD CONSTRAINT planned_cashflow_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.properties ADD CONSTRAINT properties_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.property_rate_schedule ADD CONSTRAINT property_rate_schedule_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.record_documents ADD CONSTRAINT record_documents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.record_history ADD CONSTRAINT record_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.reminders ADD CONSTRAINT reminders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.savings_accounts ADD CONSTRAINT savings_accounts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.travel_checklist_items ADD CONSTRAINT travel_checklist_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_profiles ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.advisor_household_links ADD CONSTRAINT advisor_household_links_household_id_advisor_user_id_key UNIQUE (household_id, advisor_user_id);

ALTER TABLE ONLY public.advisor_invites ADD CONSTRAINT advisor_invites_token_key UNIQUE (token);

ALTER TABLE ONLY public.advisor_policy_charts ADD CONSTRAINT advisor_policy_charts_link_id_record_id_key UNIQUE (link_id, record_id);

ALTER TABLE ONLY public.advisor_record_notes ADD CONSTRAINT advisor_record_notes_link_id_record_id_key UNIQUE (link_id, record_id);

ALTER TABLE ONLY public.app_settings ADD CONSTRAINT app_settings_household_id_key UNIQUE (household_id);

ALTER TABLE ONLY public.dismissed_dashboard_items ADD CONSTRAINT dismissed_dashboard_items_reminder_unique UNIQUE (household_id, reminder_id);

ALTER TABLE ONLY public.dismissed_dashboard_items ADD CONSTRAINT dismissed_dashboard_items_unique UNIQUE (household_id, source_type, record_id, dismissed_date);

ALTER TABLE ONLY public.estate_checklist ADD CONSTRAINT estate_checklist_household_id_item_id_key UNIQUE (household_id, item_id);

ALTER TABLE ONLY public.fx_rates ADD CONSTRAINT fx_rates_rate_date_base_currency_key UNIQUE (rate_date, base_currency);

ALTER TABLE ONLY public.household_invites ADD CONSTRAINT household_invites_token_key UNIQUE (token);

ALTER TABLE ONLY public.households ADD CONSTRAINT households_slug_key UNIQUE (slug);

ALTER TABLE ONLY public.advisor_household_links ADD CONSTRAINT advisor_household_links_status_check CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text])));

ALTER TABLE ONLY public.advisor_policy_charts ADD CONSTRAINT advisor_policy_charts_record_category_check CHECK ((record_category = ANY (ARRAY['insurance'::text, 'investments'::text])));

ALTER TABLE ONLY public.advisor_record_notes ADD CONSTRAINT advisor_record_notes_record_category_check CHECK ((record_category = ANY (ARRAY['insurance'::text, 'investments'::text])));

ALTER TABLE ONLY public.advisor_record_notes ADD CONSTRAINT advisor_record_notes_status_check CHECK (((status IS NULL) OR (status = ANY (ARRAY['paid'::text, 'ongoing'::text, 'review'::text]))));

ALTER TABLE ONLY public.audit_log ADD CONSTRAINT audit_log_action_check CHECK ((action = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text])));

ALTER TABLE ONLY public.household_invites ADD CONSTRAINT household_invites_role_check CHECK ((role = ANY (ARRAY['member'::text, 'viewer'::text])));

ALTER TABLE ONLY public.household_users ADD CONSTRAINT household_users_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'member'::text, 'viewer'::text])));

ALTER TABLE ONLY public.households ADD CONSTRAINT households_storage_tier_check CHECK ((storage_tier = ANY (ARRAY['free'::text, 'premium'::text])));

ALTER TABLE ONLY public.planned_cashflow_events ADD CONSTRAINT planned_cashflow_events_type_check CHECK ((type = ANY (ARRAY['inflow'::text, 'outflow'::text])));

ALTER TABLE ONLY public.advisor_household_links ADD CONSTRAINT advisor_household_links_advisor_user_id_fkey FOREIGN KEY (advisor_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.advisor_household_links ADD CONSTRAINT advisor_household_links_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.advisor_invites ADD CONSTRAINT advisor_invites_accepted_by_user_id_fkey FOREIGN KEY (accepted_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.advisor_invites ADD CONSTRAINT advisor_invites_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.advisor_invites ADD CONSTRAINT advisor_invites_invited_by_user_id_fkey FOREIGN KEY (invited_by_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.advisor_link_members ADD CONSTRAINT advisor_link_members_link_id_fkey FOREIGN KEY (link_id) REFERENCES advisor_household_links(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.advisor_link_members ADD CONSTRAINT advisor_link_members_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.advisor_policy_charts ADD CONSTRAINT advisor_policy_charts_link_id_fkey FOREIGN KEY (link_id) REFERENCES advisor_household_links(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.advisor_record_notes ADD CONSTRAINT advisor_record_notes_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.advisor_record_notes ADD CONSTRAINT advisor_record_notes_link_id_fkey FOREIGN KEY (link_id) REFERENCES advisor_household_links(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.advisor_record_notes ADD CONSTRAINT advisor_record_notes_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.app_settings ADD CONSTRAINT app_settings_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id);

ALTER TABLE ONLY public.credit_cards ADD CONSTRAINT credit_cards_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.credit_cards ADD CONSTRAINT credit_cards_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.deleted_records ADD CONSTRAINT deleted_records_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.deleted_records ADD CONSTRAINT deleted_records_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.dismissed_dashboard_items ADD CONSTRAINT dismissed_dashboard_items_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.error_logs ADD CONSTRAINT error_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.estate_checklist ADD CONSTRAINT estate_checklist_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.gobag_items ADD CONSTRAINT gobag_items_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id);

ALTER TABLE ONLY public.health_conditions ADD CONSTRAINT health_conditions_action_member_id_fkey FOREIGN KEY (action_member_id) REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.health_conditions ADD CONSTRAINT health_conditions_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id);

ALTER TABLE ONLY public.health_conditions ADD CONSTRAINT health_conditions_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.household_invites ADD CONSTRAINT household_invites_accepted_by_user_id_fkey FOREIGN KEY (accepted_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.household_invites ADD CONSTRAINT household_invites_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.household_invites ADD CONSTRAINT household_invites_invited_by_user_id_fkey FOREIGN KEY (invited_by_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.household_users ADD CONSTRAINT household_users_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.household_users ADD CONSTRAINT household_users_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.household_users ADD CONSTRAINT household_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.insurance_policies ADD CONSTRAINT insurance_policies_action_member_id_fkey FOREIGN KEY (action_member_id) REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.insurance_policies ADD CONSTRAINT insurance_policies_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id);

ALTER TABLE ONLY public.insurance_policies ADD CONSTRAINT insurance_policies_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.inventory_folders ADD CONSTRAINT inventory_folders_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id);

ALTER TABLE ONLY public.inventory_folders ADD CONSTRAINT inventory_folders_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES inventory_folders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.inventory_items ADD CONSTRAINT inventory_items_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES inventory_folders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.inventory_items ADD CONSTRAINT inventory_items_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id);

ALTER TABLE ONLY public.inventory_items ADD CONSTRAINT inventory_items_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.investments ADD CONSTRAINT investments_action_member_id_fkey FOREIGN KEY (action_member_id) REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.investments ADD CONSTRAINT investments_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id);

ALTER TABLE ONLY public.investments ADD CONSTRAINT investments_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.loan_rate_schedule ADD CONSTRAINT loan_rate_schedule_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id);

ALTER TABLE ONLY public.loan_rate_schedule ADD CONSTRAINT loan_rate_schedule_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.loans ADD CONSTRAINT loans_action_member_id_fkey FOREIGN KEY (action_member_id) REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.loans ADD CONSTRAINT loans_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id);

ALTER TABLE ONLY public.loans ADD CONSTRAINT loans_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.loans ADD CONSTRAINT loans_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.members ADD CONSTRAINT members_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id);

ALTER TABLE ONLY public.other_assets ADD CONSTRAINT other_assets_action_member_id_fkey FOREIGN KEY (action_member_id) REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.other_assets ADD CONSTRAINT other_assets_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.other_assets ADD CONSTRAINT other_assets_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.properties ADD CONSTRAINT properties_action_member_id_fkey FOREIGN KEY (action_member_id) REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.properties ADD CONSTRAINT properties_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id);

ALTER TABLE ONLY public.properties ADD CONSTRAINT properties_joint_member_id_fkey FOREIGN KEY (joint_member_id) REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.properties ADD CONSTRAINT properties_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.property_rate_schedule ADD CONSTRAINT property_rate_schedule_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id);

ALTER TABLE ONLY public.property_rate_schedule ADD CONSTRAINT property_rate_schedule_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.record_documents ADD CONSTRAINT record_documents_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id);

ALTER TABLE ONLY public.record_history ADD CONSTRAINT record_history_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id);

ALTER TABLE ONLY public.reminders ADD CONSTRAINT reminders_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id);

ALTER TABLE ONLY public.savings_accounts ADD CONSTRAINT savings_accounts_action_member_id_fkey FOREIGN KEY (action_member_id) REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.savings_accounts ADD CONSTRAINT savings_accounts_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id);

ALTER TABLE ONLY public.savings_accounts ADD CONSTRAINT savings_accounts_joint_member_id_fkey FOREIGN KEY (joint_member_id) REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.savings_accounts ADD CONSTRAINT savings_accounts_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.travel_checklist_items ADD CONSTRAINT travel_checklist_items_household_id_fkey FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_profiles ADD CONSTRAINT user_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX advisor_invites_email_idx ON public.advisor_invites USING btree (invited_email);

CREATE INDEX advisor_invites_household_id_idx ON public.advisor_invites USING btree (household_id);

CREATE INDEX advisor_links_advisor_user_id_idx ON public.advisor_household_links USING btree (advisor_user_id);

CREATE INDEX advisor_links_household_id_idx ON public.advisor_household_links USING btree (household_id);

CREATE INDEX advisor_policy_charts_link_idx ON public.advisor_policy_charts USING btree (link_id);

CREATE INDEX advisor_policy_charts_record_idx ON public.advisor_policy_charts USING btree (record_id);

CREATE INDEX app_settings_household_id_idx ON public.app_settings USING btree (household_id);

CREATE INDEX audit_log_household_id_idx ON public.audit_log USING btree (household_id, created_at DESC);

CREATE INDEX audit_log_record_id_idx ON public.audit_log USING btree (table_name, record_id);

CREATE INDEX deleted_records_batch_idx ON public.deleted_records USING btree (household_id, batch_id);

CREATE INDEX deleted_records_household_id_idx ON public.deleted_records USING btree (household_id);

CREATE INDEX error_logs_created_at_idx ON public.error_logs USING btree (created_at DESC);

CREATE INDEX gobag_items_household_id_idx ON public.gobag_items USING btree (household_id);

CREATE INDEX health_conditions_household_id_idx ON public.health_conditions USING btree (household_id);

CREATE INDEX health_member_idx ON public.health_conditions USING btree (member_id);

CREATE INDEX health_status_idx ON public.health_conditions USING btree (status);

CREATE INDEX household_invites_household_id_idx ON public.household_invites USING btree (household_id);

CREATE INDEX household_invites_invited_email_idx ON public.household_invites USING btree (lower(invited_email));

CREATE INDEX household_invites_pending_idx ON public.household_invites USING btree (token) WHERE ((accepted_at IS NULL) AND (cancelled_at IS NULL));

CREATE INDEX household_users_user_id_idx ON public.household_users USING btree (user_id);

CREATE INDEX idx_dismissed_dashboard_not_deleted ON public.dismissed_dashboard_items USING btree (household_id, permanently_deleted) WHERE (permanently_deleted = false);

CREATE INDEX insurance_member_idx ON public.insurance_policies USING btree (member_id);

CREATE INDEX insurance_policies_household_id_idx ON public.insurance_policies USING btree (household_id);

CREATE INDEX insurance_status_idx ON public.insurance_policies USING btree (status);

CREATE INDEX inventory_folders_household_id_idx ON public.inventory_folders USING btree (household_id);

CREATE INDEX inventory_items_household_id_idx ON public.inventory_items USING btree (household_id);

CREATE INDEX investments_household_id_idx ON public.investments USING btree (household_id);

CREATE INDEX investments_member_idx ON public.investments USING btree (member_id);

CREATE INDEX investments_status_idx ON public.investments USING btree (status);

CREATE INDEX loan_rate_schedule_household_id_idx ON public.loan_rate_schedule USING btree (household_id);

CREATE INDEX loans_household_id_idx ON public.loans USING btree (household_id);

CREATE INDEX loans_member_idx ON public.loans USING btree (member_id);

CREATE INDEX loans_status_idx ON public.loans USING btree (status);

CREATE INDEX members_household_id_idx ON public.members USING btree (household_id);

CREATE INDEX other_assets_household_id_idx ON public.other_assets USING btree (household_id);

CREATE INDEX other_assets_member_id_idx ON public.other_assets USING btree (member_id);

CREATE INDEX other_assets_member_idx ON public.other_assets USING btree (member_id);

CREATE INDEX other_assets_status_idx ON public.other_assets USING btree (status);

CREATE INDEX properties_household_id_idx ON public.properties USING btree (household_id);

CREATE INDEX properties_member_idx ON public.properties USING btree (member_id);

CREATE INDEX properties_status_idx ON public.properties USING btree (status);

CREATE INDEX property_rate_schedule_household_id_idx ON public.property_rate_schedule USING btree (household_id);

CREATE INDEX record_documents_entity_idx ON public.record_documents USING btree (entity_type, entity_id);

CREATE INDEX record_documents_household_id_idx ON public.record_documents USING btree (household_id);

CREATE INDEX record_history_entity_idx ON public.record_history USING btree (entity_type, entity_id);

CREATE INDEX record_history_household_id_idx ON public.record_history USING btree (household_id);

CREATE INDEX reminders_entity_idx ON public.reminders USING btree (entity_type, entity_id);

CREATE INDEX reminders_household_id_idx ON public.reminders USING btree (household_id);

CREATE INDEX reminders_remind_at_idx ON public.reminders USING btree (remind_at);

CREATE INDEX savings_accounts_household_id_idx ON public.savings_accounts USING btree (household_id);

CREATE INDEX savings_member_idx ON public.savings_accounts USING btree (member_id);

CREATE INDEX savings_status_idx ON public.savings_accounts USING btree (status);

CREATE OR REPLACE FUNCTION public.backup_storage_manifest(p_household text DEFAULT NULL::text)
 RETURNS TABLE(bucket_id text, name text, size bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT o.bucket_id::text, o.name::text, COALESCE((o.metadata->>'size')::bigint, 0)
  FROM storage.objects o
  WHERE o.bucket_id IN ('vault-docs', 'inventory-photos')
    AND o.metadata IS NOT NULL
    AND o.name NOT LIKE '%/.emptyFolderPlaceholder'
    AND (p_household IS NULL OR split_part(o.name, '/', 1) = p_household)
  ORDER BY o.bucket_id, o.name
$function$
;

CREATE OR REPLACE FUNCTION public.backup_storage_summary()
 RETURNS TABLE(household text, files bigint, bytes bigint, digest text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT split_part(o.name, '/', 1),
         count(*),
         COALESCE(sum((o.metadata->>'size')::bigint), 0)::bigint,
         md5(string_agg(o.bucket_id \|\| '/' \|\| o.name \|\| ':' \|\| COALESCE(o.metadata->>'size', '0'),
                        E'\\n' ORDER BY o.bucket_id, o.name))
  FROM storage.objects o
  WHERE o.bucket_id IN ('vault-docs', 'inventory-photos')
    AND o.metadata IS NOT NULL
    AND o.name NOT LIKE '%/.emptyFolderPlaceholder'
  GROUP BY 1
  ORDER BY 1
$function$
;

CREATE OR REPLACE FUNCTION public.cascade_reminders_for_entity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_entity_type text;
BEGIN
  v_entity_type := TG_ARGV[0];

  DELETE FROM public.reminders r
  WHERE r.entity_type = v_entity_type
    AND r.entity_id = OLD.id
    AND r.household_id = OLD.household_id;

  RETURN OLD;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_orphaned_household()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  remaining int;
begin
  select count(*) into remaining from household_users where household_id = old.household_id;
  if remaining = 0 then
    delete from app_settings where household_id = old.household_id;
    delete from gobag_items where household_id = old.household_id;
    delete from health_conditions where household_id = old.household_id;
    delete from inventory_folders where household_id = old.household_id;
    delete from inventory_items where household_id = old.household_id;
    delete from insurance_policies where household_id = old.household_id;
    delete from investments where household_id = old.household_id;
    delete from loan_rate_schedule where household_id = old.household_id;
    delete from loans where household_id = old.household_id;
    delete from members where household_id = old.household_id;
    delete from properties where household_id = old.household_id;
    delete from property_rate_schedule where household_id = old.household_id;
    delete from record_documents where household_id = old.household_id;
    delete from record_history where household_id = old.household_id;
    delete from reminders where household_id = old.household_id;
    delete from savings_accounts where household_id = old.household_id;
    delete from households where id = old.household_id;
  end if;
  return old;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.current_household_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  SELECT COALESCE(
    NULLIF(auth.jwt() ->> 'household_id', '')::uuid,
    (
      SELECT hu.household_id
      FROM public.household_users hu
      WHERE hu.user_id = auth.uid()
      ORDER BY hu.created_at ASC
      LIMIT 1
    )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.current_user_household_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
AS $function$
  SELECT hu.household_id
  FROM public.household_users hu
  WHERE hu.user_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.default_household_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  SELECT hu.household_id FROM public.household_users hu
  WHERE hu.user_id = auth.uid() LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_household_storage_quota()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_household_id uuid;
  v_tier text;
  v_used bigint;
  v_incoming bigint;
  v_cap bigint := 10485760; -- 10 * 1024 * 1024 — matches the 10MB limit already shown in the app
begin
  if NEW.bucket_id not in ('vault-docs', 'inventory-photos') then
    return NEW;
  end if;

  v_household_id := split_part(NEW.name, '/', 1)::uuid;
  v_incoming := coalesce((NEW.metadata->>'size')::bigint, 0);

  select storage_tier, storage_bytes_used into v_tier, v_used
  from households where id = v_household_id;

  if v_tier = 'premium' then
    return NEW;
  end if;

  if coalesce(v_used, 0) + v_incoming > v_cap then
    raise exception 'storage_quota_exceeded: household % is at its free storage limit', v_household_id;
  end if;

  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ensure_household_app_settings()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.app_settings (household_id, family_name)
  VALUES (NEW.id, COALESCE(NULLIF(trim(NEW.name), ''), 'Our Family'))
  ON CONFLICT (household_id) DO NOTHING;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.ensure_household_default_member()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_household_id uuid;
  v_household_name text;
  v_invite record;
BEGIN
  IF NEW.is_anonymous IS TRUE THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.user_profiles (user_id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_invite
  FROM public.household_invites
  WHERE lower(invited_email) = lower(NEW.email)
    AND accepted_at IS NULL
    AND cancelled_at IS NULL
    AND expires_at > now()
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_invite.id IS NOT NULL THEN
    INSERT INTO public.household_users (household_id, user_id, role, invited_by)
    VALUES (v_invite.household_id, NEW.id, v_invite.role, v_invite.invited_by_user_id)
    ON CONFLICT (household_id, user_id) DO NOTHING;

    UPDATE public.household_invites
    SET accepted_at = now(), accepted_by_user_id = NEW.id
    WHERE id = v_invite.id;

    RETURN NEW;
  END IF;

  v_household_name := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
    NULLIF(trim(NEW.raw_user_meta_data ->> 'name'), ''),
    CONCAT(split_part(COALESCE(NEW.email, 'user'), '@', 1), '''s Household')
  );
  INSERT INTO public.households (name)
  VALUES (v_household_name)
  RETURNING id INTO v_household_id;
  INSERT INTO public.household_users (household_id, user_id, role)
  VALUES (v_household_id, NEW.id, 'owner')
  ON CONFLICT (household_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.has_advisor_access(target_household_id uuid, category text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM advisor_household_links l
    WHERE l.household_id = target_household_id
      AND l.advisor_user_id = auth.uid()
      AND l.status = 'active'
      AND l.consent_renewed_at > (now() - interval '365 days')
      AND (
        (category = 'insurance' AND l.can_view_insurance)
        OR (category = 'investments' AND l.can_view_investments)
        OR (category = 'networth_summary' AND l.can_view_networth_summary)
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.has_advisor_access(target_household_id uuid, target_member_id uuid, category text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists (
    select 1 from public.advisor_household_links l
    where l.household_id = target_household_id
      and l.advisor_user_id = auth.uid()
      and l.status = 'active'
      and l.consent_renewed_at > (now() - interval '365 days')
      and (
        (category = 'insurance' and l.can_view_insurance)
        or (category = 'investments' and l.can_view_investments)
        or (category = 'networth_summary' and l.can_view_networth_summary)
        or (category = 'property' and l.can_view_property)
        or (category = 'loans' and l.can_view_loans)
      )
      and exists (
        select 1 from public.advisor_link_members alm
        where alm.link_id = l.id
          and (target_member_id is null or alm.member_id = target_member_id)
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.increment_household_storage(p_household_id uuid, p_delta bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_household_member(p_household_id) then
    raise exception 'not a member of this household';
  end if;

  update households
  set storage_bytes_used = (
    select coalesce(sum((o.metadata->>'size')::bigint), 0)
    from storage.objects o
    where o.bucket_id in ('vault-docs', 'inventory-photos')
      and o.name like p_household_id::text \|\| '/%'
  )
  where id = p_household_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_guest()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$function$
;

CREATE OR REPLACE FUNCTION public.is_household_editor(target_household_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.household_users hu
    WHERE hu.household_id = target_household_id
      AND hu.user_id = auth.uid()
      AND hu.role IN ('owner', 'member')
  )
  AND NOT (SELECT public.is_guest());
$function$
;

CREATE OR REPLACE FUNCTION public.is_household_member(target_household_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.household_users hu
    WHERE hu.household_id = target_household_id
      AND hu.user_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.log_financial_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_household_id uuid;
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_changed_fields text[];
  v_key text;
begin
  v_old := case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(OLD) else null end;
  v_new := case when TG_OP in ('UPDATE', 'INSERT') then to_jsonb(NEW) else null end;
  v_row := coalesce(v_new, v_old);

  -- household_id lives directly on some of these tables (investments, savings_accounts,
  -- loans, other_assets) but NOT on insurance_policies or properties (member_id only,
  -- verified against the actual schema, not assumed) — derive it via member_id there instead.
  if v_row ? 'household_id' then
    v_household_id := (v_row ->> 'household_id')::uuid;
  elsif v_row ? 'member_id' and (v_row ->> 'member_id') is not null then
    select household_id into v_household_id from members where id = (v_row ->> 'member_id')::uuid;
  end if;

  if TG_OP = 'UPDATE' then
    select array_agg(k) into v_changed_fields
    from jsonb_each(v_new) as n(k, val)
    where n.val is distinct from (v_old -> n.k)
      and n.k not in ('updated_at'); -- pure timestamp bumps aren't a meaningful "edit"
    if v_changed_fields is null then
      return NEW; -- nothing meaningful changed — don't log a no-op
    end if;
  end if;

  insert into audit_log (household_id, table_name, record_id, action, changed_by, changed_fields, old_data, new_data)
  values (
    v_household_id,
    TG_TABLE_NAME,
    (v_row ->> 'id')::uuid,
    TG_OP,
    auth.uid(),
    v_changed_fields,
    v_old,
    v_new
  );

  return coalesce(NEW, OLD);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_credit_cards_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.share_household_by_email(p_household_id uuid, p_email text, p_role text DEFAULT 'member'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.sync_lrs_household_id()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.household_id IS NULL THEN
    SELECT l.household_id INTO NEW.household_id
    FROM public.loans l
    WHERE l.id = NEW.loan_id;
  END IF;

  IF NEW.household_id IS NULL THEN
    NEW.household_id := public.default_household_id();
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_prs_household_id()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.household_id IS NULL THEN
    SELECT p.household_id INTO NEW.household_id
    FROM public.properties p
    WHERE p.id = NEW.property_id;
  END IF;

  IF NEW.household_id IS NULL THEN
    NEW.household_id := public.default_household_id();
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.transfer_household_ownership_by_email(p_household_id uuid, p_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_target_user_id uuid;
  v_email text := lower(trim(COALESCE(p_email, '')));
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

  IF NOT EXISTS (
    SELECT 1
    FROM public.household_users hu
    WHERE hu.household_id = p_household_id
      AND hu.user_id = v_actor
      AND hu.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only household owners can transfer ownership.';
  END IF;

  SELECT u.id
  INTO v_target_user_id
  FROM auth.users u
  WHERE lower(u.email) = v_email
  LIMIT 1;

  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'No account found for that email.';
  END IF;

  IF v_target_user_id = v_actor THEN
    RAISE EXCEPTION 'You are already the owner.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.household_users hu
    WHERE hu.household_id = p_household_id
      AND hu.user_id = v_target_user_id
  ) THEN
    RAISE EXCEPTION 'Target user must already be a member of this household.';
  END IF;

  -- Enforce a single owner after transfer.
  UPDATE public.household_users
  SET role = 'member'
  WHERE household_id = p_household_id
    AND role = 'owner';

  UPDATE public.household_users
  SET role = 'owner'
  WHERE household_id = p_household_id
    AND user_id = v_target_user_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_reminder_target()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_exists boolean := false;
BEGIN
  IF NEW.entity_type IS NULL OR NEW.entity_id IS NULL THEN
    RAISE EXCEPTION 'reminders.entity_type and reminders.entity_id are required';
  END IF;

  IF NEW.household_id IS NULL THEN
    RAISE EXCEPTION 'reminders.household_id is required for entity integrity checks';
  END IF;

  IF NEW.entity_type = 'property' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = NEW.entity_id
        AND p.household_id = NEW.household_id
    ) INTO v_exists;

  ELSIF NEW.entity_type = 'loan' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.loans l
      WHERE l.id = NEW.entity_id
        AND l.household_id = NEW.household_id
    ) INTO v_exists;

  ELSIF NEW.entity_type = 'insurance' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.insurance_policies i
      WHERE i.id = NEW.entity_id
        AND i.household_id = NEW.household_id
    ) INTO v_exists;

  ELSIF NEW.entity_type = 'investment' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.investments i
      WHERE i.id = NEW.entity_id
        AND i.household_id = NEW.household_id
    ) INTO v_exists;

  ELSIF NEW.entity_type = 'savings' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.savings_accounts s
      WHERE s.id = NEW.entity_id
        AND s.household_id = NEW.household_id
    ) INTO v_exists;

  ELSIF NEW.entity_type = 'health' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.health_conditions h
      WHERE h.id = NEW.entity_id
        AND h.household_id = NEW.household_id
    ) INTO v_exists;

  ELSIF NEW.entity_type = 'inventory' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.inventory_items ii
      WHERE ii.id = NEW.entity_id
        AND ii.household_id = NEW.household_id
    ) INTO v_exists;

  ELSIF NEW.entity_type = 'other_asset' THEN
    IF to_regclass('public.other_assets') IS NULL THEN
      RAISE EXCEPTION 'entity_type other_asset is not available: public.other_assets does not exist';
    END IF;

    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM public.other_assets oa
         WHERE oa.id = $1
           AND oa.household_id = $2
       )'
    INTO v_exists
    USING NEW.entity_id, NEW.household_id;

  ELSE
    RAISE EXCEPTION 'Unsupported reminders.entity_type: %', NEW.entity_type;
  END IF;

  IF NOT v_exists THEN
    RAISE EXCEPTION
      'Invalid reminder target: type=% id=% household_id=%',
      NEW.entity_type,
      NEW.entity_id,
      NEW.household_id;
  END IF;

  RETURN NEW;
END;
$function$
;

REVOKE ALL ON FUNCTION public.backup_storage_manifest(p_household text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backup_storage_manifest(p_household text) TO service_role;

REVOKE ALL ON FUNCTION public.backup_storage_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backup_storage_summary() TO service_role;

REVOKE ALL ON FUNCTION public.cascade_reminders_for_entity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cascade_reminders_for_entity() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.cascade_reminders_for_entity() TO anon;
GRANT EXECUTE ON FUNCTION public.cascade_reminders_for_entity() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cascade_reminders_for_entity() TO service_role;

REVOKE ALL ON FUNCTION public.cleanup_orphaned_household() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_orphaned_household() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_orphaned_household() TO anon;
GRANT EXECUTE ON FUNCTION public.cleanup_orphaned_household() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_orphaned_household() TO service_role;

REVOKE ALL ON FUNCTION public.current_household_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_household_id() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_household_id() TO anon;
GRANT EXECUTE ON FUNCTION public.current_household_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_household_id() TO service_role;

REVOKE ALL ON FUNCTION public.current_user_household_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_household_ids() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_household_ids() TO anon;
GRANT EXECUTE ON FUNCTION public.current_user_household_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_household_ids() TO service_role;

REVOKE ALL ON FUNCTION public.default_household_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.default_household_id() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.default_household_id() TO anon;
GRANT EXECUTE ON FUNCTION public.default_household_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.default_household_id() TO service_role;

REVOKE ALL ON FUNCTION public.enforce_household_storage_quota() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_household_storage_quota() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_household_storage_quota() TO anon;
GRANT EXECUTE ON FUNCTION public.enforce_household_storage_quota() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_household_storage_quota() TO service_role;

REVOKE ALL ON FUNCTION public.ensure_household_app_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_household_app_settings() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_household_app_settings() TO anon;
GRANT EXECUTE ON FUNCTION public.ensure_household_app_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_household_app_settings() TO service_role;

REVOKE ALL ON FUNCTION public.ensure_household_default_member() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_household_default_member() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_household_default_member() TO anon;
GRANT EXECUTE ON FUNCTION public.ensure_household_default_member() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_household_default_member() TO service_role;

REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_auth_user() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_auth_user() TO anon;
GRANT EXECUTE ON FUNCTION public.handle_new_auth_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_auth_user() TO service_role;

REVOKE ALL ON FUNCTION public.has_advisor_access(target_household_id uuid, category text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_advisor_access(target_household_id uuid, category text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_advisor_access(target_household_id uuid, category text) TO anon;
GRANT EXECUTE ON FUNCTION public.has_advisor_access(target_household_id uuid, category text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_advisor_access(target_household_id uuid, category text) TO service_role;

REVOKE ALL ON FUNCTION public.has_advisor_access(target_household_id uuid, target_member_id uuid, category text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_advisor_access(target_household_id uuid, target_member_id uuid, category text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_advisor_access(target_household_id uuid, target_member_id uuid, category text) TO anon;
GRANT EXECUTE ON FUNCTION public.has_advisor_access(target_household_id uuid, target_member_id uuid, category text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_advisor_access(target_household_id uuid, target_member_id uuid, category text) TO service_role;

REVOKE ALL ON FUNCTION public.increment_household_storage(p_household_id uuid, p_delta bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_household_storage(p_household_id uuid, p_delta bigint) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_household_storage(p_household_id uuid, p_delta bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.increment_household_storage(p_household_id uuid, p_delta bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_household_storage(p_household_id uuid, p_delta bigint) TO service_role;

REVOKE ALL ON FUNCTION public.is_guest() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_guest() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_guest() TO anon;
GRANT EXECUTE ON FUNCTION public.is_guest() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_guest() TO service_role;

REVOKE ALL ON FUNCTION public.is_household_editor(target_household_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_household_editor(target_household_id uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_household_editor(target_household_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_household_editor(target_household_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_household_editor(target_household_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.is_household_member(target_household_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_household_member(target_household_id uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_household_member(target_household_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_household_member(target_household_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_household_member(target_household_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.log_financial_audit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_financial_audit() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_financial_audit() TO anon;
GRANT EXECUTE ON FUNCTION public.log_financial_audit() TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_financial_audit() TO service_role;

REVOKE ALL ON FUNCTION public.set_credit_cards_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_credit_cards_updated_at() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_credit_cards_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.set_credit_cards_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_credit_cards_updated_at() TO service_role;

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO service_role;

REVOKE ALL ON FUNCTION public.share_household_by_email(p_household_id uuid, p_email text, p_role text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.share_household_by_email(p_household_id uuid, p_email text, p_role text) TO service_role;

REVOKE ALL ON FUNCTION public.sync_lrs_household_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_lrs_household_id() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_lrs_household_id() TO anon;
GRANT EXECUTE ON FUNCTION public.sync_lrs_household_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_lrs_household_id() TO service_role;

REVOKE ALL ON FUNCTION public.sync_prs_household_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_prs_household_id() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_prs_household_id() TO anon;
GRANT EXECUTE ON FUNCTION public.sync_prs_household_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_prs_household_id() TO service_role;

REVOKE ALL ON FUNCTION public.transfer_household_ownership_by_email(p_household_id uuid, p_email text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_household_ownership_by_email(p_household_id uuid, p_email text) TO anon;
GRANT EXECUTE ON FUNCTION public.transfer_household_ownership_by_email(p_household_id uuid, p_email text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_household_ownership_by_email(p_household_id uuid, p_email text) TO service_role;

REVOKE ALL ON FUNCTION public.validate_reminder_target() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_reminder_target() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_reminder_target() TO anon;
GRANT EXECUTE ON FUNCTION public.validate_reminder_target() TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_reminder_target() TO service_role;

CREATE OR REPLACE VIEW public.advisor_client_summary_view AS
 SELECT h.id AS household_id,
    h.name AS household_name,
    'insurance'::text AS category,
    i.id AS record_id,
    i.name AS record_name,
    i.category AS insurance_category,
    i.premium,
    i.frequency,
    i.start_date,
    i.end_date,
    i.sum_assured,
    i.currency,
    i.updated_at AS last_updated,
    i.is_giro,
    i.member_id,
    m.name AS member_name
   FROM insurance_policies i
     JOIN households h ON h.id = i.household_id
     LEFT JOIN members m ON m.id = i.member_id
  WHERE has_advisor_access(i.household_id, i.member_id, 'insurance'::text) AND NOT i.hidden_from_advisors
UNION ALL
 SELECT h.id AS household_id,
    h.name AS household_name,
    'investments'::text AS category,
    inv.id AS record_id,
    inv.name AS record_name,
    inv.group_name AS insurance_category,
    inv.premium_amount AS premium,
    inv.premium_frequency AS frequency,
    inv.premium_start_date AS start_date,
    inv.premium_end_date AS end_date,
    inv.current_value AS sum_assured,
    inv.currency,
    inv.updated_at AS last_updated,
    false AS is_giro,
    inv.member_id,
    m.name AS member_name
   FROM investments inv
     JOIN households h ON h.id = inv.household_id
     LEFT JOIN members m ON m.id = inv.member_id
  WHERE has_advisor_access(inv.household_id, inv.member_id, 'investments'::text) AND NOT inv.hidden_from_advisors
UNION ALL
 SELECT h.id AS household_id,
    h.name AS household_name,
    'property'::text AS category,
    p.id AS record_id,
    p.name AS record_name,
        CASE p.purpose
            WHEN 'capital_growth'::text THEN 'Capital Growth'::text
            WHEN 'rental_yield'::text THEN 'Rental Yield'::text
            WHEN 'own_home'::text THEN 'Own Home'::text
            ELSE 'Other'::text
        END AS insurance_category,
    NULL::numeric AS premium,
    NULL::text AS frequency,
    NULL::date AS start_date,
    NULL::date AS end_date,
    p.current_value AS sum_assured,
    p.currency,
    p.updated_at AS last_updated,
    false AS is_giro,
    p.member_id,
    m.name AS member_name
   FROM properties p
     JOIN households h ON h.id = p.household_id
     LEFT JOIN members m ON m.id = p.member_id
  WHERE has_advisor_access(p.household_id, p.member_id, 'property'::text) AND NOT p.hidden_from_advisors
UNION ALL
 SELECT h.id AS household_id,
    h.name AS household_name,
    'loans'::text AS category,
    l.id AS record_id,
    (COALESCE(NULLIF(l.purpose, ''::text), 'Loan'::text) \|\| ' · '::text) \|\| l.bank AS record_name,
    COALESCE(NULLIF(l.purpose, ''::text), 'Other'::text) AS insurance_category,
    NULL::numeric AS premium,
    NULL::text AS frequency,
    NULL::date AS start_date,
    NULL::date AS end_date,
    l.balance AS sum_assured,
    l.currency,
    l.updated_at AS last_updated,
    false AS is_giro,
    l.member_id,
    m.name AS member_name
   FROM loans l
     JOIN households h ON h.id = l.household_id
     LEFT JOIN members m ON m.id = l.member_id
  WHERE has_advisor_access(l.household_id, l.member_id, 'loans'::text) AND NOT l.hidden_from_advisors;

CREATE OR REPLACE VIEW public.advisor_networth_components_view AS
 SELECT properties.household_id,
    'property'::text AS source_type,
    properties.current_value AS amount,
    properties.currency,
    NULL::text AS account_type,
    properties.member_id
   FROM properties
  WHERE has_advisor_access(properties.household_id, properties.member_id, 'networth_summary'::text)
UNION ALL
 SELECT investments.household_id,
    'investment'::text AS source_type,
    investments.current_value AS amount,
    investments.currency,
    NULL::text AS account_type,
    investments.member_id
   FROM investments
  WHERE has_advisor_access(investments.household_id, investments.member_id, 'networth_summary'::text)
UNION ALL
 SELECT savings_accounts.household_id,
    'savings'::text AS source_type,
    savings_accounts.balance AS amount,
    savings_accounts.currency,
    savings_accounts.account_type,
    savings_accounts.member_id
   FROM savings_accounts
  WHERE has_advisor_access(savings_accounts.household_id, savings_accounts.member_id, 'networth_summary'::text)
UNION ALL
 SELECT other_assets.household_id,
    'other_asset'::text AS source_type,
    other_assets.estimated_value AS amount,
    other_assets.currency,
    NULL::text AS account_type,
    other_assets.member_id
   FROM other_assets
  WHERE has_advisor_access(other_assets.household_id, other_assets.member_id, 'networth_summary'::text)
UNION ALL
 SELECT insurance_policies.household_id,
    'insurance_surrender'::text AS source_type,
        CASE
            WHEN insurance_policies.surrender_value_date IS NULL OR insurance_policies.surrender_value_date <= CURRENT_DATE THEN insurance_policies.surrender_value
            ELSE 0::numeric
        END AS amount,
    insurance_policies.currency,
    NULL::text AS account_type,
    insurance_policies.member_id
   FROM insurance_policies
  WHERE has_advisor_access(insurance_policies.household_id, insurance_policies.member_id, 'networth_summary'::text)
UNION ALL
 SELECT loans.household_id,
    'loan'::text AS source_type,
    loans.balance AS amount,
    loans.currency,
    NULL::text AS account_type,
    loans.member_id
   FROM loans
  WHERE has_advisor_access(loans.household_id, loans.member_id, 'networth_summary'::text)
UNION ALL
 SELECT properties.household_id,
    'property_mortgage'::text AS source_type,
    properties.mortgage_balance AS amount,
    properties.currency,
    NULL::text AS account_type,
    properties.member_id
   FROM properties
  WHERE has_advisor_access(properties.household_id, properties.member_id, 'networth_summary'::text) AND properties.mortgage_balance IS NOT NULL AND NOT (EXISTS ( SELECT 1
           FROM loans
          WHERE loans.property_id = properties.id));

ALTER TABLE public.advisor_household_links ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.advisor_invites ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.advisor_link_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.advisor_policy_charts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.advisor_record_notes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.credit_cards ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.deleted_records ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.dismissed_dashboard_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.estate_checklist ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.gobag_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.health_conditions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.household_invites ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.household_users ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.insurance_policies ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.inventory_folders ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.investments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.loan_rate_schedule ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.other_assets ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.planned_cashflow_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.property_rate_schedule ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.record_documents ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.record_history ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.savings_accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.travel_checklist_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Tables with row level security DISABLED: (none)

CREATE POLICY advisor_links_select ON public.advisor_household_links AS PERMISSIVE FOR SELECT TO public
  USING ((is_household_member(household_id) OR (advisor_user_id = auth.uid())));

CREATE POLICY advisor_link_members_select ON public.advisor_link_members AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM advisor_household_links l
  WHERE ((l.id = advisor_link_members.link_id) AND (is_household_member(l.household_id) OR (l.advisor_user_id = auth.uid()))))));

CREATE POLICY advisor_policy_charts_delete ON public.advisor_policy_charts AS PERMISSIVE FOR DELETE TO authenticated
  USING ((advisor_user_id = auth.uid()));

CREATE POLICY advisor_policy_charts_insert ON public.advisor_policy_charts AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((advisor_user_id = auth.uid()) AND has_advisor_access(household_id, member_id, record_category)));

CREATE POLICY advisor_policy_charts_select ON public.advisor_policy_charts AS PERMISSIVE FOR SELECT TO authenticated
  USING (((advisor_user_id = auth.uid()) AND has_advisor_access(household_id, member_id, record_category)));

CREATE POLICY advisor_policy_charts_update ON public.advisor_policy_charts AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((advisor_user_id = auth.uid()) AND has_advisor_access(household_id, member_id, record_category)))
  WITH CHECK (((advisor_user_id = auth.uid()) AND has_advisor_access(household_id, member_id, record_category)));

CREATE POLICY advisor_record_notes_delete ON public.advisor_record_notes AS PERMISSIVE FOR DELETE TO public
  USING ((advisor_user_id = auth.uid()));

CREATE POLICY advisor_record_notes_insert ON public.advisor_record_notes AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((advisor_user_id = auth.uid()) AND has_advisor_access(household_id, member_id, record_category) AND (NOT (EXISTS ( SELECT 1
   FROM insurance_policies ip
  WHERE ((advisor_record_notes.record_category = 'insurance'::text) AND (ip.id = advisor_record_notes.record_id) AND ip.hidden_from_advisors)))) AND (NOT (EXISTS ( SELECT 1
   FROM investments inv
  WHERE ((advisor_record_notes.record_category = 'investments'::text) AND (inv.id = advisor_record_notes.record_id) AND inv.hidden_from_advisors))))));

CREATE POLICY advisor_record_notes_select ON public.advisor_record_notes AS PERMISSIVE FOR SELECT TO public
  USING ((is_household_member(household_id) OR (advisor_user_id = auth.uid())));

CREATE POLICY advisor_record_notes_update ON public.advisor_record_notes AS PERMISSIVE FOR UPDATE TO public
  USING ((advisor_user_id = auth.uid()))
  WITH CHECK (((advisor_user_id = auth.uid()) AND has_advisor_access(household_id, member_id, record_category) AND (NOT (EXISTS ( SELECT 1
   FROM insurance_policies ip
  WHERE ((advisor_record_notes.record_category = 'insurance'::text) AND (ip.id = advisor_record_notes.record_id) AND ip.hidden_from_advisors)))) AND (NOT (EXISTS ( SELECT 1
   FROM investments inv
  WHERE ((advisor_record_notes.record_category = 'investments'::text) AND (inv.id = advisor_record_notes.record_id) AND inv.hidden_from_advisors))))));

CREATE POLICY tenant_delete ON public.app_settings AS PERMISSIVE FOR DELETE TO public
  USING (is_household_editor(household_id));

CREATE POLICY tenant_insert ON public.app_settings AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_select ON public.app_settings AS PERMISSIVE FOR SELECT TO public
  USING (is_household_member(household_id));

CREATE POLICY tenant_update ON public.app_settings AS PERMISSIVE FOR UPDATE TO public
  USING (is_household_editor(household_id))
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY audit_log_select ON public.audit_log AS PERMISSIVE FOR SELECT TO public
  USING ((household_id IN ( SELECT household_users.household_id
   FROM household_users
  WHERE (household_users.user_id = auth.uid()))));

CREATE POLICY credit_cards_delete ON public.credit_cards AS PERMISSIVE FOR DELETE TO public
  USING (is_household_editor(household_id));

CREATE POLICY credit_cards_insert ON public.credit_cards AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY credit_cards_select ON public.credit_cards AS PERMISSIVE FOR SELECT TO public
  USING (is_household_member(household_id));

CREATE POLICY credit_cards_update ON public.credit_cards AS PERMISSIVE FOR UPDATE TO public
  USING (is_household_editor(household_id))
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY "household members can remove trash entries" ON public.deleted_records AS PERMISSIVE FOR DELETE TO public
  USING (is_household_editor(household_id));

CREATE POLICY "household members can move records to trash" ON public.deleted_records AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY "household members can view their trash" ON public.deleted_records AS PERMISSIVE FOR SELECT TO public
  USING (is_household_member(household_id));

CREATE POLICY dismissed_dashboard_items_delete ON public.dismissed_dashboard_items AS PERMISSIVE FOR DELETE TO public
  USING (is_household_editor(household_id));

CREATE POLICY dismissed_dashboard_items_insert ON public.dismissed_dashboard_items AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY dismissed_dashboard_items_select ON public.dismissed_dashboard_items AS PERMISSIVE FOR SELECT TO public
  USING (is_household_member(household_id));

CREATE POLICY dismissed_dashboard_items_update ON public.dismissed_dashboard_items AS PERMISSIVE FOR UPDATE TO public
  USING (is_household_editor(household_id))
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY "guests cannot log errors" ON public.error_logs AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((NOT ( SELECT is_guest() AS is_guest)));

CREATE POLICY "users can log their own errors" ON public.error_logs AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY estate_checklist_delete ON public.estate_checklist AS PERMISSIVE FOR DELETE TO public
  USING (is_household_editor(household_id));

CREATE POLICY estate_checklist_insert ON public.estate_checklist AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY estate_checklist_select ON public.estate_checklist AS PERMISSIVE FOR SELECT TO public
  USING (is_household_member(household_id));

CREATE POLICY estate_checklist_update ON public.estate_checklist AS PERMISSIVE FOR UPDATE TO public
  USING (is_household_editor(household_id))
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY "household members can read fx rates" ON public.fx_rates AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY tenant_delete ON public.gobag_items AS PERMISSIVE FOR DELETE TO public
  USING (is_household_editor(household_id));

CREATE POLICY tenant_insert ON public.gobag_items AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_select ON public.gobag_items AS PERMISSIVE FOR SELECT TO public
  USING (is_household_member(household_id));

CREATE POLICY tenant_update ON public.gobag_items AS PERMISSIVE FOR UPDATE TO public
  USING (is_household_editor(household_id))
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_delete ON public.health_conditions AS PERMISSIVE FOR DELETE TO public
  USING (is_household_editor(household_id));

CREATE POLICY tenant_insert ON public.health_conditions AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_select ON public.health_conditions AS PERMISSIVE FOR SELECT TO public
  USING (is_household_member(household_id));

CREATE POLICY tenant_update ON public.health_conditions AS PERMISSIVE FOR UPDATE TO public
  USING (is_household_editor(household_id))
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY "guests cannot remove members" ON public.household_users AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((NOT ( SELECT is_guest() AS is_guest)));

CREATE POLICY household_users_delete ON public.household_users AS PERMISSIVE FOR DELETE TO public
  USING ((EXISTS ( SELECT 1
   FROM household_users hu
  WHERE ((hu.household_id = household_users.household_id) AND (hu.user_id = auth.uid()) AND (hu.role = 'owner'::text)))));

CREATE POLICY "guests can join the sample family as viewers" ON public.household_users AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((( SELECT is_guest() AS is_guest) AND (user_id = auth.uid()) AND (role = 'viewer'::text) AND (household_id = 'a750df45-c320-46fd-b2c8-82389878db07'::uuid) AND (invited_by IS NULL)));

CREATE POLICY "guests may only add themselves to the sample family" ON public.household_users AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (((NOT ( SELECT is_guest() AS is_guest)) OR ((user_id = auth.uid()) AND (role = 'viewer'::text) AND (household_id = 'a750df45-c320-46fd-b2c8-82389878db07'::uuid) AND (invited_by IS NULL))));

CREATE POLICY household_users_insert ON public.household_users AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM household_users hu
  WHERE ((hu.household_id = household_users.household_id) AND (hu.user_id = auth.uid()) AND (hu.role = 'owner'::text)))));

CREATE POLICY household_users_select ON public.household_users AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = auth.uid()));

CREATE POLICY "guests cannot change members" ON public.household_users AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((NOT ( SELECT is_guest() AS is_guest)));

CREATE POLICY household_users_update ON public.household_users AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM household_users hu
  WHERE ((hu.household_id = household_users.household_id) AND (hu.user_id = auth.uid()) AND (hu.role = 'owner'::text)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM household_users hu
  WHERE ((hu.household_id = household_users.household_id) AND (hu.user_id = auth.uid()) AND (hu.role = 'owner'::text)))));

CREATE POLICY "guests cannot delete households" ON public.households AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((NOT ( SELECT is_guest() AS is_guest)));

CREATE POLICY households_delete ON public.households AS PERMISSIVE FOR DELETE TO public
  USING ((EXISTS ( SELECT 1
   FROM household_users hu
  WHERE ((hu.household_id = households.id) AND (hu.user_id = auth.uid()) AND (hu.role = 'owner'::text)))));

CREATE POLICY households_select ON public.households AS PERMISSIVE FOR SELECT TO authenticated
  USING ((id IN ( SELECT household_users.household_id
   FROM household_users
  WHERE (household_users.user_id = auth.uid()))));

CREATE POLICY "guests cannot change households" ON public.households AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((NOT ( SELECT is_guest() AS is_guest)));

CREATE POLICY households_update ON public.households AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM household_users hu
  WHERE ((hu.household_id = households.id) AND (hu.user_id = auth.uid()) AND (hu.role = 'owner'::text)))));

CREATE POLICY tenant_delete ON public.insurance_policies AS PERMISSIVE FOR DELETE TO public
  USING (is_household_editor(household_id));

CREATE POLICY tenant_insert ON public.insurance_policies AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY advisor_select ON public.insurance_policies AS PERMISSIVE FOR SELECT TO public
  USING ((has_advisor_access(household_id, member_id, 'insurance'::text) AND (NOT hidden_from_advisors)));

CREATE POLICY tenant_select ON public.insurance_policies AS PERMISSIVE FOR SELECT TO public
  USING (is_household_member(household_id));

CREATE POLICY tenant_update ON public.insurance_policies AS PERMISSIVE FOR UPDATE TO public
  USING (is_household_editor(household_id))
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_delete ON public.inventory_folders AS PERMISSIVE FOR DELETE TO public
  USING (is_household_editor(household_id));

CREATE POLICY tenant_insert ON public.inventory_folders AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_select ON public.inventory_folders AS PERMISSIVE FOR SELECT TO public
  USING (is_household_member(household_id));

CREATE POLICY tenant_update ON public.inventory_folders AS PERMISSIVE FOR UPDATE TO public
  USING (is_household_editor(household_id))
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_delete ON public.inventory_items AS PERMISSIVE FOR DELETE TO public
  USING (is_household_editor(household_id));

CREATE POLICY tenant_insert ON public.inventory_items AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_select ON public.inventory_items AS PERMISSIVE FOR SELECT TO public
  USING (is_household_member(household_id));

CREATE POLICY tenant_update ON public.inventory_items AS PERMISSIVE FOR UPDATE TO public
  USING (is_household_editor(household_id))
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_delete ON public.investments AS PERMISSIVE FOR DELETE TO public
  USING (is_household_editor(household_id));

CREATE POLICY tenant_insert ON public.investments AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY advisor_select ON public.investments AS PERMISSIVE FOR SELECT TO public
  USING ((has_advisor_access(household_id, member_id, 'investments'::text) AND (NOT hidden_from_advisors)));

CREATE POLICY tenant_select ON public.investments AS PERMISSIVE FOR SELECT TO public
  USING (is_household_member(household_id));

CREATE POLICY tenant_update ON public.investments AS PERMISSIVE FOR UPDATE TO public
  USING (is_household_editor(household_id))
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_delete ON public.loan_rate_schedule AS PERMISSIVE FOR DELETE TO public
  USING (is_household_editor(household_id));

CREATE POLICY tenant_insert ON public.loan_rate_schedule AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_select ON public.loan_rate_schedule AS PERMISSIVE FOR SELECT TO public
  USING (is_household_member(household_id));

CREATE POLICY tenant_update ON public.loan_rate_schedule AS PERMISSIVE FOR UPDATE TO public
  USING (is_household_editor(household_id))
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_delete ON public.loans AS PERMISSIVE FOR DELETE TO public
  USING (is_household_editor(household_id));

CREATE POLICY tenant_insert ON public.loans AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_select ON public.loans AS PERMISSIVE FOR SELECT TO public
  USING (is_household_member(household_id));

CREATE POLICY tenant_update ON public.loans AS PERMISSIVE FOR UPDATE TO public
  USING (is_household_editor(household_id))
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_delete ON public.members AS PERMISSIVE FOR DELETE TO public
  USING (is_household_editor(household_id));

CREATE POLICY tenant_insert ON public.members AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_select ON public.members AS PERMISSIVE FOR SELECT TO public
  USING (is_household_member(household_id));

CREATE POLICY tenant_update ON public.members AS PERMISSIVE FOR UPDATE TO public
  USING (is_household_editor(household_id))
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY other_assets_delete ON public.other_assets AS PERMISSIVE FOR DELETE TO public
  USING (is_household_editor(household_id));

CREATE POLICY other_assets_insert ON public.other_assets AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY other_assets_select ON public.other_assets AS PERMISSIVE FOR SELECT TO public
  USING (is_household_member(household_id));

CREATE POLICY other_assets_update ON public.other_assets AS PERMISSIVE FOR UPDATE TO public
  USING (is_household_editor(household_id))
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_delete ON public.planned_cashflow_events AS PERMISSIVE FOR DELETE TO public
  USING (is_household_editor(household_id));

CREATE POLICY tenant_insert ON public.planned_cashflow_events AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_select ON public.planned_cashflow_events AS PERMISSIVE FOR SELECT TO public
  USING (is_household_member(household_id));

CREATE POLICY tenant_update ON public.planned_cashflow_events AS PERMISSIVE FOR UPDATE TO public
  USING (is_household_editor(household_id))
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_delete ON public.properties AS PERMISSIVE FOR DELETE TO public
  USING (is_household_editor(household_id));

CREATE POLICY tenant_insert ON public.properties AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_select ON public.properties AS PERMISSIVE FOR SELECT TO public
  USING (is_household_member(household_id));

CREATE POLICY tenant_update ON public.properties AS PERMISSIVE FOR UPDATE TO public
  USING (is_household_editor(household_id))
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_delete ON public.property_rate_schedule AS PERMISSIVE FOR DELETE TO public
  USING (is_household_editor(household_id));

CREATE POLICY tenant_insert ON public.property_rate_schedule AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_select ON public.property_rate_schedule AS PERMISSIVE FOR SELECT TO public
  USING (is_household_member(household_id));

CREATE POLICY tenant_update ON public.property_rate_schedule AS PERMISSIVE FOR UPDATE TO public
  USING (is_household_editor(household_id))
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_delete ON public.record_documents AS PERMISSIVE FOR DELETE TO public
  USING (is_household_editor(household_id));

CREATE POLICY tenant_insert ON public.record_documents AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_select ON public.record_documents AS PERMISSIVE FOR SELECT TO public
  USING (is_household_member(household_id));

CREATE POLICY tenant_update ON public.record_documents AS PERMISSIVE FOR UPDATE TO public
  USING (is_household_editor(household_id))
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_delete ON public.record_history AS PERMISSIVE FOR DELETE TO public
  USING (is_household_editor(household_id));

CREATE POLICY tenant_insert ON public.record_history AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_select ON public.record_history AS PERMISSIVE FOR SELECT TO public
  USING (is_household_member(household_id));

CREATE POLICY tenant_update ON public.record_history AS PERMISSIVE FOR UPDATE TO public
  USING (is_household_editor(household_id))
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_delete ON public.reminders AS PERMISSIVE FOR DELETE TO public
  USING (is_household_editor(household_id));

CREATE POLICY tenant_insert ON public.reminders AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_select ON public.reminders AS PERMISSIVE FOR SELECT TO public
  USING (is_household_member(household_id));

CREATE POLICY tenant_update ON public.reminders AS PERMISSIVE FOR UPDATE TO public
  USING (is_household_editor(household_id))
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_delete ON public.savings_accounts AS PERMISSIVE FOR DELETE TO public
  USING (is_household_editor(household_id));

CREATE POLICY tenant_insert ON public.savings_accounts AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY tenant_select ON public.savings_accounts AS PERMISSIVE FOR SELECT TO public
  USING (is_household_member(household_id));

CREATE POLICY tenant_update ON public.savings_accounts AS PERMISSIVE FOR UPDATE TO public
  USING (is_household_editor(household_id))
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY travel_checklist_delete ON public.travel_checklist_items AS PERMISSIVE FOR DELETE TO public
  USING (is_household_editor(household_id));

CREATE POLICY travel_checklist_insert ON public.travel_checklist_items AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY travel_checklist_select ON public.travel_checklist_items AS PERMISSIVE FOR SELECT TO public
  USING (is_household_member(household_id));

CREATE POLICY travel_checklist_update ON public.travel_checklist_items AS PERMISSIVE FOR UPDATE TO public
  USING (is_household_editor(household_id))
  WITH CHECK (is_household_editor(household_id));

CREATE POLICY user_profiles_select ON public.user_profiles AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = auth.uid()));

CREATE POLICY user_profiles_update ON public.user_profiles AS PERMISSIVE FOR UPDATE TO public
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "fv storage household delete" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (((bucket_id = ANY (ARRAY['vault-docs'::text, 'inventory-photos'::text])) AND
CASE
    WHEN (split_part(name, '/'::text, 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) THEN is_household_editor((split_part(name, '/'::text, 1))::uuid)
    ELSE false
END));

CREATE POLICY "fv storage household insert" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = ANY (ARRAY['vault-docs'::text, 'inventory-photos'::text])) AND
CASE
    WHEN (split_part(name, '/'::text, 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) THEN is_household_editor((split_part(name, '/'::text, 1))::uuid)
    ELSE false
END));

CREATE POLICY "fv storage household read" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (((bucket_id = ANY (ARRAY['vault-docs'::text, 'inventory-photos'::text])) AND
CASE
    WHEN (split_part(name, '/'::text, 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) THEN is_household_member((split_part(name, '/'::text, 1))::uuid)
    ELSE false
END));

CREATE POLICY "fv storage household update" ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((bucket_id = ANY (ARRAY['vault-docs'::text, 'inventory-photos'::text])) AND
CASE
    WHEN (split_part(name, '/'::text, 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) THEN is_household_editor((split_part(name, '/'::text, 1))::uuid)
    ELSE false
END))
  WITH CHECK (((bucket_id = ANY (ARRAY['vault-docs'::text, 'inventory-photos'::text])) AND
CASE
    WHEN (split_part(name, '/'::text, 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) THEN is_household_editor((split_part(name, '/'::text, 1))::uuid)
    ELSE false
END));

CREATE TRIGGER on_auth_user_created_household_bootstrap AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();

CREATE TRIGGER trg_credit_cards_updated_at BEFORE UPDATE ON public.credit_cards FOR EACH ROW EXECUTE FUNCTION set_credit_cards_updated_at();

CREATE TRIGGER trg_cascade_reminders_health AFTER DELETE ON public.health_conditions FOR EACH ROW EXECUTE FUNCTION cascade_reminders_for_entity('health');

CREATE TRIGGER trg_health_conditions_updated_at BEFORE UPDATE ON public.health_conditions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_cleanup_orphaned_household AFTER DELETE ON public.household_users FOR EACH ROW EXECUTE FUNCTION cleanup_orphaned_household();

CREATE TRIGGER on_household_created_app_settings AFTER INSERT ON public.households FOR EACH ROW EXECUTE FUNCTION ensure_household_app_settings();

CREATE TRIGGER on_household_created_default_member AFTER INSERT ON public.households FOR EACH ROW EXECUTE FUNCTION ensure_household_default_member();

CREATE TRIGGER audit_insurance_policies AFTER INSERT OR DELETE OR UPDATE ON public.insurance_policies FOR EACH ROW EXECUTE FUNCTION log_financial_audit();

CREATE TRIGGER trg_cascade_reminders_insurance AFTER DELETE ON public.insurance_policies FOR EACH ROW EXECUTE FUNCTION cascade_reminders_for_entity('insurance');

CREATE TRIGGER trg_insurance_policies_updated_at BEFORE UPDATE ON public.insurance_policies FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_cascade_reminders_inventory AFTER DELETE ON public.inventory_items FOR EACH ROW EXECUTE FUNCTION cascade_reminders_for_entity('inventory');

CREATE TRIGGER audit_investments AFTER INSERT OR DELETE OR UPDATE ON public.investments FOR EACH ROW EXECUTE FUNCTION log_financial_audit();

CREATE TRIGGER trg_cascade_reminders_investment AFTER DELETE ON public.investments FOR EACH ROW EXECUTE FUNCTION cascade_reminders_for_entity('investment');

CREATE TRIGGER trg_investments_updated_at BEFORE UPDATE ON public.investments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sync_lrs_household_id BEFORE INSERT OR UPDATE ON public.loan_rate_schedule FOR EACH ROW EXECUTE FUNCTION sync_lrs_household_id();

CREATE TRIGGER audit_loans AFTER INSERT OR DELETE OR UPDATE ON public.loans FOR EACH ROW EXECUTE FUNCTION log_financial_audit();

CREATE TRIGGER trg_cascade_reminders_loan AFTER DELETE ON public.loans FOR EACH ROW EXECUTE FUNCTION cascade_reminders_for_entity('loan');

CREATE TRIGGER trg_loans_updated_at BEFORE UPDATE ON public.loans FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER audit_other_assets AFTER INSERT OR DELETE OR UPDATE ON public.other_assets FOR EACH ROW EXECUTE FUNCTION log_financial_audit();

CREATE TRIGGER trg_cascade_reminders_other_asset AFTER DELETE ON public.other_assets FOR EACH ROW EXECUTE FUNCTION cascade_reminders_for_entity('other_asset');

CREATE TRIGGER trg_cascade_reminders_other_assets AFTER DELETE ON public.other_assets FOR EACH ROW EXECUTE FUNCTION cascade_reminders_for_entity('other_asset');

CREATE TRIGGER trg_other_assets_updated_at BEFORE UPDATE ON public.other_assets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER audit_properties AFTER INSERT OR DELETE OR UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION log_financial_audit();

CREATE TRIGGER trg_cascade_reminders_property AFTER DELETE ON public.properties FOR EACH ROW EXECUTE FUNCTION cascade_reminders_for_entity('property');

CREATE TRIGGER trg_properties_updated_at BEFORE UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sync_prs_household_id BEFORE INSERT OR UPDATE ON public.property_rate_schedule FOR EACH ROW EXECUTE FUNCTION sync_prs_household_id();

CREATE TRIGGER trg_validate_reminder_target BEFORE INSERT OR UPDATE OF entity_type, entity_id, household_id ON public.reminders FOR EACH ROW EXECUTE FUNCTION validate_reminder_target();

CREATE TRIGGER audit_savings_accounts AFTER INSERT OR DELETE OR UPDATE ON public.savings_accounts FOR EACH ROW EXECUTE FUNCTION log_financial_audit();

CREATE TRIGGER trg_cascade_reminders_savings AFTER DELETE ON public.savings_accounts FOR EACH ROW EXECUTE FUNCTION cascade_reminders_for_entity('savings');

CREATE TRIGGER trg_savings_accounts_updated_at BEFORE UPDATE ON public.savings_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.advisor_client_summary_view TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.advisor_client_summary_view TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.advisor_client_summary_view TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.advisor_household_links TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.advisor_household_links TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.advisor_household_links TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.advisor_invites TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.advisor_invites TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.advisor_invites TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.advisor_link_members TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.advisor_link_members TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.advisor_link_members TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.advisor_networth_components_view TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.advisor_networth_components_view TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.advisor_networth_components_view TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.advisor_policy_charts TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.advisor_policy_charts TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.advisor_policy_charts TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.advisor_record_notes TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.advisor_record_notes TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.advisor_record_notes TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.app_settings TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.app_settings TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.app_settings TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.audit_log TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.audit_log TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.audit_log TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.credit_cards TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.credit_cards TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.credit_cards TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.deleted_records TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.deleted_records TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.deleted_records TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.dismissed_dashboard_items TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.dismissed_dashboard_items TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.dismissed_dashboard_items TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.error_logs TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.error_logs TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.error_logs TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.estate_checklist TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.estate_checklist TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.estate_checklist TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.fx_rates TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.fx_rates TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.fx_rates TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.gobag_items TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.gobag_items TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.gobag_items TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.health_conditions TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.health_conditions TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.health_conditions TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.household_invites TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.household_invites TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.household_invites TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.household_users TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.household_users TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.household_users TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.households TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.households TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.households TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.insurance_policies TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.insurance_policies TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.insurance_policies TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.inventory_folders TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.inventory_folders TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.inventory_folders TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.inventory_items TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.inventory_items TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.inventory_items TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.investments TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.investments TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.investments TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.loan_rate_schedule TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.loan_rate_schedule TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.loan_rate_schedule TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.loans TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.loans TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.loans TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.members TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.members TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.members TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.other_assets TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.other_assets TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.other_assets TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.planned_cashflow_events TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.planned_cashflow_events TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.planned_cashflow_events TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.properties TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.properties TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.properties TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.property_rate_schedule TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.property_rate_schedule TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.property_rate_schedule TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.record_documents TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.record_documents TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.record_documents TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.record_history TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.record_history TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.record_history TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.reminders TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.reminders TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.reminders TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.savings_accounts TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.savings_accounts TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.savings_accounts TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.travel_checklist_items TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.travel_checklist_items TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.travel_checklist_items TO service_role;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.user_profiles TO anon;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.user_profiles TO authenticated;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.user_profiles TO service_role;

-- BUCKET inventory-photos: public=f, file_size_limit=5242880, allowed_mime_types={image/jpeg,image/png,image/webp}

-- BUCKET vault-docs: public=f, file_size_limit=10485760, allowed_mime_types={image/jpeg,image/png,image/webp,application/pdf}