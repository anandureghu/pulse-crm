-- Storage bucket for customer files
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'customer-files',
  'customer-files',
  true,
  52428800,  -- 50 MB
  array['image/*', 'video/*', 'audio/*', 'application/pdf', 'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain', 'application/zip']
)
on conflict (id) do nothing;

-- Storage RLS
create policy "customer-files: authenticated can upload"
  on storage.objects for insert
  with check (bucket_id = 'customer-files' and auth.uid() is not null);

create policy "customer-files: public read"
  on storage.objects for select
  using (bucket_id = 'customer-files');

create policy "customer-files: authenticated can delete"
  on storage.objects for delete
  using (bucket_id = 'customer-files' and auth.uid() is not null);
