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

  const { data: profile } = await callerClient.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return fail('Forbidden: admin role required', 403)

  let body: { email?: string; role?: string }
  try { body = await req.json() } catch { return fail('Invalid JSON', 400) }

  const { email, role = 'sales' } = body
  if (!email) return fail('email is required', 400)
  if (!['admin', 'sales'].includes(role)) return fail('role must be admin or sales', 400)

  const admin = makeServiceClient()

  const { data: existing } = await admin.from('users').select('id').eq('email', email).maybeSingle()
  if (existing) return fail('A user with this email already exists', 409)

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email)
  if (error) return fail(error.message, 400)

  await admin.from('users').update({ role }).eq('id', data.user.id)

  return ok({ ok: true, userId: data.user.id })
})
