-- Storage bucket for incoming WhatsApp media (images, audio, video, documents)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'whatsapp-media',
  'whatsapp-media',
  true,
  52428800,
  array['image/*', 'audio/*', 'video/*', 'application/pdf', 'application/octet-stream']
)
on conflict (id) do nothing;

-- Service role (used by Edge Function) can upload
create policy "whatsapp-media: service role upload"
  on storage.objects for insert
  with check (bucket_id = 'whatsapp-media');

-- Public read
create policy "whatsapp-media: public read"
  on storage.objects for select
  using (bucket_id = 'whatsapp-media');
