-- Enable RLS on all tables
alter table public.users enable row level security;
alter table public.customers enable row level security;
alter table public.enquiries enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.notes enable row level security;
alter table public.activities enable row level security;
alter table public.followups enable row level security;
alter table public.settings enable row level security;
alter table public.customer_files enable row level security;
alter table public.call_logs enable row level security;
alter table public.payments enable row level security;

-- Helper: get current user's role (cached per transaction)
create or replace function public.get_my_role()
returns text
language sql stable security definer
as $$
  select role from public.users where id = auth.uid()
$$;

-- ── users ─────────────────────────────────────────────────────────────────────

create policy "users: read own or admin reads all"
  on public.users for select
  using (id = auth.uid() or get_my_role() = 'admin');

create policy "users: insert own on signup"
  on public.users for insert
  with check (id = auth.uid());

create policy "users: update own"
  on public.users for update
  using (id = auth.uid());

create policy "users: admin can update any"
  on public.users for update
  using (get_my_role() = 'admin');

-- ── customers ─────────────────────────────────────────────────────────────────

create policy "customers: sales can read"
  on public.customers for select
  using (get_my_role() in ('admin', 'sales'));

create policy "customers: sales can insert"
  on public.customers for insert
  with check (get_my_role() in ('admin', 'sales'));

create policy "customers: sales can update"
  on public.customers for update
  using (get_my_role() in ('admin', 'sales'));

-- ── enquiries ─────────────────────────────────────────────────────────────────

create policy "enquiries: sales can read"
  on public.enquiries for select
  using (get_my_role() in ('admin', 'sales'));

create policy "enquiries: sales can insert"
  on public.enquiries for insert
  with check (get_my_role() in ('admin', 'sales'));

create policy "enquiries: sales can update"
  on public.enquiries for update
  using (get_my_role() in ('admin', 'sales'));

-- ── conversations ─────────────────────────────────────────────────────────────

create policy "conversations: sales can read"
  on public.conversations for select
  using (get_my_role() in ('admin', 'sales'));

create policy "conversations: sales can insert"
  on public.conversations for insert
  with check (get_my_role() in ('admin', 'sales'));

create policy "conversations: sales can update"
  on public.conversations for update
  using (get_my_role() in ('admin', 'sales'));

-- ── messages ──────────────────────────────────────────────────────────────────

create policy "messages: sales can read"
  on public.messages for select
  using (get_my_role() in ('admin', 'sales'));

create policy "messages: sales can insert"
  on public.messages for insert
  with check (get_my_role() in ('admin', 'sales'));

create policy "messages: sales can update"
  on public.messages for update
  using (get_my_role() in ('admin', 'sales'));

-- ── notes ─────────────────────────────────────────────────────────────────────

create policy "notes: sales can read"
  on public.notes for select
  using (get_my_role() in ('admin', 'sales'));

create policy "notes: sales can insert"
  on public.notes for insert
  with check (get_my_role() in ('admin', 'sales'));

create policy "notes: sales can delete"
  on public.notes for delete
  using (get_my_role() in ('admin', 'sales'));

-- ── activities ────────────────────────────────────────────────────────────────

create policy "activities: sales can read"
  on public.activities for select
  using (get_my_role() in ('admin', 'sales'));

create policy "activities: sales can insert"
  on public.activities for insert
  with check (get_my_role() in ('admin', 'sales'));

-- ── followups ─────────────────────────────────────────────────────────────────

create policy "followups: sales can read"
  on public.followups for select
  using (get_my_role() in ('admin', 'sales'));

create policy "followups: sales can insert"
  on public.followups for insert
  with check (get_my_role() in ('admin', 'sales'));

create policy "followups: sales can update"
  on public.followups for update
  using (get_my_role() in ('admin', 'sales'));

-- ── settings ──────────────────────────────────────────────────────────────────

create policy "settings: authenticated can read"
  on public.settings for select
  using (auth.uid() is not null);

create policy "settings: authenticated can upsert"
  on public.settings for insert
  with check (auth.uid() is not null);

create policy "settings: authenticated can update"
  on public.settings for update
  using (auth.uid() is not null);

-- ── customer_files ────────────────────────────────────────────────────────────

create policy "customer_files: sales can read"
  on public.customer_files for select
  using (get_my_role() in ('admin', 'sales'));

create policy "customer_files: sales can insert"
  on public.customer_files for insert
  with check (get_my_role() in ('admin', 'sales'));

-- ── call_logs ─────────────────────────────────────────────────────────────────

create policy "call_logs: sales can read"
  on public.call_logs for select
  using (get_my_role() in ('admin', 'sales'));

create policy "call_logs: sales can insert"
  on public.call_logs for insert
  with check (get_my_role() in ('admin', 'sales'));

-- ── payments ──────────────────────────────────────────────────────────────────

create policy "payments: sales can read"
  on public.payments for select
  using (get_my_role() in ('admin', 'sales'));

create policy "payments: sales can insert"
  on public.payments for insert
  with check (get_my_role() in ('admin', 'sales'));

create policy "payments: admin can delete"
  on public.payments for delete
  using (get_my_role() = 'admin');

-- ── Service-role bypass (for Edge Functions using service_role key) ───────────
-- Service role key bypasses RLS by default in Supabase — no extra policies needed.
