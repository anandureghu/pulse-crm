// supabase/functions/_shared/webpush.ts
import { makeServiceClient } from './supabase.ts'

export interface PushSub {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

/**
 * Send a web push notification to multiple subscriptions.
 * Automatically deletes subscriptions that return 410 Gone (expired/unsubscribed).
 * Returns counts of sent and failed.
 */
export async function sendWebPushBatch(
  subscriptions: PushSub[],
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  const vapidPublic  = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'

  if (!vapidPublic || !vapidPrivate) {
    console.warn('VAPID keys not set — skipping push')
    return { sent: 0, failed: 0 }
  }

  let sent = 0
  let failed = 0

  for (const sub of subscriptions) {
    try {
      const status = await sendOne(sub, payload, vapidPublic, vapidPrivate, vapidSubject)
      if (status === 410) {
        // Subscription expired — remove it
        await makeServiceClient()
          .from('user_push_subscriptions')
          .delete()
          .eq('id', sub.id)
        console.log('Removed expired subscription', sub.id)
      } else if (status >= 200 && status < 300) {
        sent++
      } else {
        failed++
        console.warn('Push failed with status', status, 'for', sub.id)
      }
    } catch (e) {
      failed++
      console.warn('Push error for', sub.id, e)
    }
  }

  return { sent, failed }
}

async function sendOne(
  sub: PushSub,
  payload: PushPayload,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  vapidSubject: string,
): Promise<number> {
  const origin = new URL(sub.endpoint).origin

  const toBase64Url = (buf: ArrayBuffer) =>
    btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

  const enc = new TextEncoder()
  const header = { alg: 'ES256', typ: 'JWT' }
  const claims = {
    aud: origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: vapidSubject,
  }
  const headerB64 = toBase64Url(enc.encode(JSON.stringify(header)))
  const claimsB64 = toBase64Url(enc.encode(JSON.stringify(claims)))
  const signingInput = `${headerB64}.${claimsB64}`

  const rawKey = Uint8Array.from(
    atob(vapidPrivateKey.replace(/-/g, '+').replace(/_/g, '/')),
    (c) => c.charCodeAt(0),
  )
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', rawKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, enc.encode(signingInput),
  )
  const jwt = `${signingInput}.${toBase64Url(sig)}`

  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt},k=${vapidPublicKey}`,
      'Content-Type': 'application/json',
      TTL: '86400',
    },
    body: enc.encode(JSON.stringify(payload)),
  })

  return res.status
}
