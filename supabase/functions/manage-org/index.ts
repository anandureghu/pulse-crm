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

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'org'
}

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

  const admin = makeServiceClient()
  const { data: profile } = await admin
    .from('users')
    .select('is_platform_admin')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile?.is_platform_admin) return fail('Forbidden: platform admin required', 403)

  let body: {
    action?: string
    name?: string
    slug?: string
    adminEmail?: string
    organizationId?: string
    active?: boolean
  }
  try { body = await req.json() } catch { return fail('Invalid JSON', 400) }

  const action = body.action ?? 'list'

  if (action === 'list') {
    const { data: orgs, error } = await admin
      .from('organizations')
      .select('id, name, slug, active, created_at')
      .order('created_at', { ascending: false })
    if (error) return fail(error.message, 400)

    const enriched = []
    for (const org of orgs ?? []) {
      const [{ count: memberCount }, { count: instanceCount }, { data: instances }] = await Promise.all([
        admin.from('organization_members').select('id', { count: 'exact', head: true }).eq('organization_id', org.id),
        admin.from('instances').select('id', { count: 'exact', head: true }).eq('organization_id', org.id),
        admin.from('instances').select('id, name, evolution_instance_name, active').eq('organization_id', org.id).order('name'),
      ])
      enriched.push({
        ...org,
        memberCount: memberCount ?? 0,
        instanceCount: instanceCount ?? 0,
        instances: instances ?? [],
      })
    }
    return ok({ organizations: enriched })
  }

  if (action === 'create') {
    const name = (body.name ?? '').trim()
    const adminEmail = (body.adminEmail ?? '').trim().toLowerCase()
    if (!name) return fail('name is required', 400)
    if (!adminEmail) return fail('adminEmail is required', 400)

    let slug = (body.slug ?? slugify(name)).toLowerCase()
    const { data: slugClash } = await admin.from('organizations').select('id').eq('slug', slug).maybeSingle()
    if (slugClash) slug = `${slug}-${Date.now().toString(36)}`

    const { data: org, error: orgErr } = await admin
      .from('organizations')
      .insert({ name, slug, active: true })
      .select('*')
      .single()
    if (orgErr || !org) return fail(orgErr?.message ?? 'Failed to create org', 400)

    // Default empty instance so org can start configuring
    await admin.from('instances').insert({
      organization_id: org.id,
      name: 'default',
      evolution_instance_name: null,
      settings: { evolution: {}, ai_config: {}, shopify_config: {} },
      active: true,
    })

    await admin.from('invited_emails').insert({
      email: adminEmail,
      role: 'admin',
      organization_id: org.id,
      invited_by: user.id,
    })

    const { data: existingUser } = await admin.from('users').select('id').ilike('email', adminEmail).maybeSingle()
    let userId = existingUser?.id as string | undefined

    if (!userId) {
      const redirectTo = Deno.env.get('APP_URL') ?? 'https://pulse.picominds.com/set-password'
      const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(adminEmail, { redirectTo })
      if (invErr) return fail(invErr.message, 400)
      userId = invited.user.id
      await admin.from('users').update({ role: 'admin' }).eq('id', userId)
    }

    await admin.from('organization_members').upsert(
      { organization_id: org.id, user_id: userId!, role: 'admin' },
      { onConflict: 'organization_id,user_id' },
    )

    return ok({ ok: true, organization: org, adminUserId: userId })
  }

  if (action === 'set_active') {
    if (!body.organizationId) return fail('organizationId required', 400)
    const { error } = await admin
      .from('organizations')
      .update({ active: Boolean(body.active), updated_at: new Date().toISOString() })
      .eq('id', body.organizationId)
    if (error) return fail(error.message, 400)
    return ok({ ok: true })
  }

  return fail('Unknown action', 400)
})
