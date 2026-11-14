-- StoryCheap: Own Pago Movil Verifier Bot (StoryPay) Schema
-- Run after 0001_schema.sql, 0002_seed_catalog.sql, 0003_security_hardening.sql and 0004_sales_snapshot_and_bs_rate.sql.

-- 1. Authorized sensor devices (Android Push/SMS bridge or Email Apps Script)
create table if not exists public.bot_devices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  device_identifier text unique not null,
  channel_type text not null default 'ANDROID_PUSH'
    check (channel_type in ('ANDROID_PUSH', 'ANDROID_SMS', 'EMAIL_SCRIPT')),
  secret_ciphertext text not null,
  allow_plain_bearer boolean not null default false,
  last_heartbeat_at timestamptz,
  battery_level integer check (battery_level is null or (battery_level >= 0 and battery_level <= 100)),
  network_type text,
  app_version text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists bot_devices_updated_at on public.bot_devices;
create trigger bot_devices_updated_at
  before update on public.bot_devices
  for each row execute function public.set_updated_at();

alter table public.bot_devices enable row level security;

drop policy if exists "bot_devices_admin_all" on public.bot_devices;
create policy "bot_devices_admin_all"
  on public.bot_devices for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.bot_devices from anon;

-- 2. Destination receiver accounts displayed in Pago Movil checkout
create table if not exists public.receiver_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  bank_code text not null,
  bank_name text not null,
  account_type text not null default 'natural'
    check (account_type in ('natural', 'juridical')),
  phone text not null,
  dni text not null,
  holder_name text not null,
  allowed_packages jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists receiver_bank_accounts_updated_at on public.receiver_bank_accounts;
create trigger receiver_bank_accounts_updated_at
  before update on public.receiver_bank_accounts
  for each row execute function public.set_updated_at();

alter table public.receiver_bank_accounts enable row level security;

drop policy if exists "receiver_bank_accounts_admin_all" on public.receiver_bank_accounts;
create policy "receiver_bank_accounts_admin_all"
  on public.receiver_bank_accounts for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.receiver_bank_accounts from anon;

-- 3. Immutable incoming notification ledger (strictly server-only / admin readable)
create table if not exists public.bank_payment_notifications (
  id uuid primary key default gen_random_uuid(),
  device_id uuid references public.bot_devices(id) on delete set null,
  receiver_account_id uuid references public.receiver_bank_accounts(id) on delete set null,
  source_type text not null check (source_type in ('APP_PUSH', 'SMS', 'EMAIL', 'MANUAL')),
  app_package text,
  raw_content_hash text unique not null,
  raw_content_preview text not null default '',
  amount_bs_cents bigint,
  currency text not null default 'VES' check (currency in ('VES', 'USD', 'USDT')),
  reference_full text,
  reference_last6 text,
  reference_last4 text,
  sender_phone text,
  sender_dni text,
  sender_bank_code text,
  parser_used text,
  posted_at timestamptz not null default now(),
  status text not null default 'UNMATCHED'
    check (status in ('UNMATCHED', 'MATCHED', 'DUPLICATE', 'IGNORED', 'UNPARSED')),
  matched_order_id uuid unique references public.orders(id) on delete set null,
  matched_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_bank_notif_unmatched_lookup
  on public.bank_payment_notifications(status, amount_bs_cents, reference_last4, posted_at desc)
  where status = 'UNMATCHED';

create unique index if not exists idx_bank_notif_unique_matched_ref
  on public.bank_payment_notifications(receiver_account_id, reference_full, amount_bs_cents)
  where reference_full is not null and status = 'MATCHED';

alter table public.bank_payment_notifications enable row level security;

drop policy if exists "bank_payment_notifications_admin_read" on public.bank_payment_notifications;
create policy "bank_payment_notifications_admin_read"
  on public.bank_payment_notifications for select
  to authenticated
  using (public.is_admin());

revoke all on public.bank_payment_notifications from anon;

-- 4. Report fields on orders
alter table public.orders
  add column if not exists amount_due_bs_cents bigint
  check (amount_due_bs_cents is null or amount_due_bs_cents >= 0);

alter table public.orders
  add column if not exists reported_reference text;

alter table public.orders
  add column if not exists reported_sender_phone text;

alter table public.orders
  add column if not exists reported_sender_bank text;

alter table public.orders
  add column if not exists reported_at timestamptz;

-- 5. Enable clean gateway key 'pagomovil' in provider_configs
insert into public.provider_configs (id, enabled, sandbox_mode, min_balance_alert_cents, config)
values (
  'pagomovil',
  false,
  false,
  0,
  '{"label": "Pago Móvil Venezuela (Bot Propio)"}'::jsonb
)
on conflict (id) do nothing;
