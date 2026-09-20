-- Org-only data scoping
-- Removes instance_id from all CRM data tables:
-- 1. Drops NOT NULL constraints first (required before nulling values)
-- 2. Backfills instance_id to null on all existing rows
-- 3. Replaces (instance_id, *) unique indexes with (organization_id, *) ones
-- 4. Drops (instance_id, *) composite indexes, adds org-only ones
-- 5. Rewrites RLS insert policies that checked instance_belongs_to_org

-- ── 1. Drop NOT NULL on instance_id (must happen before backfill) ─────────────

alter table public.customers      alter column instance_id drop not null;
alter table public.conversations  alter column instance_id drop not null;
alter table public.messages       alter column instance_id drop not null;
alter table public.enquiries      alter column instance_id drop not null;
alter table public.notes          alter column instance_id drop not null;
alter table public.activities     alter column instance_id drop not null;
alter table public.followups      alter column instance_id drop not null;
alter table public.customer_files alter column instance_id drop not null;
alter table public.call_logs      alter column instance_id drop not null;
alter table public.payments       alter column instance_id drop not null;
alter table public.shopify_orders alter column instance_id drop not null;

-- ── 2. Backfill: clear instance_id on all CRM data ───────────────────────────

update public.customers      set instance_id = null;
update public.conversations  set instance_id = null;
update public.messages       set instance_id = null;
update public.enquiries      set instance_id = null;
update public.notes          set instance_id = null;
update public.activities     set instance_id = null;
update public.followups      set instance_id = null;
update public.customer_files set instance_id = null;
update public.call_logs      set instance_id = null;
update public.payments       set instance_id = null;
update public.shopify_orders set instance_id = null;

-- ── 3. Deduplicate customers per (organization_id, phone) ────────────────────
-- Previous unique constraint was per instance, so the same phone could exist
-- multiple times across instances in the same org. Pick the winner (most
-- recently updated, preferring a real name over a raw phone number), re-point
-- all FK references, then delete the losers.

do $$
declare
  dup record;
  winner_id uuid;
  loser_ids uuid[];
begin
  for dup in
    select organization_id, phone
    from public.customers
    group by organization_id, phone
    having count(*) > 1
  loop
    -- Winner: prefer named contact, then most recently updated
    select id into winner_id
    from public.customers
    where organization_id = dup.organization_id and phone = dup.phone
    order by
      case when name <> phone then 0 else 1 end,
      updated_at desc nulls last
    limit 1;

    select array_agg(id) into loser_ids
    from public.customers
    where organization_id = dup.organization_id and phone = dup.phone
      and id <> winner_id;

    -- Re-point foreign keys to winner
    update public.conversations  set customer_id = winner_id where customer_id = any(loser_ids);
    update public.enquiries      set customer_id = winner_id where customer_id = any(loser_ids);
    update public.customer_files set customer_id = winner_id where customer_id = any(loser_ids);
    update public.call_logs      set customer_id = winner_id where customer_id = any(loser_ids);
    update public.payments       set customer_id = winner_id where customer_id = any(loser_ids);

    -- Delete duplicate customer rows
    delete from public.customers where id = any(loser_ids);
  end loop;
end $$;

-- ── 4. Replace instance-scoped unique indexes with org-scoped ones ────────────

drop index if exists public.customers_instance_phone_uidx;
create unique index if not exists customers_org_phone_uidx
  on public.customers (organization_id, phone);

-- Deduplicate conversations per (organization_id, customer_id) before indexing
do $$
declare
  dup record;
  winner_id uuid;
  loser_ids uuid[];
begin
  for dup in
    select organization_id, customer_id
    from public.conversations
    group by organization_id, customer_id
    having count(*) > 1
  loop
    -- Winner: most recently updated (most recent message activity)
    select id into winner_id
    from public.conversations
    where organization_id = dup.organization_id and customer_id = dup.customer_id
    order by updated_at desc nulls last
    limit 1;

    select array_agg(id) into loser_ids
    from public.conversations
    where organization_id = dup.organization_id and customer_id = dup.customer_id
      and id <> winner_id;

    -- Re-point messages to the winning conversation
    update public.messages set conversation_id = winner_id where conversation_id = any(loser_ids);

    -- Delete duplicate conversations
    delete from public.conversations where id = any(loser_ids);
  end loop;
end $$;

drop index if exists public.conversations_instance_customer_uidx;
create unique index if not exists conversations_org_customer_uidx
  on public.conversations (organization_id, customer_id);

drop index if exists public.shopify_orders_instance_shopify_order_id_uidx;
create unique index if not exists shopify_orders_org_shopify_order_id_uidx
  on public.shopify_orders (organization_id, shopify_order_id)
  where shopify_order_id is not null;

-- ── 5. Drop instance-composite performance indexes, add org-only ones ─────────

drop index if exists public.customers_org_instance_idx;
drop index if exists public.conversations_org_instance_idx;
drop index if exists public.messages_org_instance_idx;
drop index if exists public.enquiries_org_instance_idx;

create index if not exists customers_org_idx     on public.customers     (organization_id);
create index if not exists conversations_org_idx on public.conversations (organization_id);
create index if not exists messages_org_idx      on public.messages      (organization_id);
create index if not exists enquiries_org_idx     on public.enquiries     (organization_id);

-- ── 6. Rewrite RLS insert policies (remove instance_belongs_to_org check) ────

drop policy if exists "customers: org member insert" on public.customers;
create policy "customers: org member insert"
  on public.customers for insert
  with check (public.is_org_member(organization_id));

drop policy if exists "enquiries: org member insert" on public.enquiries;
create policy "enquiries: org member insert"
  on public.enquiries for insert
  with check (public.is_org_member(organization_id));

drop policy if exists "conversations: org member insert" on public.conversations;
create policy "conversations: org member insert"
  on public.conversations for insert
  with check (public.is_org_member(organization_id));

drop policy if exists "messages: org member insert" on public.messages;
create policy "messages: org member insert"
  on public.messages for insert
  with check (public.is_org_member(organization_id));

drop policy if exists "notes: org member insert" on public.notes;
create policy "notes: org member insert"
  on public.notes for insert
  with check (public.is_org_member(organization_id));

drop policy if exists "activities: org member insert" on public.activities;
create policy "activities: org member insert"
  on public.activities for insert
  with check (public.is_org_member(organization_id));

drop policy if exists "followups: org member insert" on public.followups;
create policy "followups: org member insert"
  on public.followups for insert
  with check (public.is_org_member(organization_id));

drop policy if exists "customer_files: org member insert" on public.customer_files;
create policy "customer_files: org member insert"
  on public.customer_files for insert
  with check (public.is_org_member(organization_id));

drop policy if exists "call_logs: org member insert" on public.call_logs;
create policy "call_logs: org member insert"
  on public.call_logs for insert
  with check (public.is_org_member(organization_id));

drop policy if exists "payments: org member insert" on public.payments;
create policy "payments: org member insert"
  on public.payments for insert
  with check (public.is_org_member(organization_id));

drop policy if exists "shopify_orders: org member insert" on public.shopify_orders;
create policy "shopify_orders: org member insert"
  on public.shopify_orders for insert
  with check (public.is_org_member(organization_id));
