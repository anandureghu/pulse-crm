-- Treat shopify_orders as a mirror of Shopify only (not a local create audit log).
-- Wipe existing rows (failed creates, prompt audit copies, etc.).
delete from public.shopify_orders;

-- Unique Shopify order id so sync can upsert cleanly
create unique index if not exists shopify_orders_shopify_order_id_uidx
  on public.shopify_orders (shopify_order_id)
  where shopify_order_id is not null;

create index if not exists shopify_orders_shopify_order_id_idx
  on public.shopify_orders (shopify_order_id)
  where shopify_order_id is not null;

-- Allow CRM users to update/delete mirrored rows (edge functions also use service role)
drop policy if exists "shopify_orders: sales can update" on public.shopify_orders;
create policy "shopify_orders: sales can update"
  on public.shopify_orders for update
  using (get_my_role() in ('admin', 'sales'))
  with check (get_my_role() in ('admin', 'sales'));

drop policy if exists "shopify_orders: sales can delete" on public.shopify_orders;
create policy "shopify_orders: sales can delete"
  on public.shopify_orders for delete
  using (get_my_role() in ('admin', 'sales'));
