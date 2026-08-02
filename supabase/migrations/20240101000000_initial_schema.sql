-- Users profile (extends auth.users)
create table public.users (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  role text not null default 'sales' check (role in ('admin', 'sales')),
  push_subscription jsonb,
  created_at timestamptz default now()
);

-- Customers
create table public.customers (
  id uuid default gen_random_uuid() primary key,
  phone text unique not null,
  name text not null,
  assigned_to text,
  tags text[] default array[]::text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enquiries
create table public.enquiries (
  id uuid default gen_random_uuid() primary key,
  customer_id uuid references public.customers(id) on delete cascade not null,
  status text not null default 'new_lead',
  stage text not null default 'new_lead',
  assigned_to text,
  value numeric default 0,
  created_at timestamptz default now()
);

-- Conversations (one per customer)
create table public.conversations (
  id uuid default gen_random_uuid() primary key,
  customer_id uuid references public.customers(id) on delete cascade unique not null,
  last_message text default '',
  unread_count integer default 0,
  updated_at timestamptz default now()
);

-- Messages (id = Evolution message ID)
create table public.messages (
  id text primary key,
  conversation_id uuid references public.conversations(id) on delete cascade not null,
  sender text not null check (sender in ('customer', 'agent')),
  type text not null default 'text' check (type in ('text', 'image', 'audio', 'video', 'document')),
  text text default '',
  media text,
  status text default 'sent' check (status in ('sent', 'delivered', 'read')),
  timestamp timestamptz default now()
);

-- Notes
create table public.notes (
  id uuid default gen_random_uuid() primary key,
  enquiry_id uuid references public.enquiries(id) on delete cascade not null,
  author text not null,
  content text not null,
  created_at timestamptz default now()
);

-- Activities
create table public.activities (
  id uuid default gen_random_uuid() primary key,
  enquiry_id uuid references public.enquiries(id) on delete cascade not null,
  type text not null,
  description text not null,
  created_by text not null,
  created_at timestamptz default now()
);

-- Follow-ups
create table public.followups (
  id uuid default gen_random_uuid() primary key,
  enquiry_id uuid references public.enquiries(id) on delete cascade not null,
  due_date timestamptz not null,
  completed boolean default false,
  note text default '',
  assigned_to text not null,
  created_at timestamptz default now()
);

-- Settings (key-value)
create table public.settings (
  key text primary key,
  value jsonb not null default '{}',
  updated_at timestamptz default now()
);

-- Customer files
create table public.customer_files (
  id uuid default gen_random_uuid() primary key,
  customer_id uuid references public.customers(id) on delete cascade not null,
  name text not null,
  url text not null,
  size bigint default 0,
  uploaded_by text not null,
  created_at timestamptz default now()
);

-- Call logs
create table public.call_logs (
  id uuid default gen_random_uuid() primary key,
  customer_id uuid references public.customers(id) on delete cascade not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  duration integer default 0,
  outcome text check (outcome in ('answered', 'no_answer', 'voicemail', 'callback_requested')),
  notes text default '',
  logged_by text not null,
  created_at timestamptz default now()
);

-- Payments
create table public.payments (
  id uuid default gen_random_uuid() primary key,
  customer_id uuid references public.customers(id) on delete cascade not null,
  amount numeric not null,
  currency text default 'INR',
  method text check (method in ('bank_transfer', 'cash', 'card', 'cheque')),
  status text check (status in ('received', 'pending', 'refunded')),
  reference text default '',
  notes text default '',
  recorded_by text not null,
  created_at timestamptz default now()
);

-- Auto-create user profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
as $$
begin
  insert into public.users (id, email, role)
  values (new.id, new.email, 'sales')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Auto-update updated_at on customers
create or replace function public.update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger customers_updated_at
  before update on public.customers
  for each row execute function public.update_updated_at();

create trigger conversations_updated_at
  before update on public.conversations
  for each row execute function public.update_updated_at();

-- Seed default evolution settings row (empty)
insert into public.settings (key, value)
values ('evolution', '{"apiUrl":"","activeInstance":"","apiKey":"","webhookUrl":"","displayNames":{}}')
on conflict (key) do nothing;
