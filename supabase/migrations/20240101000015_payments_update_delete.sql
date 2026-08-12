-- Allow sales/admin to update and delete payments (full CRUD)
create policy "payments: sales can update"
  on public.payments for update
  using (get_my_role() in ('admin', 'sales'));

drop policy if exists "payments: admin can delete" on public.payments;

create policy "payments: sales can delete"
  on public.payments for delete
  using (get_my_role() in ('admin', 'sales'));
