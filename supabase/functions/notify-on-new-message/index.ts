import { makeServiceClient, json } from '../_shared/supabase.ts'
import { sendWebPushBatch } from '../_shared/webpush.ts'

Deno.serve(async (req) => {
  const supabase = makeServiceClient()

  let message: Record<string, unknown>
  try {
    message = await req.json()
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400)
  }

  // Only notify for inbound customer messages
  if (message.sender !== 'customer') return json({ ok: true, skipped: true })

  // Resolve customer name for notification title
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
  const title = `💬 ${customerName}`

  // Fetch subscriptions for users who have inbox_messages ON
  const { data: subs } = await supabase
    .from('user_push_subscriptions')
    .select('id, endpoint, p256dh, auth, users!inner(notification_preferences)')
    .filter('users.notification_preferences->inbox_messages', 'eq', 'true')

  if (!subs?.length) return json({ ok: true, sent: 0 })

  const { sent, failed } = await sendWebPushBatch(
    subs.map((s) => ({ id: s.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth })),
    { title, body, url: '/inbox', tag: 'inbox-message' },
  )

  return json({ ok: true, sent, failed })
})
