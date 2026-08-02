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

  let body: { userId?: string }
  try { body = await req.json() } catch { return fail('Invalid JSON', 400) }

  const { userId } = body
  if (!userId) return fail('userId is required', 400)
  if (userId === user.id) return fail('You cannot remove yourself', 400)

  const admin = makeServiceClient()

  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) return fail(error.message, 400)

  return ok({ ok: true })
})
