-- Multi-device push subscriptions (one row per browser/device per user)
create table public.user_push_subscriptions (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid not null references public.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz default now(),
  constraint user_push_subscriptions_endpoint_key unique (endpoint)
);

create index user_push_subscriptions_user_id_idx on public.user_push_subscriptions (user_id);
create index user_push_subscriptions_org_id_idx  on public.user_push_subscriptions (organization_id);

-- Per-user notification type preferences (default everything OFF)
alter table public.users
  add column if not exists notification_preferences jsonb not null
  default '{"inbox_messages":false,"order_won":false,"followup_reminders":false}'::jsonb;

-- RLS: users can only read/write their own subscriptions
alter table public.user_push_subscriptions enable row level security;

create policy "user_push_subscriptions_select_own"
  on public.user_push_subscriptions for select
  using (user_id = auth.uid());

create policy "user_push_subscriptions_insert_own"
  on public.user_push_subscriptions for insert
  with check (user_id = auth.uid());

create policy "user_push_subscriptions_delete_own"
  on public.user_push_subscriptions for delete
  using (user_id = auth.uid());
