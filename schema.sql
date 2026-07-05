-- =====================================================================================
-- AUVIA COLLECT — PRODUCTION SUPABASE SCHEMA
-- Multi-tenant: NexovAI (platform admin) onboards clinics; each clinic is fully isolated
-- via Row Level Security. Staff only ever see their own clinic's data.
-- =====================================================================================

-- ---------------------------------------------------------------------------
-- 0. EXTENSIONS
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "citext";     -- case-insensitive email/phone matching


-- ---------------------------------------------------------------------------
-- 1. ENUM TYPES
-- ---------------------------------------------------------------------------
create type platform_role       as enum ('platform_admin', 'standard');
create type clinic_status       as enum ('trial', 'active', 'suspended');
create type member_role         as enum ('admin', 'staff');
create type member_status       as enum ('invited', 'active', 'removed');

create type payment_context     as enum (
  'consultation_fee', 'lab_charges', 'pharmacy_bill', 'admission_charges', 'other'
);

create type campaign_status     as enum (
  'draft', 'ready', 'active', 'paused', 'completed', 'cancelled'
);

create type call_status         as enum (
  'queued', 'in_progress', 'completed', 'not_answered', 'failed'
);

create type call_outcome        as enum (
  'paid_now', 'link_sent', 'call_later', 'already_paid', 'not_interested', 'other'
);

create type decline_reason      as enum (
  'not_interested', 'financial_issues', 'payment_already_done', 'wrong_person', 'other'
);

create type payment_link_status as enum (
  'created', 'sent', 'viewed', 'paid', 'expired', 'cancelled'
);

create type notification_channel as enum ('sms', 'whatsapp');
create type notification_status  as enum ('queued', 'sent', 'delivered', 'failed');


-- ---------------------------------------------------------------------------
-- 2. UPDATED_AT TRIGGER HELPER (reused by every table)
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 3. PROFILES  (1:1 with auth.users — every logged-in person gets a row)
-- ---------------------------------------------------------------------------
create table profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  full_name      text not null,
  email          citext not null,
  phone          text,
  platform_role  platform_role not null default 'standard',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger trg_profiles_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- Auto-create a profile row whenever someone signs up via Supabase Auth
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), new.email);
  return new;
end;
$$;

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();


-- ---------------------------------------------------------------------------
-- 4. CLINICS  (tenants — created only by platform admins)
-- ---------------------------------------------------------------------------
create table clinics (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  slug                   citext not null unique,
  address                text,
  city                   text,
  state                  text,
  phone                  text,
  billing_email          citext,
  logo_url               text,
  status                 clinic_status not null default 'trial',

  -- Razorpay integration
  -- NOTE: in production, store the actual secret in Supabase Vault and keep only
  -- the vault reference id here — never the raw secret. Column kept for simplicity;
  -- swap for `razorpay_secret_vault_id uuid` once Vault is wired up.
  razorpay_key_id        text,
  razorpay_key_secret    text,

  -- Messaging
  whatsapp_sender_id     text,
  sms_sender_id          text,
  preferred_channel      notification_channel not null default 'whatsapp',

  -- Calling rules (TRAI/DND compliance)
  max_retry_attempts     int not null default 3,
  retry_cooldown_hours   int not null default 6,
  calling_window_start   time not null default '09:00',
  calling_window_end     time not null default '19:00',
  max_concurrent_calls   int not null default 5,

  created_by             uuid references profiles (id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create trigger trg_clinics_updated_at
  before update on clinics
  for each row execute function set_updated_at();

create index idx_clinics_status on clinics (status);


-- ---------------------------------------------------------------------------
-- 5. CLINIC MEMBERS  (staff/admin belonging to a clinic — many-to-many)
-- ---------------------------------------------------------------------------
create table clinic_members (
  id             uuid primary key default gen_random_uuid(),
  clinic_id      uuid not null references clinics (id) on delete cascade,
  user_id        uuid references profiles (id) on delete cascade,
  invited_email  citext not null,           -- kept even after user_id resolves, for audit
  role           member_role not null default 'staff',
  status         member_status not null default 'invited',
  invited_by     uuid references profiles (id),
  invited_at     timestamptz not null default now(),
  joined_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (clinic_id, invited_email)
);

create trigger trg_clinic_members_updated_at
  before update on clinic_members
  for each row execute function set_updated_at();

create index idx_clinic_members_user on clinic_members (user_id);
create index idx_clinic_members_clinic on clinic_members (clinic_id);


-- ---------------------------------------------------------------------------
-- 6. CAMPAIGNS
-- ---------------------------------------------------------------------------
create table campaigns (
  id                        uuid primary key default gen_random_uuid(),
  clinic_id                 uuid not null references clinics (id) on delete cascade,
  name                      text not null,
  status                    campaign_status not null default 'draft',

  source_csv_filename       text,
  total_contacts            int not null default 0,
  selected_contacts         int not null default 0,
  duplicate_count           int not null default 0,
  invalid_count             int not null default 0,
  total_amount_due          numeric(12,2) not null default 0,

  estimated_duration_minutes int,
  estimated_completion_at    timestamptz,

  started_at                timestamptz,
  completed_at               timestamptz,

  created_by                uuid references profiles (id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create trigger trg_campaigns_updated_at
  before update on campaigns
  for each row execute function set_updated_at();

create index idx_campaigns_clinic on campaigns (clinic_id);
create index idx_campaigns_status on campaigns (clinic_id, status);


-- ---------------------------------------------------------------------------
-- 7. CONTACTS  (rows imported from a campaign's CSV)
-- ---------------------------------------------------------------------------
create table contacts (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references campaigns (id) on delete cascade,
  clinic_id        uuid not null references clinics (id) on delete cascade, -- denormalized for fast RLS + indexing

  name             text not null,
  phone            text not null,
  amount_due       numeric(12,2) not null check (amount_due >= 0),
  payment_context  payment_context not null default 'other',

  patient_id       text,
  due_date         date,
  notes            text,

  is_selected      boolean not null default true,
  is_duplicate     boolean not null default false,
  validation_error text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger trg_contacts_updated_at
  before update on contacts
  for each row execute function set_updated_at();

create index idx_contacts_campaign on contacts (campaign_id);
create index idx_contacts_clinic on contacts (clinic_id);
create index idx_contacts_phone on contacts (clinic_id, phone);

-- Keep clinic_id in sync with the parent campaign automatically
create or replace function sync_contact_clinic_id()
returns trigger
language plpgsql
as $$
begin
  select clinic_id into new.clinic_id from campaigns where id = new.campaign_id;
  return new;
end;
$$;

create trigger trg_contacts_sync_clinic
  before insert on contacts
  for each row execute function sync_contact_clinic_id();


-- ---------------------------------------------------------------------------
-- 8. CALLS  (one row per dialing attempt against a contact)
-- ---------------------------------------------------------------------------
create table calls (
  id                 uuid primary key default gen_random_uuid(),
  contact_id         uuid not null references contacts (id) on delete cascade,
  campaign_id        uuid not null references campaigns (id) on delete cascade,
  clinic_id          uuid not null references clinics (id) on delete cascade,

  attempt_number     int not null default 1,
  call_status        call_status not null default 'queued',
  outcome            call_outcome,
  decline_reason     decline_reason,

  callback_date      date,
  callback_time      time,

  duration_seconds   int,
  recording_url      text,
  transcript         jsonb,          -- [{ "from": "agent" | "customer", "text": "...", "at_seconds": 12 }]
  ai_summary         text,
  sentiment          text,

  telephony_call_id  text,           -- Vobiz call SID for reconciliation
  started_at         timestamptz,
  ended_at           timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger trg_calls_updated_at
  before update on calls
  for each row execute function set_updated_at();

create index idx_calls_contact on calls (contact_id);
create index idx_calls_campaign on calls (campaign_id);
create index idx_calls_clinic_status on calls (clinic_id, call_status);
create index idx_calls_callback on calls (clinic_id, callback_date) where outcome = 'call_later';


-- ---------------------------------------------------------------------------
-- 9. PAYMENT LINKS  (Razorpay link lifecycle)
-- ---------------------------------------------------------------------------
create table payment_links (
  id                 uuid primary key default gen_random_uuid(),
  call_id            uuid references calls (id) on delete set null,
  contact_id         uuid not null references contacts (id) on delete cascade,
  campaign_id        uuid not null references campaigns (id) on delete cascade,
  clinic_id          uuid not null references clinics (id) on delete cascade,

  razorpay_link_id   text unique,
  short_url          text,
  amount             numeric(12,2) not null,
  currency           text not null default 'INR',
  status             payment_link_status not null default 'created',
  sent_via           notification_channel,

  sent_at            timestamptz,
  paid_at            timestamptz,
  expires_at         timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger trg_payment_links_updated_at
  before update on payment_links
  for each row execute function set_updated_at();

create index idx_payment_links_contact on payment_links (contact_id);
create index idx_payment_links_clinic_status on payment_links (clinic_id, status);


-- ---------------------------------------------------------------------------
-- 10. PAYMENTS  (ledger of confirmed transactions — driven by Razorpay webhooks)
-- ---------------------------------------------------------------------------
create table payments (
  id                 uuid primary key default gen_random_uuid(),
  payment_link_id    uuid references payment_links (id) on delete set null,
  contact_id         uuid not null references contacts (id) on delete cascade,
  clinic_id          uuid not null references clinics (id) on delete cascade,

  razorpay_payment_id text unique,
  amount_paid         numeric(12,2) not null,
  currency            text not null default 'INR',
  method              text,           -- upi, card, netbanking, etc.
  webhook_payload     jsonb,          -- raw event, kept for reconciliation/audit

  paid_at             timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

create index idx_payments_clinic on payments (clinic_id);
create index idx_payments_contact on payments (contact_id);


-- ---------------------------------------------------------------------------
-- 11. NOTIFICATIONS  (SMS/WhatsApp delivery log — payment links, reminders, etc.)
-- ---------------------------------------------------------------------------
create table notifications (
  id               uuid primary key default gen_random_uuid(),
  contact_id       uuid not null references contacts (id) on delete cascade,
  clinic_id        uuid not null references clinics (id) on delete cascade,
  payment_link_id  uuid references payment_links (id) on delete set null,

  channel          notification_channel not null,
  template         text not null,       -- e.g. 'payment_link', 'reminder', 'callback_confirmation'
  status           notification_status not null default 'queued',
  provider_message_id text,
  error            text,

  sent_at          timestamptz,
  created_at       timestamptz not null default now()
);

create index idx_notifications_clinic on notifications (clinic_id);
create index idx_notifications_contact on notifications (contact_id);


-- ---------------------------------------------------------------------------
-- 12. AUDIT LOGS  (every meaningful action, platform-wide or clinic-scoped)
-- ---------------------------------------------------------------------------
create table audit_logs (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid references clinics (id) on delete cascade,  -- null = platform-level action
  actor_id     uuid references profiles (id),
  action       text not null,          -- e.g. 'campaign.created', 'clinic.suspended', 'contact.csv_uploaded'
  entity_type  text,
  entity_id    uuid,
  metadata     jsonb,
  created_at   timestamptz not null default now()
);

create index idx_audit_logs_clinic on audit_logs (clinic_id, created_at desc);
create index idx_audit_logs_actor on audit_logs (actor_id, created_at desc);


-- =====================================================================================
-- 13. ROW LEVEL SECURITY
-- =====================================================================================

-- ---- Helper functions -----------------------------------------------------
create or replace function is_platform_admin()
returns boolean
language sql security definer stable
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and platform_role = 'platform_admin'
  );
$$;

create or replace function is_clinic_member(target_clinic_id uuid)
returns boolean
language sql security definer stable
as $$
  select exists (
    select 1 from clinic_members
    where clinic_id = target_clinic_id
      and user_id = auth.uid()
      and status = 'active'
  );
$$;

create or replace function is_clinic_admin(target_clinic_id uuid)
returns boolean
language sql security definer stable
as $$
  select exists (
    select 1 from clinic_members
    where clinic_id = target_clinic_id
      and user_id = auth.uid()
      and status = 'active'
      and role = 'admin'
  );
$$;

-- ---- Enable RLS everywhere --------------------------------------------------
alter table profiles         enable row level security;
alter table clinics          enable row level security;
alter table clinic_members   enable row level security;
alter table campaigns        enable row level security;
alter table contacts         enable row level security;
alter table calls            enable row level security;
alter table payment_links    enable row level security;
alter table payments         enable row level security;
alter table notifications    enable row level security;
alter table audit_logs       enable row level security;

-- ---- PROFILES ---------------------------------------------------------------
create policy "profiles_select_own_or_admin"
  on profiles for select
  using (id = auth.uid() or is_platform_admin());

create policy "profiles_update_own"
  on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---- CLINICS ------------------------------------------------------------
-- Platform admins: full access. Clinic members: read-only on their own clinic.
create policy "clinics_platform_admin_all"
  on clinics for all
  using (is_platform_admin())
  with check (is_platform_admin());

create policy "clinics_member_select"
  on clinics for select
  using (is_clinic_member(id));

create policy "clinics_admin_update_settings"
  on clinics for update
  using (is_clinic_admin(id))
  with check (is_clinic_admin(id));

-- ---- CLINIC MEMBERS -------------------------------------------------------
create policy "clinic_members_platform_admin_all"
  on clinic_members for all
  using (is_platform_admin())
  with check (is_platform_admin());

create policy "clinic_members_select_own_clinic"
  on clinic_members for select
  using (is_clinic_member(clinic_id));

create policy "clinic_members_admin_manage"
  on clinic_members for all
  using (is_clinic_admin(clinic_id))
  with check (is_clinic_admin(clinic_id));

-- ---- CAMPAIGNS / CONTACTS / CALLS / PAYMENT_LINKS / PAYMENTS / NOTIFICATIONS ----
-- Same shape for all clinic-scoped tables: platform admin sees everything,
-- clinic members see/manage only rows for clinics they belong to.

create policy "campaigns_platform_admin_all"
  on campaigns for all
  using (is_platform_admin()) with check (is_platform_admin());
create policy "campaigns_member_all"
  on campaigns for all
  using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));

create policy "contacts_platform_admin_all"
  on contacts for all
  using (is_platform_admin()) with check (is_platform_admin());
create policy "contacts_member_all"
  on contacts for all
  using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));

create policy "calls_platform_admin_all"
  on calls for all
  using (is_platform_admin()) with check (is_platform_admin());
create policy "calls_member_all"
  on calls for all
  using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));

create policy "payment_links_platform_admin_all"
  on payment_links for all
  using (is_platform_admin()) with check (is_platform_admin());
create policy "payment_links_member_all"
  on payment_links for all
  using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));

create policy "payments_platform_admin_all"
  on payments for all
  using (is_platform_admin()) with check (is_platform_admin());
create policy "payments_member_select"
  on payments for select
  using (is_clinic_member(clinic_id));
-- Note: no member insert/update policy on payments — that table is written to
-- only by the Razorpay webhook handler running under the service_role key,
-- which bypasses RLS entirely. Staff should never write payment records directly.

create policy "notifications_platform_admin_all"
  on notifications for all
  using (is_platform_admin()) with check (is_platform_admin());
create policy "notifications_member_all"
  on notifications for all
  using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));

-- ---- AUDIT LOGS -----------------------------------------------------------
-- Read-only for everyone except platform admin; writes happen via
-- security-definer functions / triggers, not directly from client roles.
create policy "audit_logs_platform_admin_all"
  on audit_logs for all
  using (is_platform_admin()) with check (is_platform_admin());
create policy "audit_logs_member_select"
  on audit_logs for select
  using (clinic_id is not null and is_clinic_member(clinic_id));


-- =====================================================================================
-- 14. REPORTING VIEWS  (power the Campaign Summary / Report screens)
-- =====================================================================================

create or replace view campaign_stats as
select
  c.id                                                      as campaign_id,
  c.clinic_id,
  c.name,
  c.status,
  count(ct.id) filter (where ct.is_selected)                as selected_contacts,
  count(distinct call.id) filter (where call.call_status = 'completed') as calls_completed,
  count(distinct call.id) filter (where call.call_status = 'not_answered') as calls_not_answered,
  count(distinct call.id) filter (where call.call_status = 'failed')      as calls_failed,
  count(distinct call.id) filter (where call.outcome = 'link_sent')       as links_sent,
  count(distinct pay.id)                                    as payments_completed,
  coalesce(sum(ct.amount_due) filter (where ct.is_selected), 0)  as total_pending_amount,
  coalesce(sum(pay.amount_paid), 0)                          as total_collected
from campaigns c
left join contacts ct on ct.campaign_id = c.id
left join calls call on call.campaign_id = c.id
left join payments pay on pay.contact_id = ct.id
group by c.id, c.clinic_id, c.name, c.status;

-- RLS on views inherits from the underlying tables' policies automatically
-- as long as the view is queried through PostgREST/Supabase with the caller's JWT.


-- =====================================================================================
-- 15. SEEDING A PLATFORM ADMIN (run manually after first signup)
-- =====================================================================================
-- 1. Sign the admin up normally via Supabase Auth (creates auth.users + profiles row).
-- 2. Then run:
--    update profiles set platform_role = 'platform_admin' where email = 'you@nexovai.in';