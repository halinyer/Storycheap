-- StoryCheap Database Schema, Security Policies, Atomic Reservation & Ledger Primitives
-- Run in Supabase SQL Editor or via Supabase CLI migrations.

create extension if not exists "pgcrypto";

-- ============================================================================
-- HELPER FUNCTIONS FOR RLS & INTEGRITY
-- ============================================================================

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

create or replace function public.prevent_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Table % is append-only; % operations are forbidden', tg_table_name, tg_op;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- 1. PROFILES
-- ============================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own_or_admin"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid() and role = 'customer');

-- Auto-create profile row when a Supabase Auth user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_app_meta_data ->> 'role', 'customer')
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- 2. CATALOG: PRODUCTS & VARIANTS
-- ============================================================================

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  brand text not null,
  category text not null check (category in ('gaming', 'streaming', 'shopping', 'crypto')),
  region text not null,
  region_warning text,
  description text not null,
  redemption_steps jsonb not null default '[]'::jsonb,
  terms text not null default '',
  image_url text not null,
  accent_color text not null default '#0070d1',
  gradient text not null default 'from-slate-800 to-slate-950',
  active boolean not null default true,
  is_popular boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

alter table public.products enable row level security;

create policy "products_public_read_active"
  on public.products for select
  to anon, authenticated
  using (active = true or public.is_admin());

create policy "products_admin_write"
  on public.products for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  denomination_label text not null,
  face_value_cents integer not null check (face_value_cents > 0),
  sale_price_cents integer not null check (sale_price_cents > 0),
  currency text not null default 'USD',
  source_priority text not null default 'manual_only'
    check (source_priority in ('manual_only', 'manual_then_reloadly', 'reloadly_only')),
  reloadly_product_id integer,
  low_stock_threshold integer not null default 3 check (low_stock_threshold >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_variants_product_active
  on public.product_variants(product_id, active);

create trigger product_variants_updated_at
  before update on public.product_variants
  for each row execute function public.set_updated_at();

alter table public.product_variants enable row level security;

create policy "variants_public_read_active"
  on public.product_variants for select
  to anon, authenticated
  using (active = true or public.is_admin());

create policy "variants_admin_write"
  on public.product_variants for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- 3. CODE INVENTORY (SERVER-ONLY VAULT — ZERO CLIENT ACCESS)
-- ============================================================================

create table if not exists public.code_inventory (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  code_ciphertext text not null,
  pin_ciphertext text,
  code_hash text unique not null,
  code_last4 text not null,
  batch_id text,
  expires_at timestamptz,
  status text not null default 'AVAILABLE'
    check (status in ('AVAILABLE', 'RESERVED', 'DELIVERED', 'VOID')),
  reserved_order_id uuid,
  reserved_until timestamptz,
  delivered_order_id uuid,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index if not exists idx_code_inventory_claim
  on public.code_inventory(variant_id, status, created_at)
  where status = 'AVAILABLE';

create index if not exists idx_code_inventory_reserved_expiry
  on public.code_inventory(reserved_until)
  where status = 'RESERVED';

alter table public.code_inventory enable row level security;
-- Intentionally NO RLS policies for anon or authenticated: only service_role may access code_inventory.

-- Safe aggregate view for storefront stock checks (never exposes ciphertexts or hashes)
create or replace view public.variant_available_stock as
select
  v.id as variant_id,
  count(c.id)::integer as manual_available_count
from public.product_variants v
left join public.code_inventory c
  on c.variant_id = v.id
  and c.status = 'AVAILABLE'
  and (c.expires_at is null or c.expires_at > now())
group by v.id;

-- ============================================================================
-- 4. ORDERS & ORDER ITEMS
-- ============================================================================

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique not null,
  user_id uuid references auth.users(id),
  email text not null,
  status text not null default 'CREATED' check (
    status in (
      'CREATED',
      'PENDING_PAYMENT',
      'PAID',
      'FULFILLING',
      'DELIVERED',
      'PARTIAL',
      'MANUAL_REVIEW',
      'EXPIRED',
      'CANCELLED',
      'REFUNDED_CREDIT'
    )
  ),
  subtotal_cents integer not null check (subtotal_cents >= 0),
  credit_applied_cents integer not null default 0 check (credit_applied_cents >= 0),
  amount_due_cents integer not null check (amount_due_cents >= 0),
  paid_cents integer not null default 0 check (paid_cents >= 0),
  payment_gateway text not null default 'zenobank',
  gateway_checkout_id text,
  gateway_checkout_url text,
  expires_at timestamptz,
  needs_attention boolean not null default false,
  attention_reason text,
  ip_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_orders_user_created
  on public.orders(user_id, created_at desc);

create index if not exists idx_orders_status_created
  on public.orders(status, created_at desc);

create index if not exists idx_orders_gateway_checkout
  on public.orders(gateway_checkout_id)
  where gateway_checkout_id is not null;

create trigger orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

alter table public.orders enable row level security;

create policy "orders_select_own_or_admin"
  on public.orders for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Writes happen through service_role API routes / Server Actions only.

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id),
  product_name text not null,
  product_slug text not null,
  denomination_label text not null,
  region text not null,
  unit_price_cents integer not null check (unit_price_cents > 0),
  quantity integer not null check (quantity > 0),
  delivered_count integer not null default 0 check (delivered_count >= 0),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'RESERVED', 'FULFILLED', 'MANUAL_REVIEW', 'REFUNDED_CREDIT')),
  created_at timestamptz not null default now()
);

create index if not exists idx_order_items_order
  on public.order_items(order_id);

alter table public.order_items enable row level security;

create policy "order_items_select_own_or_admin"
  on public.order_items for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
      and (o.user_id = auth.uid() or public.is_admin())
    )
  );

-- ============================================================================
-- 5. FULFILLMENTS (REVEAL AUDIT & ENCRYPTED DELIVERY RECORDS)
-- ============================================================================

create table if not exists public.fulfillments (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid references auth.users(id),
  source text not null check (source in ('manual', 'reloadly')),
  code_inventory_id uuid references public.code_inventory(id),
  code_ciphertext text not null,
  code_last4 text not null,
  pin_ciphertext text,
  supplier_tx_id text,
  attempts integer not null default 1 check (attempts >= 1),
  revealed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_fulfillments_order
  on public.fulfillments(order_id);

create index if not exists idx_fulfillments_user
  on public.fulfillments(user_id, created_at desc);

alter table public.fulfillments enable row level security;
-- Customers only reveal plaintexts through audited POST /api/orders/[id]/reveal.
-- Admins cannot read code_ciphertext via client JWT; admin views receive code_last4 only.

-- ============================================================================
-- 6. CREDIT LEDGER (APPEND-ONLY STORE CREDIT FOR UNDER/OVERPAYMENTS & REFUNDS)
-- ============================================================================

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid references public.orders(id),
  delta_cents integer not null check (delta_cents <> 0),
  reason text not null check (
    reason in ('overpayment', 'partial_payment', 'fulfillment_refund', 'checkout_apply', 'admin_adjust')
  ),
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_credit_ledger_user_created
  on public.credit_ledger(user_id, created_at desc);

create trigger credit_ledger_append_only
  before update or delete on public.credit_ledger
  for each row execute function public.prevent_mutation();

create or replace function public.enforce_non_negative_credit_balance()
returns trigger
language plpgsql
as $$
declare
  v_current integer;
begin
  perform pg_advisory_xact_lock(hashtext(new.user_id::text));
  select coalesce(sum(delta_cents), 0) into v_current
  from public.credit_ledger
  where user_id = new.user_id;

  if (v_current + new.delta_cents) < 0 then
    raise exception 'Insufficient store credit balance for user % (current %, delta %)',
      new.user_id, v_current, new.delta_cents;
  end if;

  return new;
end;
$$;

create trigger credit_ledger_non_negative
  before insert on public.credit_ledger
  for each row execute function public.enforce_non_negative_credit_balance();

alter table public.credit_ledger enable row level security;

create policy "credit_ledger_select_own_or_admin"
  on public.credit_ledger for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ============================================================================
-- 7. WEBHOOK EVENTS (IDEMPOTENCY & REPLAY LOG)
-- ============================================================================

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  gateway text not null,
  event_id text not null,
  event_type text not null,
  order_id uuid references public.orders(id),
  gateway_checkout_id text,
  signature_valid boolean not null,
  payload jsonb not null,
  processed_at timestamptz not null default now(),
  status text not null default 'processed' check (status in ('processed', 'ignored', 'failed')),
  error_message text,
  unique (gateway, event_id)
);

create index if not exists idx_webhook_events_processed
  on public.webhook_events(processed_at desc);

alter table public.webhook_events enable row level security;

create policy "webhook_events_admin_read"
  on public.webhook_events for select
  to authenticated
  using (public.is_admin());

-- ============================================================================
-- 8. PROVIDER CONFIGS & KILL SWITCHES
-- ============================================================================

create table if not exists public.provider_configs (
  id text primary key,
  enabled boolean not null default true,
  sandbox_mode boolean not null default true,
  min_balance_alert_cents integer not null default 10000,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.provider_configs enable row level security;

create policy "provider_configs_admin_all"
  on public.provider_configs for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

insert into public.provider_configs (id, enabled, sandbox_mode, min_balance_alert_cents, config)
values
  ('global_checkout', true, false, 0, '{"label": "Checkout Global"}'),
  ('zenobank', true, true, 0, '{"label": "ZenoBank Crypto Gateway"}'),
  ('manual_inventory', true, false, 3, '{"label": "Inventario Propio (CSV)"}'),
  ('reloadly', false, true, 10000, '{"label": "Reloadly API (Solo cuentas KYC verificadas)"}'),
  ('pablito', false, true, 0, '{"label": "Pablito Pago Móvil (Próximamente)"}')
on conflict (id) do nothing;

-- ============================================================================
-- 9. AUDIT LOG (APPEND-ONLY)
-- ============================================================================

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  actor_role text not null,
  action text not null,
  target_type text not null,
  target_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_log_created
  on public.audit_log(created_at desc);

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function public.prevent_mutation();

alter table public.audit_log enable row level security;

create policy "audit_log_admin_read"
  on public.audit_log for select
  to authenticated
  using (public.is_admin());

-- ============================================================================
-- 10. ATOMIC RPC PRIMITIVES (INVENTORY RESERVATION & STATE MACHINE)
-- ============================================================================

-- Atomically reserves `p_qty` AVAILABLE non-expired codes for an order.
-- If fewer than `p_qty` codes exist, raises exception so the transaction rolls back all-or-nothing.
create or replace function public.reserve_manual_codes(
  p_variant_id uuid,
  p_order_id uuid,
  p_qty integer,
  p_hold_minutes integer default 20
)
returns table(
  id uuid,
  code_ciphertext text,
  pin_ciphertext text,
  code_last4 text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reserved_count integer;
begin
  if p_qty <= 0 then
    raise exception 'Quantity must be positive';
  end if;

  return query
  with picked as (
    select c.id
    from public.code_inventory c
    where c.variant_id = p_variant_id
      and c.status = 'AVAILABLE'
      and (c.expires_at is null or c.expires_at > now())
    order by c.created_at asc
    limit p_qty
    for update skip locked
  ),
  updated as (
    update public.code_inventory ci
    set
      status = 'RESERVED',
      reserved_order_id = p_order_id,
      reserved_until = now() + make_interval(mins => p_hold_minutes)
    from picked
    where ci.id = picked.id
    returning ci.id, ci.code_ciphertext, ci.pin_ciphertext, ci.code_last4
  )
  select u.id, u.code_ciphertext, u.pin_ciphertext, u.code_last4 from updated u;

  get diagnostics v_reserved_count = row_count;
  if v_reserved_count < p_qty then
    raise exception 'INSUFFICIENT_MANUAL_STOCK: requested %, available %', p_qty, v_reserved_count;
  end if;
end;
$$;

-- Converts RESERVED inventory belonging to an order into DELIVERED after payment confirms.
create or replace function public.commit_reserved_codes_for_order(p_order_id uuid)
returns table(
  id uuid,
  variant_id uuid,
  code_ciphertext text,
  pin_ciphertext text,
  code_last4 text
)
language sql
security definer
set search_path = public
as $$
  update public.code_inventory
  set
    status = 'DELIVERED',
    delivered_order_id = p_order_id,
    delivered_at = now(),
    reserved_until = null
  where reserved_order_id = p_order_id
    and status = 'RESERVED'
  returning id, variant_id, code_ciphertext, pin_ciphertext, code_last4;
$$;

-- Releases expired inventory reservations and marks expired PENDING_PAYMENT orders.
create or replace function public.release_expired_reservations()
returns table(
  released_codes integer,
  expired_orders integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codes integer := 0;
  v_orders integer := 0;
begin
  update public.code_inventory
  set
    status = 'AVAILABLE',
    reserved_order_id = null,
    reserved_until = null
  where status = 'RESERVED'
    and reserved_until < now();
  get diagnostics v_codes = row_count;

  update public.orders
  set status = 'EXPIRED'
  where status = 'PENDING_PAYMENT'
    and expires_at is not null
    and expires_at < now();
  get diagnostics v_orders = row_count;

  released_codes := v_codes;
  expired_orders := v_orders;
  return next;
end;
$$;

-- Optimistic state transition for orders to eliminate webhook/cron race conditions.
create or replace function public.transition_order_status(
  p_order_id uuid,
  p_expected_statuses text[],
  p_next_status text,
  p_paid_cents integer default null,
  p_needs_attention boolean default null,
  p_attention_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.orders
  set
    status = p_next_status,
    paid_cents = coalesce(p_paid_cents, paid_cents),
    needs_attention = coalesce(p_needs_attention, needs_attention),
    attention_reason = coalesce(p_attention_reason, attention_reason)
  where id = p_order_id
    and status = any(p_expected_statuses);

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;
