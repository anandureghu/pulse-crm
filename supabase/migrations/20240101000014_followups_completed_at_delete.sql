-- Track when a follow-up was completed (for Completed tab history)
alter table public.followups
  add column if not exists completed_at timestamptz;

create index if not exists idx_followups_completed_at
  on public.followups(completed_at desc nulls last);

-- Allow sales/admin to delete follow-ups
create policy "followups: sales can delete"
  on public.followups for delete
  using (get_my_role() in ('admin', 'sales'));
