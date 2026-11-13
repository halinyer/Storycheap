-- StoryCheap: Immutable sales snapshot (Bs rate + unit cost) and manual store settings.
-- Run after 0001_schema.sql, 0002_seed_catalog.sql and 0003_security_hardening.sql.

-- 1. Unit cost per product variant (admin-configured cost basis)
alter table public.product_variants
  add column if not exists unit_cost_cents integer
  check (unit_cost_cents is null or unit_cost_cents >= 0);

-- 2. Frozen unit cost snapshot on each sold order item
alter table public.order_items
  add column if not exists unit_cost_cents integer
  check (unit_cost_cents is null or unit_cost_cents >= 0);

-- 3. Frozen Bs/USD exchange rate and Bs total snapshot on each order
alter table public.orders
  add column if not exists bs_rate_cents integer
  check (bs_rate_cents is null or bs_rate_cents > 0);

alter table public.orders
  add column if not exists total_bs_cents integer
  check (total_bs_cents is null or total_bs_cents >= 0);

-- 4. Store settings (admin-managed manual Bs rate, etc.)
create table if not exists public.store_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

drop trigger if exists store_settings_updated_at on public.store_settings;
create trigger store_settings_updated_at
  before update on public.store_settings
  for each row execute function public.set_updated_at();

alter table public.store_settings enable row level security;

drop policy if exists "store_settings_admin_all" on public.store_settings;
create policy "store_settings_admin_all"
  on public.store_settings for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.store_settings from anon, authenticated;

insert into public.store_settings (key, value)
values ('bs_exchange_rate', '{"bsRateCents": null}'::jsonb)
on conflict (key) do nothing;
