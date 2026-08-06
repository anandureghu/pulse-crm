import { makeServiceClient, cors, json, err } from '../_shared/supabase.ts'
import type { OrderDto } from '../_shared/shopify.ts'
import { ensureProvince } from '../_shared/address.ts'

const SYSTEM = `You extract Shopify order details from free-form sales prompts (often Indian addresses in English/Manglish).

Return ONLY valid JSON matching this schema (no markdown):
{
  "customer": {
    "firstName": string,
    "lastName": string,
    "phone": string,
    "email": string | null,
    "address1": string,
    "address2": string | null,
    "city": string,
    "province": string,
    "zip": string,
    "country": "IN"
  },
  "amount": number,
  "quantity": number,
  "tags": string[],
  "note": string | null,
  "financialStatus": "pending" | "paid",
  "shippingLines": [{ "title": string, "price": string }] | null
}

Rules:
- Split full name into firstName / lastName (if one word, lastName = "").
- phone: prefer 10-digit Indian mobile; strip spaces; keep digits only in phone field (no +91 prefix unless only way to preserve digits).
- zip: 6-digit Indian PIN from the prompt.
- address1: house / street line; address2: landmark / "Near …" if present.
- city: locality/city (e.g. Calicut or Kozhikode as written).
- province: REQUIRED for India. Always set the full Indian state/UT English name (e.g. "Kerala", "Tamil Nadu").
  Infer from city, locality, district, and 6-digit PIN when the prompt omits state. Do not leave province null for Indian addresses if it can be inferred.
- country: always "IN" unless clearly another country.
- amount: order total as a number (₹/Rs/INR prefixes ignored). Required.
- quantity: default 1.
- tags: collect tokens like COD, PREPAID, URGENT from the prompt (uppercase common tags).
- If COD (or Cash on Delivery) is present: financialStatus = "pending", and include tag "COD".
- If prepaid/paid mentioned: financialStatus = "paid".
- note: any leftover instructions; else null.
- shippingLines: only if shipping charge mentioned; else null.
- email: only if an email appears; else null.`

Deno.serve(async (req) => {
  const preflight = cors(req)
  if (preflight) return preflight
  if (req.method !== 'POST') return err('Method Not Allowed', 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return err('Unauthorized', 401)

  const supabase = makeServiceClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authErr || !user) return err('Unauthorized', 401)

  let body: { prompt?: string }
  try {
    body = await req.json()
  } catch {
    return err('Invalid JSON')
  }
  const prompt = body.prompt?.trim()
  if (!prompt) return err('prompt required')

  const { data: aiRow } = await supabase.from('settings').select('value').eq('key', 'ai_config').single()
  const aiCfg = aiRow?.value as { apiKey?: string; model?: string } | null
  if (!aiCfg?.apiKey) return err('OpenAI API key not configured in Settings', 400)

  const model = aiCfg.model ?? 'gpt-4o-mini'

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${aiCfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: prompt },
        ],
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      return err(data?.error?.message ?? 'OpenAI request failed', 500)
    }
    const content = data.choices?.[0]?.message?.content
    if (!content) return err('Empty OpenAI response', 500)

    let parsed: OrderDto
    try {
      parsed = JSON.parse(content) as OrderDto
    } catch {
      return err('Failed to parse OpenAI JSON', 500)
    }

    // Normalize defaults
    if (!parsed.quantity || parsed.quantity < 1) parsed.quantity = 1
    if (!Array.isArray(parsed.tags)) parsed.tags = []
    parsed.tags = parsed.tags.map((t) => String(t).trim()).filter(Boolean)
    if (!parsed.customer) return err('Missing customer in parsed DTO', 400)
    if (parsed.amount == null || Number.isNaN(Number(parsed.amount))) {
      return err('Missing or invalid amount in parsed DTO', 400)
    }
    parsed.amount = Number(parsed.amount)
    if (!parsed.customer.country) parsed.customer.country = 'IN'
    if (!parsed.customer.phone) return err('Missing phone in parsed DTO', 400)
    if (!parsed.customer.address1) return err('Missing address in parsed DTO', 400)

    // Fill missing Indian state from PIN/city, then OpenAI if still missing
    parsed.customer = await ensureProvince(parsed.customer, {
      apiKey: aiCfg.apiKey,
      model,
    })

    const tagsUpper = parsed.tags.map((t) => t.toUpperCase())
    if (tagsUpper.includes('COD') && !parsed.financialStatus) {
      parsed.financialStatus = 'pending'
    }
    if (!parsed.financialStatus) parsed.financialStatus = 'pending'

    return json({ ok: true, dto: parsed, prompt })
  } catch (e) {
    return err((e as Error).message, 500)
  }
})
