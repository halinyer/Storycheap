-- ============================================================================
-- Migration 0007: Support Tickets & Customer Helpdesk Inbox
-- ============================================================================

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique,
  user_id uuid references auth.users(id) on delete set null,
  customer_name text not null,
  customer_email text not null,
  order_number text,
  topic text not null check (
    topic in ('ORDER_ISSUE', 'PAYMENT', 'CODE_REDEEM', 'GENERAL')
  ),
  subject text not null,
  message text not null,
  status text not null default 'OPEN' check (
    status in ('OPEN', 'IN_PROGRESS', 'RESOLVED')
  ),
  admin_reply text,
  replied_at timestamptz,
  replied_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_support_tickets_status_created
  on public.support_tickets(status, created_at desc);

create index if not exists idx_support_tickets_user_created
  on public.support_tickets(user_id, created_at desc);

alter table public.support_tickets enable row level security;

drop policy if exists "support_tickets_admin_all" on public.support_tickets;
create policy "support_tickets_admin_all"
  on public.support_tickets for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "support_tickets_owner_select" on public.support_tickets;
create policy "support_tickets_owner_select"
  on public.support_tickets for select
  to authenticated
  using (auth.uid() = user_id);

revoke all on public.support_tickets from anon, authenticated;
grant select on public.support_tickets to authenticated;
