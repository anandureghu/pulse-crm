-- Org + Instance multi-tenancy
-- Creates organizations, memberships, instances; scopes all CRM data; backfills
-- existing single-tenant rows into one Default org / instance.

-- ── New tables ───────────────────────────────────────────────────────────────

create table public.organizations (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  slug text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  id uuid default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'sales' check (role in ('admin', 'sales')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table public.instances (
  id uuid default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  evolution_instance_name text unique,
  settings jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index instances_organization_id_idx on public.instances (organization_id);
create index organization_members_user_id_idx on public.organization_members (user_id);

-- ── Users: platform admin + last-used prefs ──────────────────────────────────

alter table public.users
  add column if not exists is_platform_admin boolean not null default false,
  add column if not exists last_organization_id uuid references public.organizations(id) on delete set null,
  add column if not exists last_instance_id uuid references public.instances(id) on delete set null;

-- ── Invited emails: org-scoped (same email may join multiple orgs) ────────────

alter table public.invited_emails
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

-- Drop email PK so we can use (email, organization_id)
alter table public.invited_emails drop constraint if exists invited_emails_pkey;
alter table public.invited_emails add column if not exists id uuid default gen_random_uuid();
update public.invited_emails set id = gen_random_uuid() where id is null;
alter table public.invited_emails alter column id set not null;
alter table public.invited_emails add primary key (id);

-- ── Tenant columns on CRM tables (nullable until backfill) ───────────────────

alter table public.customers
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists instance_id uuid references public.instances(id);

alter table public.conversations
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists instance_id uuid references public.instances(id);

alter table public.messages
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists instance_id uuid references public.instances(id);

alter table public.enquiries
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists instance_id uuid references public.instances(id);

alter table public.notes
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists instance_id uuid references public.instances(id);

alter table public.activities
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists instance_id uuid references public.instances(id);

alter table public.followups
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists instance_id uuid references public.instances(id);

alter table public.customer_files
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists instance_id uuid references public.instances(id);

alter table public.call_logs
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists instance_id uuid references public.instances(id);

alter table public.payments
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists instance_id uuid references public.instances(id);

alter table public.shopify_orders
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists instance_id uuid references public.instances(id);

-- ── Backfill: one Default org + one instance from current settings ───────────

do $$
declare
  v_org_id uuid;
  v_inst_id uuid;
  v_evo jsonb;
  v_ai jsonb;
  v_shop jsonb;
  v_inst_name text;
  v_settings jsonb;
begin
  insert into public.organizations (name, slug, active)
  values ('Default', 'default', true)
  returning id into v_org_id;

  select value into v_evo from public.settings where key = 'evolution';
  select value into v_ai from public.settings where key = 'ai_config';
  select value into v_shop from public.settings where key = 'shopify_config';

  v_inst_name := coalesce(
    nullif(trim(v_evo->>'activeInstance'), ''),
    nullif(trim(v_evo->>'instanceName'), ''),
    'default'
  );

  v_settings := jsonb_build_object(
    'evolution', coalesce(v_evo, '{}'::jsonb),
    'ai_config', coalesce(v_ai, '{}'::jsonb),
    'shopify_config', coalesce(v_shop, '{}'::jsonb)
  );

  insert into public.instances (organization_id, name, evolution_instance_name, settings, active)
  values (v_org_id, v_inst_name, v_inst_name, v_settings, true)
  returning id into v_inst_id;

  -- All existing users become members of Default (preserve role)
  insert into public.organization_members (organization_id, user_id, role)
  select v_org_id, u.id, u.role
  from public.users u
  on conflict (organization_id, user_id) do nothing;

  -- Attach existing invites to Default
  update public.invited_emails
  set organization_id = v_org_id
  where organization_id is null;

  -- Stamp CRM rows
  update public.customers set organization_id = v_org_id, instance_id = v_inst_id where organization_id is null;
  update public.conversations set organization_id = v_org_id, instance_id = v_inst_id where organization_id is null;
  update public.messages set organization_id = v_org_id, instance_id = v_inst_id where organization_id is null;
  update public.enquiries set organization_id = v_org_id, instance_id = v_inst_id where organization_id is null;
  update public.notes set organization_id = v_org_id, instance_id = v_inst_id where organization_id is null;
  update public.activities set organization_id = v_org_id, instance_id = v_inst_id where organization_id is null;
  update public.followups set organization_id = v_org_id, instance_id = v_inst_id where organization_id is null;
  update public.customer_files set organization_id = v_org_id, instance_id = v_inst_id where organization_id is null;
  update public.call_logs set organization_id = v_org_id, instance_id = v_inst_id where organization_id is null;
  update public.payments set organization_id = v_org_id, instance_id = v_inst_id where organization_id is null;
  update public.shopify_orders set organization_id = v_org_id, instance_id = v_inst_id where organization_id is null;

  -- Last-used prefs for everyone
  update public.users
  set last_organization_id = v_org_id, last_instance_id = v_inst_id;

  -- First existing admin becomes platform admin (documented default for single-tenant migrate)
  update public.users
  set is_platform_admin = true
  where id = (
    select id from public.users where role = 'admin' order by created_at asc nulls last limit 1
  );
end $$;

-- Require org on invites going forward
alter table public.invited_emails alter column organization_id set not null;
create unique index if not exists invited_emails_email_org_uidx
  on public.invited_emails (lower(email), organization_id);

-- ── Enforce NOT NULL + uniqueness ─────────────────────────────────────────────

alter table public.customers alter column organization_id set not null;
alter table public.customers alter column instance_id set not null;
alter table public.conversations alter column organization_id set not null;
alter table public.conversations alter column instance_id set not null;
alter table public.messages alter column organization_id set not null;
alter table public.messages alter column instance_id set not null;
alter table public.enquiries alter column organization_id set not null;
alter table public.enquiries alter column instance_id set not null;
alter table public.notes alter column organization_id set not null;
alter table public.notes alter column instance_id set not null;
alter table public.activities alter column organization_id set not null;
alter table public.activities alter column instance_id set not null;
alter table public.followups alter column organization_id set not null;
alter table public.followups alter column instance_id set not null;
alter table public.customer_files alter column organization_id set not null;
alter table public.customer_files alter column instance_id set not null;
alter table public.call_logs alter column organization_id set not null;
alter table public.call_logs alter column instance_id set not null;
alter table public.payments alter column organization_id set not null;
alter table public.payments alter column instance_id set not null;
alter table public.shopify_orders alter column organization_id set not null;
alter table public.shopify_orders alter column instance_id set not null;

-- Phone unique per instance (not globally)
alter table public.customers drop constraint if exists customers_phone_key;
create unique index if not exists customers_instance_phone_uidx
  on public.customers (instance_id, phone);

-- Conversation unique per instance + customer
alter table public.conversations drop constraint if exists conversations_customer_id_key;
create unique index if not exists conversations_instance_customer_uidx
  on public.conversations (instance_id, customer_id);

-- Shopify order id unique per instance
drop index if exists shopify_orders_shopify_order_id_uidx;
create unique index if not exists shopify_orders_instance_shopify_order_id_uidx
  on public.shopify_orders (instance_id, shopify_order_id)
  where shopify_order_id is not null;

create index if not exists customers_org_instance_idx on public.customers (organization_id, instance_id);
create index if not exists conversations_org_instance_idx on public.conversations (organization_id, instance_id);
create index if not exists messages_org_instance_idx on public.messages (organization_id, instance_id);
create index if not exists enquiries_org_instance_idx on public.enquiries (organization_id, instance_id);

-- ── Helper functions ─────────────────────────────────────────────────────────

create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select is_platform_admin from public.users where id = auth.uid()),
    false
  );
$$;

create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = p_org_id and user_id = auth.uid()
  );
$$;

create or replace function public.get_my_org_role(p_org_id uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select role from public.organization_members
  where organization_id = p_org_id and user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_org_admin(p_org_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.get_my_org_role(p_org_id) = 'admin' or public.is_platform_admin();
$$;

create or replace function public.instance_belongs_to_org(p_instance_id uuid, p_org_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.instances
    where id = p_instance_id and organization_id = p_org_id
  );
$$;

-- Signup: create profile + membership for each org invite matching email
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  first_role text;
begin
  select role into first_role
  from public.invited_emails
  where lower(email) = lower(new.email)
  order by created_at asc
  limit 1;

  if first_role is null then
    return new;
  end if;

  insert into public.users (id, email, role)
  values (new.id, new.email, first_role)
  on conflict (id) do nothing;

  for inv in
    select organization_id, role
    from public.invited_emails
    where lower(email) = lower(new.email)
  loop
    insert into public.organization_members (organization_id, user_id, role)
    values (inv.organization_id, new.id, inv.role)
    on conflict (organization_id, user_id) do nothing;
  end loop;

  return new;
end;
$$;

-- ── RLS enable ───────────────────────────────────────────────────────────────

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.instances enable row level security;

-- ── Drop old CRM policies (role-global) and recreate org-scoped ──────────────

drop policy if exists "customers: sales can read" on public.customers;
drop policy if exists "customers: sales can insert" on public.customers;
drop policy if exists "customers: sales can update" on public.customers;

drop policy if exists "enquiries: sales can read" on public.enquiries;
drop policy if exists "enquiries: sales can insert" on public.enquiries;
drop policy if exists "enquiries: sales can update" on public.enquiries;

drop policy if exists "conversations: sales can read" on public.conversations;
drop policy if exists "conversations: sales can insert" on public.conversations;
drop policy if exists "conversations: sales can update" on public.conversations;

drop policy if exists "messages: sales can read" on public.messages;
drop policy if exists "messages: sales can insert" on public.messages;
drop policy if exists "messages: sales can update" on public.messages;

drop policy if exists "notes: sales can read" on public.notes;
drop policy if exists "notes: sales can insert" on public.notes;
drop policy if exists "notes: sales can delete" on public.notes;

drop policy if exists "activities: sales can read" on public.activities;
drop policy if exists "activities: sales can insert" on public.activities;

drop policy if exists "followups: sales can read" on public.followups;
drop policy if exists "followups: sales can insert" on public.followups;
drop policy if exists "followups: sales can update" on public.followups;
drop policy if exists "followups: sales can delete" on public.followups;

drop policy if exists "customer_files: sales can read" on public.customer_files;
drop policy if exists "customer_files: sales can insert" on public.customer_files;

drop policy if exists "call_logs: sales can read" on public.call_logs;
drop policy if exists "call_logs: sales can insert" on public.call_logs;

drop policy if exists "payments: sales can read" on public.payments;
drop policy if exists "payments: sales can insert" on public.payments;
drop policy if exists "payments: sales can update" on public.payments;
drop policy if exists "payments: sales can delete" on public.payments;
drop policy if exists "payments: admin can delete" on public.payments;

drop policy if exists "shopify_orders: sales can read" on public.shopify_orders;
drop policy if exists "shopify_orders: sales can insert" on public.shopify_orders;
drop policy if exists "shopify_orders: sales can update" on public.shopify_orders;
drop policy if exists "shopify_orders: sales can delete" on public.shopify_orders;

drop policy if exists "invited_emails: admin read" on public.invited_emails;

-- organizations
create policy "organizations: members read"
  on public.organizations for select
  using (public.is_org_member(id) or public.is_platform_admin());

create policy "organizations: platform admin insert"
  on public.organizations for insert
  with check (public.is_platform_admin());

create policy "organizations: platform admin update"
  on public.organizations for update
  using (public.is_platform_admin());

-- organization_members
create policy "organization_members: members read own org"
  on public.organization_members for select
  using (public.is_org_member(organization_id) or public.is_platform_admin());

create policy "organization_members: org admin insert"
  on public.organization_members for insert
  with check (public.is_org_admin(organization_id));

create policy "organization_members: org admin update"
  on public.organization_members for update
  using (public.is_org_admin(organization_id));

create policy "organization_members: org admin delete"
  on public.organization_members for delete
  using (public.is_org_admin(organization_id));

-- instances
create policy "instances: members read"
  on public.instances for select
  using (public.is_org_member(organization_id) or public.is_platform_admin());

create policy "instances: org admin insert"
  on public.instances for insert
  with check (public.is_org_admin(organization_id));

create policy "instances: org admin update"
  on public.instances for update
  using (public.is_org_admin(organization_id));

create policy "instances: org admin delete"
  on public.instances for delete
  using (public.is_org_admin(organization_id));

-- invited_emails
create policy "invited_emails: org admin read"
  on public.invited_emails for select
  using (public.is_org_admin(organization_id));

create policy "invited_emails: org admin insert"
  on public.invited_emails for insert
  with check (public.is_org_admin(organization_id));

create policy "invited_emails: org admin delete"
  on public.invited_emails for delete
  using (public.is_org_admin(organization_id));

create policy "invited_emails: org admin update"
  on public.invited_emails for update
  using (public.is_org_admin(organization_id));

-- Generic CRM policies
create policy "customers: org member read"
  on public.customers for select using (public.is_org_member(organization_id));
create policy "customers: org member insert"
  on public.customers for insert
  with check (
    public.is_org_member(organization_id)
    and public.instance_belongs_to_org(instance_id, organization_id)
  );
create policy "customers: org member update"
  on public.customers for update
  using (public.is_org_member(organization_id));

create policy "enquiries: org member read"
  on public.enquiries for select using (public.is_org_member(organization_id));
create policy "enquiries: org member insert"
  on public.enquiries for insert
  with check (
    public.is_org_member(organization_id)
    and public.instance_belongs_to_org(instance_id, organization_id)
  );
create policy "enquiries: org member update"
  on public.enquiries for update using (public.is_org_member(organization_id));

create policy "conversations: org member read"
  on public.conversations for select using (public.is_org_member(organization_id));
create policy "conversations: org member insert"
  on public.conversations for insert
  with check (
    public.is_org_member(organization_id)
    and public.instance_belongs_to_org(instance_id, organization_id)
  );
create policy "conversations: org member update"
  on public.conversations for update using (public.is_org_member(organization_id));

create policy "messages: org member read"
  on public.messages for select using (public.is_org_member(organization_id));
create policy "messages: org member insert"
  on public.messages for insert
  with check (
    public.is_org_member(organization_id)
    and public.instance_belongs_to_org(instance_id, organization_id)
  );
create policy "messages: org member update"
  on public.messages for update using (public.is_org_member(organization_id));
create policy "messages: org member delete"
  on public.messages for delete using (public.is_org_member(organization_id));

create policy "notes: org member read"
  on public.notes for select using (public.is_org_member(organization_id));
create policy "notes: org member insert"
  on public.notes for insert
  with check (
    public.is_org_member(organization_id)
    and public.instance_belongs_to_org(instance_id, organization_id)
  );
create policy "notes: org member delete"
  on public.notes for delete using (public.is_org_member(organization_id));

create policy "activities: org member read"
  on public.activities for select using (public.is_org_member(organization_id));
create policy "activities: org member insert"
  on public.activities for insert
  with check (
    public.is_org_member(organization_id)
    and public.instance_belongs_to_org(instance_id, organization_id)
  );

create policy "followups: org member read"
  on public.followups for select using (public.is_org_member(organization_id));
create policy "followups: org member insert"
  on public.followups for insert
  with check (
    public.is_org_member(organization_id)
    and public.instance_belongs_to_org(instance_id, organization_id)
  );
create policy "followups: org member update"
  on public.followups for update using (public.is_org_member(organization_id));
create policy "followups: org member delete"
  on public.followups for delete using (public.is_org_member(organization_id));

create policy "customer_files: org member read"
  on public.customer_files for select using (public.is_org_member(organization_id));
create policy "customer_files: org member insert"
  on public.customer_files for insert
  with check (
    public.is_org_member(organization_id)
    and public.instance_belongs_to_org(instance_id, organization_id)
  );

create policy "call_logs: org member read"
  on public.call_logs for select using (public.is_org_member(organization_id));
create policy "call_logs: org member insert"
  on public.call_logs for insert
  with check (
    public.is_org_member(organization_id)
    and public.instance_belongs_to_org(instance_id, organization_id)
  );

create policy "payments: org member read"
  on public.payments for select using (public.is_org_member(organization_id));
create policy "payments: org member insert"
  on public.payments for insert
  with check (
    public.is_org_member(organization_id)
    and public.instance_belongs_to_org(instance_id, organization_id)
  );
create policy "payments: org member update"
  on public.payments for update using (public.is_org_member(organization_id));
create policy "payments: org member delete"
  on public.payments for delete using (public.is_org_member(organization_id));

create policy "shopify_orders: org member read"
  on public.shopify_orders for select using (public.is_org_member(organization_id));
create policy "shopify_orders: org member insert"
  on public.shopify_orders for insert
  with check (
    public.is_org_member(organization_id)
    and public.instance_belongs_to_org(instance_id, organization_id)
  );
create policy "shopify_orders: org member update"
  on public.shopify_orders for update using (public.is_org_member(organization_id));
create policy "shopify_orders: org member delete"
  on public.shopify_orders for delete using (public.is_org_member(organization_id));

-- users: allow reading org-mates (for Team / assignees)
drop policy if exists "users: read own or admin reads all" on public.users;
create policy "users: read own or org mates or platform admin"
  on public.users for select
  using (
    id = auth.uid()
    or public.is_platform_admin()
    or exists (
      select 1 from public.organization_members om1
      join public.organization_members om2
        on om1.organization_id = om2.organization_id
      where om1.user_id = auth.uid() and om2.user_id = users.id
    )
  );

-- Allow users to update their own last_* prefs
-- (existing "users: update own" already covers this)
