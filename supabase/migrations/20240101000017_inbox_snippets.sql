-- Inbox slash-command snippets: canned replies + saved product cards.
-- Private by default; owners can share with the whole team or specific members.

create table public.inbox_snippets (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('reply', 'product')),
  title text not null,
  body text not null default '',
  image_url text,
  price text,
  product_url text,
  shopify_product_id bigint,
  shopify_variant_id bigint,
  sku text,
  variant_title text,
  shared boolean not null default false,
  shared_with uuid[] not null default array[]::uuid[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index inbox_snippets_owner_id_idx on public.inbox_snippets(owner_id);
create index inbox_snippets_kind_idx on public.inbox_snippets(kind);
create index inbox_snippets_shared_idx on public.inbox_snippets(shared) where shared = true;

create trigger inbox_snippets_updated_at
  before update on public.inbox_snippets
  for each row execute function public.update_updated_at();

alter table public.inbox_snippets enable row level security;

-- Sales can see teammates (needed to pick who to share with)
create policy "users: sales can read teammates"
  on public.users for select
  using (get_my_role() in ('admin', 'sales'));

create policy "inbox_snippets: read own, shared, or granted"
  on public.inbox_snippets for select
  using (
    get_my_role() in ('admin', 'sales')
    and (
      owner_id = auth.uid()
      or shared = true
      or auth.uid() = any(shared_with)
    )
  );

create policy "inbox_snippets: insert own"
  on public.inbox_snippets for insert
  with check (
    get_my_role() in ('admin', 'sales')
    and owner_id = auth.uid()
  );

create policy "inbox_snippets: update own"
  on public.inbox_snippets for update
  using (owner_id = auth.uid() and get_my_role() in ('admin', 'sales'))
  with check (owner_id = auth.uid());

create policy "inbox_snippets: delete own"
  on public.inbox_snippets for delete
  using (owner_id = auth.uid() and get_my_role() in ('admin', 'sales'));

create policy "inbox_snippets: admin can update any"
  on public.inbox_snippets for update
  using (get_my_role() = 'admin');

create policy "inbox_snippets: admin can delete any"
  on public.inbox_snippets for delete
  using (get_my_role() = 'admin');

grant select, insert, update, delete on table public.inbox_snippets to authenticated;
grant all on table public.inbox_snippets to service_role;

alter publication supabase_realtime add table public.inbox_snippets;
