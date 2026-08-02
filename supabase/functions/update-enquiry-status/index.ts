import { makeServiceClient, cors, json, err } from '../_shared/supabase.ts'

const NOTIFY_ON: Record<string, string> = {
  sale_completed: 'sale_confirmed',
  payment_pending: 'payment_pending',
}

Deno.serve(async (req) => {
  const preflight = cors(req)
  if (preflight) return preflight

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return err('Unauthorized', 401)

  const supabase = makeServiceClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authErr || !user) return err('Unauthorized', 401)

  const { enquiryId, status } = await req.json()
  if (!enquiryId || !status) return err('enquiryId and status required')

  await supabase.from('enquiries').update({ status, stage: status }).eq('id', enquiryId)

  await supabase.from('activities').insert({
    enquiry_id: enquiryId,
    type: 'status_changed',
    description: `Status updated to: ${status.replace(/_/g, ' ')}`,
    created_by: user.id,
  })

  // Fire team notification for important status changes
  const notifyEvent = NOTIFY_ON[status]
  if (notifyEvent) {
    const { data: agent } = await supabase.from('users').select('email').eq('id', user.id).single()
    const { data: enquiry } = await supabase
      .from('enquiries')
      .select('customer_id, value')
      .eq('id', enquiryId)
      .single()
    const { data: customer } = enquiry
      ? await supabase.from('customers').select('name').eq('id', enquiry.customer_id).single()
      : { data: null }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    fetch(`${supabaseUrl}/functions/v1/notify-team`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: notifyEvent,
        data: {
          customerName: customer?.name ?? 'Unknown',
          agentName: agent?.email ?? 'Team member',
          amount: enquiry?.value ? String(enquiry.value) : '',
        },
      }),
    }).catch(() => {})
  }

  return json({ ok: true })
})
