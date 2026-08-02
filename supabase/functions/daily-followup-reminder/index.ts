import { makeServiceClient, json } from '../_shared/supabase.ts'

// Triggered daily at 08:00 via pg_cron or an external scheduler.
// Deploy: supabase functions deploy daily-followup-reminder
// Cron: select cron.schedule('daily-followup-reminder', '0 8 * * *',
//   $$select net.http_post(url:='<FUNCTION_URL>', headers:='{"Authorization":"Bearer <SERVICE_KEY>"}',
//   body:='{}')$$);
Deno.serve(async (_req) => {
  const supabase = makeServiceClient()

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const { data: followups } = await supabase
    .from('followups')
    .select('assigned_to, note')
    .eq('completed', false)
    .gte('due_date', today.toISOString())
    .lt('due_date', tomorrow.toISOString())

  if (!followups?.length) return json({ sent: 0 })

  const byAssignee: Record<string, number> = {}
  for (const f of followups) {
    if (f.assigned_to) byAssignee[f.assigned_to] = (byAssignee[f.assigned_to] ?? 0) + 1
  }

  const vapidKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'

  if (!vapidKey || !vapidPublic) return json({ sent: 0, reason: 'no_vapid' })

  let sent = 0
  for (const [email, count] of Object.entries(byAssignee)) {
    const { data: user } = await supabase
      .from('users')
      .select('push_subscription')
      .eq('email', email)
      .maybeSingle()

    if (!user?.push_subscription) continue

    try {
      await sendWebPush(
        user.push_subscription as { endpoint: string; keys: { p256dh: string; auth: string } },
        {
          title: `You have ${count} follow-up${count > 1 ? 's' : ''} today`,
          body: 'Tap to view your follow-ups in WhatsApp CRM',
        },
        vapidPublic, vapidKey, vapidSubject
      )
      sent++
    } catch (e) {
      console.warn('Push failed for', email, e)
    }
  }

  return json({ sent })
})

async function sendWebPush(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: { title: string; body: string },
  vapidPublicKey: string,
  vapidPrivateKey: string,
  vapidSubject: string
) {
  const { endpoint } = subscription
  const origin = new URL(endpoint).origin
  const header = { alg: 'ES256', typ: 'JWT' }
  const claims = { aud: origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: vapidSubject }

  const toBase64Url = (buf: ArrayBuffer) =>
    btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

  const enc = new TextEncoder()
  const headerB64 = toBase64Url(enc.encode(JSON.stringify(header)))
  const claimsB64 = toBase64Url(enc.encode(JSON.stringify(claims)))
  const signingInput = `${headerB64}.${claimsB64}`

  const rawKey = Uint8Array.from(atob(vapidPrivateKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', rawKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, enc.encode(signingInput))
  const jwt = `${signingInput}.${toBase64Url(sig)}`

  await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt},k=${vapidPublicKey}`,
      'Content-Type': 'application/json',
      TTL: '86400',
    },
    body: enc.encode(JSON.stringify(payload)),
  })
}
