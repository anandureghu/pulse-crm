-- Team usernames (default from email local-part)
alter table public.users
  add column if not exists username text;

update public.users
set username = split_part(email, '@', 1)
where username is null or username = '';

-- Optional Shopify linkage + email on CRM customers
alter table public.customers
  add column if not exists email text;

alter table public.customers
  add column if not exists shopify_customer_id text;

create index if not exists customers_shopify_customer_id_idx
  on public.customers (shopify_customer_id)
  where shopify_customer_id is not null;

-- Show customer name on order history / synced orders
alter table public.shopify_orders
  add column if not exists customer_name text;

-- Keep profile create invite-only and seed username
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invited_role text;
begin
  select role into invited_role
  from public.invited_emails
  where email = lower(new.email);

  if invited_role is null then
    return new;
  end if;

  insert into public.users (id, email, role, username)
  values (
    new.id,
    new.email,
    invited_role,
    split_part(new.email, '@', 1)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
