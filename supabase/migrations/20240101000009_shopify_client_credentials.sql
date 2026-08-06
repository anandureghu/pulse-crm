-- Prefer Dev Dashboard client credentials over legacy static access tokens
update public.settings
set value = jsonb_build_object(
  'shopDomain', coalesce(value->>'shopDomain', ''),
  'clientId', coalesce(value->>'clientId', ''),
  'clientSecret', coalesce(value->>'clientSecret', ''),
  'apiVersion', coalesce(value->>'apiVersion', '2024-10'),
  'accessToken', coalesce(value->>'accessToken', '')
),
updated_at = now()
where key = 'shopify_config';
