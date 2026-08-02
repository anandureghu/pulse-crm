-- Per-customer AI autoreply flag
alter table public.customers add column if not exists ai_autoreply boolean default false;

-- AI config settings entry
insert into public.settings (key, value)
values ('ai_config', '{"apiKey":"","model":"gpt-4o-mini","systemPrompt":"","enabled":false}')
on conflict (key) do nothing;
