-- Invite-only access: only emails on this list get a public.users profile.
create table if not exists public.invited_emails (
  email text primary key,
  role text not null default 'sales' check (role in ('admin', 'sales')),
  invited_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.invited_emails enable row level security;

-- Admins can read the allowlist (optional UI later)
create policy "invited_emails: admin read"
  on public.invited_emails for select
  using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

-- Backfill everyone who already has a profile so they keep access
insert into public.invited_emails (email, role)
select lower(email), role
from public.users
where email is not null
on conflict (email) do nothing;

-- Only create a CRM profile when the email was invited
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

  insert into public.users (id, email, role)
  values (new.id, new.email, invited_role)
  on conflict (id) do nothing;

  return new;
end;
$$;
