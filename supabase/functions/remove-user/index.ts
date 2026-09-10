import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { makeServiceClient } from '../_shared/supabase.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
}

const ok = (data: unknown) =>
  new Response(JSON.stringify(data), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } })

const fail = (message: string, status = 400) =>
  new Response(JSON.stringify({ error: message }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return fail('Method Not Allowed', 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return fail('Unauthorized', 401)

  const callerClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }
  )
  const { data: { user } } = await callerClient.auth.getUser()
  if (!user) return fail('Unauthorized', 401)

  let body: { userId?: string; organizationId?: string }
  try { body = await req.json() } catch { return fail('Invalid JSON', 400) }

  const { userId, organizationId } = body
  if (!userId) return fail('userId is required', 400)
  if (!organizationId) return fail('organizationId is required', 400)
  if (userId === user.id) return fail('You cannot remove yourself', 400)

  const admin = makeServiceClient()

  const { data: membership } = await admin
    .from('organization_members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .maybeSingle()
  const { data: profile } = await admin.from('users').select('is_platform_admin').eq('id', user.id).maybeSingle()
  if (membership?.role !== 'admin' && !profile?.is_platform_admin) {
    return fail('Forbidden: org admin role required', 403)
  }

  const { data: target } = await admin.from('users').select('email').eq('id', userId).maybeSingle()

  // Remove from this org only (keep auth user if they belong elsewhere)
  await admin
    .from('organization_members')
    .delete()
    .eq('organization_id', organizationId)
    .eq('user_id', userId)

  if (target?.email) {
    await admin
      .from('invited_emails')
      .delete()
      .eq('organization_id', organizationId)
      .ilike('email', target.email.toLowerCase())
  }

  const { count } = await admin
    .from('organization_members')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (!count) {
    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) return fail(error.message, 400)
  }

  return ok({ ok: true })
})
