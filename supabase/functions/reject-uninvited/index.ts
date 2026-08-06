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

/** Deletes the caller's auth account when they have no CRM profile (uninvited Google/email signup). */
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
  if (!user?.email) return fail('Unauthorized', 401)

  const admin = makeServiceClient()

  const { data: profile } = await admin.from('users').select('id').eq('id', user.id).maybeSingle()
  if (profile) return ok({ ok: true, invited: true })

  const email = user.email.toLowerCase()
  const { data: invited } = await admin.from('invited_emails').select('email').eq('email', email).maybeSingle()
  if (invited) {
    // Invited but profile missing (trigger race) — create it
    const { data: row } = await admin.from('invited_emails').select('role').eq('email', email).single()
    await admin.from('users').upsert({ id: user.id, email: user.email, role: row?.role ?? 'sales' })
    return ok({ ok: true, invited: true, repaired: true })
  }

  await admin.auth.admin.deleteUser(user.id)
  return ok({ ok: true, invited: false, rejected: true })
})
