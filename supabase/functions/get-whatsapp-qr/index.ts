import { makeServiceClient, cors, json, err } from '../_shared/supabase.ts'

Deno.serve(async (req) => {
  const preflight = cors(req)
  if (preflight) return preflight

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return err('Unauthorized', 401)

  const supabase = makeServiceClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authErr || !user) return err('Unauthorized', 401)

  const base = Deno.env.get('EVOLUTION_API_URL')!.replace(/\/$/, '')
  const key = Deno.env.get('EVOLUTION_API_KEY')!
  const instance = Deno.env.get('EVOLUTION_INSTANCE')!

  const res = await fetch(`${base}/instance/connect/${instance}`, {
    headers: { apikey: key },
  })
  const data = await res.json()
  return json(data)
})
