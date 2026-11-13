-- StoryCheap security hardening (run after 0001 and 0002).
-- Supabase exposes every function in `public` as an RPC endpoint and grants EXECUTE
-- to anon/authenticated by default. The functions below are SECURITY DEFINER primitives
-- that must ONLY be callable by the server (service_role). Without this, any visitor
-- could mark orders as PAID, drain stock or read ciphertexts through /rest/v1/rpc/*.

-- 1. Server-only RPC primitives
revoke all on function public.reserve_manual_codes(uuid, uuid, integer, integer)
  from public, anon, authenticated;
revoke all on function public.commit_reserved_codes_for_order(uuid)
  from public, anon, authenticated;
revoke all on function public.release_expired_reservations()
  from public, anon, authenticated;
revoke all on function public.transition_order_status(uuid, text[], text, integer, boolean, text)
  from public, anon, authenticated;

grant execute on function public.reserve_manual_codes(uuid, uuid, integer, integer) to service_role;
grant execute on function public.commit_reserved_codes_for_order(uuid) to service_role;
grant execute on function public.release_expired_reservations() to service_role;
grant execute on function public.transition_order_status(uuid, text[], text, integer, boolean, text) to service_role;

-- 2. Trigger-only functions never need to be callable as RPC
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.prevent_mutation() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.enforce_non_negative_credit_balance() from public, anon, authenticated;

-- 3. Future functions in public are private by default
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- 4. Stock counts are server-side only (storefront reads them through the API, not PostgREST)
revoke all on public.variant_available_stock from anon, authenticated;

-- 5. Anonymous visitors may only read the active catalog (RLS also enforces this)
revoke all on all tables in schema public from anon;
grant select on public.products, public.product_variants to anon;
