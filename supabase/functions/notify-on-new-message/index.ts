import { makeServiceClient, json } from '../_shared/supabase.ts'

// Called by a database webhook or manually; sends Web Push to all relevant users.
Deno.serve(async (req) => {
  const supabase = makeServiceClient()

  let message: Record<string, unknown>
  try {
    message = await req.json()
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400)
  }

  if (message.sender !== 'customer') return json({ ok: true, skipped: true })

  // Get conversation → customer name
  const { data: conv } = await supabase
    .from('conversations')
    .select('customer_id')
    .eq('id', message.conversation_id)
    .maybeSingle()

  if (!conv) return json({ ok: false, error: 'Conversation not found' }, 404)

  const { data: customer } = await supabase
    .from('customers')
    .select('name')
    .eq('id', conv.customer_id)
    .maybeSingle()

  const customerName = customer?.name ?? 'Unknown'
  const body = (message.text as string)?.slice(0, 100) || `[${message.type}]`
  const title = `New message from ${customerName}`

  // Get all users with push subscriptions
  const { data: users } = await supabase
    .from('users')
    .select('push_subscription')
    .not('push_subscription', 'is', null)

  if (!users?.length) return json({ ok: true, sent: 0 })

  const vapidKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'

  if (!vapidKey || !vapidPublic) return json({ ok: true, sent: 0, reason: 'no_vapid' })

  let sent = 0
  for (const user of users) {
    if (!user.push_subscription) continue
    try {
      await sendWebPush(
        user.push_subscription as PushSubscriptionJSON,
        { title, body },
        vapidPublic,
        vapidKey,
        vapidSubject
      )
      sent++
    } catch (e) {
      console.warn('Push failed:', e)
    }
  }

  return json({ ok: true, sent })
})

interface PushSubscriptionJSON {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

async function sendWebPush(
  subscription: PushSubscriptionJSON,
  payload: { title: string; body: string },
  vapidPublicKey: string,
  vapidPrivateKey: string,
  vapidSubject: string
) {
  const { endpoint, keys } = subscription
  const origin = new URL(endpoint).origin

  // Build VAPID JWT
  const header = { alg: 'ES256', typ: 'JWT' }
  const claims = {
    aud: origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: vapidSubject,
  }

  const toBase64Url = (buf: ArrayBuffer) =>
    btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

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

  const payloadBytes = enc.encode(JSON.stringify(payload))

  await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt},k=${vapidPublicKey}`,
      'Content-Type': 'application/json',
      TTL: '86400',
    },
    body: payloadBytes,
  })
}
