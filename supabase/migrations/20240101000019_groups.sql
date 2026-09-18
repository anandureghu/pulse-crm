-- WhatsApp group support
-- Adds is_group flag to customers (groups are stored as a special customer type)
-- Adds sender_name to messages (to track which group member sent each message)

alter table public.customers
  add column if not exists is_group boolean not null default false;

alter table public.messages
  add column if not exists sender_name text;

create index if not exists customers_org_group_idx
  on public.customers (organization_id, is_group);
