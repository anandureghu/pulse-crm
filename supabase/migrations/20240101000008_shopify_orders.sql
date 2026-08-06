-- Shopify config + product price cache (settings key-value)
insert into public.settings (key, value)
values
  ('shopify_config', '{"shopDomain":"","accessToken":"","apiVersion":"2024-10"}'),
  ('shopify_products', '{"byPrice":{},"syncedAt":null,"rawCount":0}')
on conflict (key) do nothing;

-- CRM audit log of orders created via Order Area
create table if not exists public.shopify_orders (
  id uuid primary key default gen_random_uuid(),
  shopify_order_id text,
  shopify_order_name text,
  shopify_customer_id text,
  phone text,
  email text,
  amount numeric,
  variant_id text,
  tags text[] default '{}',
  prompt text,
  parsed_dto jsonb,
  status text not null default 'created' check (status in ('created', 'failed')),
  error text,
  created_by uuid references public.users (id),
  created_at timestamptz default now()
);

create index if not exists shopify_orders_created_at_idx
  on public.shopify_orders (created_at desc);

alter table public.shopify_orders enable row level security;

create policy "shopify_orders: sales can read"
  on public.shopify_orders for select
  using (get_my_role() in ('admin', 'sales'));

create policy "shopify_orders: sales can insert"
  on public.shopify_orders for insert
  with check (get_my_role() in ('admin', 'sales'));
