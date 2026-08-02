import { makeServiceClient, cors, json, err } from '../_shared/supabase.ts'

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

  return json({ ok: true })
})
