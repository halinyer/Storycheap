-- ============================================================================
-- Migration 0006: Treasury Movements (Caja Real) & Test Order Flagging
-- ============================================================================

-- 1. Mark initial / test orders without deleting historical traceability
alter table public.orders
  add column if not exists is_test boolean not null default false;

alter table public.orders
  add column if not exists test_note text;

create index if not exists idx_orders_is_test
  on public.orders(is_test, created_at desc);

-- 2. Immutable financial ledger (append-only, voidable with voided_at)
create table if not exists public.treasury_movements (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  movement_type text not null check (
    movement_type in (
      'CAPITAL_IN',
      'SUPPLIER_TOPUP',
      'INTERNAL_TRANSFER',
      'PROFIT_WITHDRAWAL',
      'EXPENSE_FEE',
      'RECONCILIATION_ADJUSTMENT'
    )
  ),
  source_account text not null,
  target_account text not null,
  amount_usd_cents integer not null check (amount_usd_cents >= 0),
  amount_bs_cents integer check (amount_bs_cents is null or amount_bs_cents >= 0),
  exchange_rate_cents integer check (exchange_rate_cents is null or exchange_rate_cents > 0),
  partner_name text,
  reference text,
  notes text not null default '',
  related_order_id uuid references public.orders(id) on delete set null,
  voided_at timestamptz,
  void_reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_treasury_movements_occurred
  on public.treasury_movements(occurred_at desc);

create index if not exists idx_treasury_movements_active
  on public.treasury_movements(movement_type, occurred_at desc)
  where voided_at is null;

alter table public.treasury_movements enable row level security;

drop policy if exists "treasury_movements_admin_all" on public.treasury_movements;
create policy "treasury_movements_admin_all"
  on public.treasury_movements for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.treasury_movements from anon, authenticated;
