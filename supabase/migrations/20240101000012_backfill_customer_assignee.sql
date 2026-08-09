-- Backfill customers.assigned_to from the latest enquiry that has an assignee.
-- Historical assigns often updated enquiries only.
update public.customers c
set assigned_to = e.assigned_to
from (
  select distinct on (customer_id)
    customer_id,
    assigned_to
  from public.enquiries
  where assigned_to is not null
    and btrim(assigned_to) <> ''
  order by customer_id, created_at desc
) e
where c.id = e.customer_id
  and (c.assigned_to is null or btrim(c.assigned_to) = '');
