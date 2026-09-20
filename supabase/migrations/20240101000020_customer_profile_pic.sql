-- Add profile picture URL to customers (fetched from WhatsApp via Evolution API)
alter table public.customers
  add column if not exists profile_pic_url text;
