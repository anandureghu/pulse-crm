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
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  )
  const { data: { user } } = await callerClient.auth.getUser()
  if (!user) return fail('Unauthorized', 401)

  let body: { email?: string; role?: string; organizationId?: string }
  try { body = await req.json() } catch { return fail('Invalid JSON', 400) }

  const { email, role = 'sales', organizationId } = body
  if (!email) return fail('email is required', 400)
  if (!organizationId) return fail('organizationId is required', 400)
  if (!['admin', 'sales'].includes(role)) return fail('role must be admin or sales', 400)

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

  const normalized = email.trim().toLowerCase()

  const { data: existingInvite } = await admin
    .from('invited_emails')
    .select('id')
    .eq('organization_id', organizationId)
    .ilike('email', normalized)
    .maybeSingle()

  if (existingInvite) {
    await admin.from('invited_emails').update({ role, invited_by: user.id }).eq('id', existingInvite.id)
  } else {
    const { error: allowError } = await admin.from('invited_emails').insert({
      email: normalized,
      role,
      invited_by: user.id,
      organization_id: organizationId,
    })
    if (allowError) return fail(allowError.message, 400)
  }

  const { data: existingUser } = await admin.from('users').select('id').ilike('email', normalized).maybeSingle()
  if (existingUser) {
    await admin.from('organization_members').upsert(
      {
        organization_id: organizationId,
        user_id: existingUser.id,
        role,
      },
      { onConflict: 'organization_id,user_id' },
    )
    return ok({ ok: true, userId: existingUser.id, existing: true })
  }

  const redirectTo = Deno.env.get('APP_URL') ?? 'https://pulse.picominds.com/set-password'

  const { data, error } = await admin.auth.admin.inviteUserByEmail(normalized, {
    redirectTo,
  })
  if (error) return fail(error.message, 400)

  await admin.from('users').update({ role }).eq('id', data.user.id)
  await admin.from('organization_members').upsert(
    {
      organization_id: organizationId,
      user_id: data.user.id,
      role,
    },
    { onConflict: 'organization_id,user_id' },
  )

  return ok({ ok: true, userId: data.user.id })
})
