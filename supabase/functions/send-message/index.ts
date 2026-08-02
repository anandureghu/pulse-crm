import { makeServiceClient, cors, json, err } from '../_shared/supabase.ts'

const evolutionBase = () => Deno.env.get('EVOLUTION_API_URL')!.replace(/\/$/, '')
const evolutionKey = () => Deno.env.get('EVOLUTION_API_KEY')!
const instanceName = () => Deno.env.get('EVOLUTION_INSTANCE')!

async function evoPost(path: string, body: unknown) {
  const res = await fetch(`${evolutionBase()}${path}`, {
    method: 'POST',
    headers: { apikey: evolutionKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

Deno.serve(async (req) => {
  const preflight = cors(req)
  if (preflight) return preflight

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return err('Unauthorized', 401)

  const supabase = makeServiceClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authErr || !user) return err('Unauthorized', 401)

  const { conversationId, text, mediaUrl, mediaType } = await req.json()
  if (!conversationId) return err('conversationId required')

  const { data: conv } = await supabase.from('conversations').select('customer_id').eq('id', conversationId).single()
  if (!conv) return err('Conversation not found', 404)

  const { data: customer } = await supabase.from('customers').select('phone').eq('id', conv.customer_id).single()
  if (!customer) return err('Customer not found', 404)

  const to = `${customer.phone}@s.whatsapp.net`

  let evoMsgId: string
  if (mediaUrl && mediaType) {
    const res = await evoPost(`/message/sendMedia/${instanceName()}`, {
      number: to, mediatype: mediaType, media: mediaUrl, caption: text,
    })
    evoMsgId = res?.key?.id ?? Date.now().toString()
  } else if (text) {
    const res = await evoPost(`/message/sendText/${instanceName()}`, { number: to, text })
    evoMsgId = res?.key?.id ?? Date.now().toString()
  } else {
    return err('text or mediaUrl required')
  }

  await supabase.from('messages').upsert({
    id: evoMsgId,
    conversation_id: conversationId,
    sender: 'agent',
    type: mediaType ?? 'text',
    text: text ?? '',
    media: mediaUrl ?? null,
    status: 'sent',
    timestamp: new Date().toISOString(),
  })

  await supabase.from('conversations').update({
    last_message: text ?? `[${mediaType}]`,
  }).eq('id', conversationId)

  return json({ ok: true, messageId: evoMsgId })
})
