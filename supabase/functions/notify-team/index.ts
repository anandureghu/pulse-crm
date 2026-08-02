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

const evolutionBase = () => Deno.env.get('EVOLUTION_API_URL')!.replace(/\/$/, '')
const evolutionKey = () => Deno.env.get('EVOLUTION_API_KEY')!
const instanceName = () => Deno.env.get('EVOLUTION_INSTANCE')!

async function sendWhatsApp(phone: string, text: string) {
  const number = phone.replace(/\D/g, '')
  const to = number.startsWith('91') ? `${number}@s.whatsapp.net` : `91${number}@s.whatsapp.net`
  await fetch(`${evolutionBase()}/message/sendText/${instanceName()}`, {
    method: 'POST',
    headers: { apikey: evolutionKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ number: to, text }),
  })
}

type Event = 'sale_confirmed' | 'payment_pending' | 'new_lead' | 'assigned'

function buildMessage(event: Event, data: Record<string, string>): string {
  switch (event) {
    case 'sale_confirmed':
      return `🎉 *Sale confirmed!*\nCustomer: ${data.customerName}\nBy: ${data.agentName}`
    case 'payment_pending':
      return `💰 *Payment pending*\nCustomer: ${data.customerName}\nAmount: ₹${data.amount ?? '—'}\nBy: ${data.agentName}`
    case 'new_lead':
      return `🆕 *New lead!*\nCustomer: ${data.customerName}\nPhone: ${data.customerPhone}`
    case 'assigned':
      return `👤 *${data.customerName}* has been assigned to you by ${data.assignedBy}`
    default:
      return `📢 CRM Update: ${JSON.stringify(data)}`
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return fail('Method Not Allowed', 405)

  let body: { event?: Event; data?: Record<string, string>; assignedUserId?: string }
  try { body = await req.json() } catch { return fail('Invalid JSON') }

  const { event, data, assignedUserId } = body
  if (!event || !data) return fail('event and data required')

  const supabase = makeServiceClient()

  // For 'assigned' — only notify the specific member being assigned
  let query = supabase.from('users').select('id, phone, email')
  if (event === 'assigned' && assignedUserId) {
    query = query.eq('id', assignedUserId)
  }
  // Only fetch members who have a phone number set
  const { data: members } = await query.not('phone', 'is', null).neq('phone', '')

  if (!members || members.length === 0) return ok({ sent: 0, message: 'No team members with phone numbers' })

  const message = buildMessage(event, data)

  const results = await Promise.allSettled(
    members.map((m: { phone: string }) => sendWhatsApp(m.phone, message))
  )

  const sent = results.filter((r) => r.status === 'fulfilled').length
  return ok({ sent, total: members.length })
})
