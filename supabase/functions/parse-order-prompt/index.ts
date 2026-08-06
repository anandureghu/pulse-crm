import { makeServiceClient, cors, json, err } from '../_shared/supabase.ts'
import {
  type OrderDto,
  type OrderLineItemDto,
  normalizePhoneDigits,
  isAddressComplete,
  loadShopifyConfig,
  findShopifyCustomer,
  mergeCustomerFromShopify,
} from '../_shared/shopify.ts'
import { ensureProvince } from '../_shared/address.ts'

const SYSTEM = `You extract Shopify order details from free-form sales prompts (often Indian addresses in English/Manglish).

Return ONLY valid JSON matching this schema (no markdown):
{
  "customer": {
    "firstName": string,
    "lastName": string,
    "phone": string,
    "email": string | null,
    "address1": string | null,
    "address2": string | null,
    "city": string | null,
    "province": string | null,
    "zip": string | null,
    "country": "IN"
  },
  "lineItems": [
    { "amount": number, "quantity": number, "hint": string | null }
  ],
  "amount": number,
  "tags": string[],
  "note": string | null,
  "financialStatus": "pending" | "paid",
  "shippingLines": [{ "title": string, "price": string }] | null
}

## Customer & address (prettify)
- phone: REQUIRED. 10-digit Indian mobile digits only.
- Split full name into firstName / lastName when a name is present (Title Case). If no name in prompt, use empty strings "".
- Address fields may be null/empty when the prompt only has phone + products (returning customer). Do NOT invent an address.
- When an address IS present, PRETTIFY it for Shopify:
  - address1: clean house/building/street; Title Case; fix spacing.
  - address2: landmark / "Near …", Title Case, or null.
  - city: proper casing; zip: 6-digit PIN; province: full Indian state name when inferable.
- country: "IN" unless clearly another country.
- email: only if present; else null.

## Line items (multi-product)
- lineItems: one entry per product. amount = unit price; quantity >= 1; hint = product name if mentioned.
- Support multiple products in one prompt.
- amount (top-level) = order total (sum of line.amount × quantity, plus shipping if any).

## Payment / tags / notes
- tags: COD, PREPAID, etc. (uppercase).
- COD → financialStatus "pending" + tag "COD". Prepaid/paid → "paid".
- note / shippingLines: only if present.`

function normalizeLineItems(parsed: OrderDto): OrderLineItemDto[] {
  const raw = Array.isArray(parsed.lineItems) ? parsed.lineItems : []
  const lines = raw
    .map((li) => ({
      amount: Number(li.amount),
      quantity: Math.max(1, Number(li.quantity) || 1),
      hint: li.hint?.trim() || null,
    }))
    .filter((li) => !Number.isNaN(li.amount) && li.amount > 0)

  if (lines.length > 0) return lines

  const amount = Number(parsed.amount)
  const quantity = Math.max(1, Number(parsed.quantity) || 1)
  if (!Number.isNaN(amount) && amount > 0) {
    return [{ amount, quantity, hint: null }]
  }
  return []
}

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

    if (!parsed.customer) return err('Missing customer in parsed DTO', 400)
    if (!parsed.customer.phone) return err('Missing phone in parsed DTO', 400)

    // Normalize empty strings
    parsed.customer = {
      ...parsed.customer,
      firstName: parsed.customer.firstName?.trim() || '',
      lastName: parsed.customer.lastName?.trim() || '',
      address1: parsed.customer.address1?.trim() || '',
      address2: parsed.customer.address2?.trim() || null,
      city: parsed.customer.city?.trim() || '',
      province: parsed.customer.province?.trim() || null,
      zip: parsed.customer.zip?.trim() || '',
      country: parsed.customer.country || 'IN',
      email: parsed.customer.email?.trim() || null,
    }

    if (!Array.isArray(parsed.tags)) parsed.tags = []
    parsed.tags = parsed.tags.map((t) => String(t).trim()).filter(Boolean)

    parsed.lineItems = normalizeLineItems(parsed)
    if (parsed.lineItems.length === 0) {
      return err('No line items / amount found in prompt', 400)
    }

    const computedTotal = parsed.lineItems.reduce((s, li) => s + li.amount * li.quantity, 0)
    const shippingTotal = (parsed.shippingLines ?? []).reduce((s, l) => s + (parseFloat(l.price) || 0), 0)
    const parsedAmount = Number(parsed.amount)
    parsed.amount = !Number.isNaN(parsedAmount) && parsedAmount > 0
      ? parsedAmount
      : computedTotal + shippingTotal

    // Returning customer: fill missing name/address from Shopify
    let customerSource: 'prompt' | 'shopify' | 'new' = 'prompt'
    let shopifyCustomerId: string | null = null
    const phoneDigits = normalizePhoneDigits(parsed.customer.phone)

    try {
      const cfg = await loadShopifyConfig()
      const existing = await findShopifyCustomer(cfg, phoneDigits, parsed.customer.email)
      if (existing) {
        shopifyCustomerId = String(existing.id)
        const before = isAddressComplete(parsed.customer)
        parsed.customer = mergeCustomerFromShopify(parsed.customer, existing)
        customerSource = before && isAddressComplete(parsed.customer) ? 'prompt' : 'shopify'
      } else {
        customerSource = 'new'
      }
    } catch (e) {
      console.error('Shopify customer lookup skipped:', (e as Error).message)
    }

    if (isAddressComplete(parsed.customer)) {
      parsed.customer = await ensureProvince(parsed.customer, {
        apiKey: aiCfg.apiKey,
        model,
      })
    }

    if (!isAddressComplete(parsed.customer)) {
      if (customerSource === 'shopify' || shopifyCustomerId) {
        return err(
          'Customer found in Shopify but has no usable shipping address. Add address in the form or in Shopify, then retry.',
          400,
        )
      }
      return err(
        'New customer — shipping address is required. Include address in the prompt or fill it in after parsing.',
        400,
      )
    }

    const tagsUpper = parsed.tags.map((t) => t.toUpperCase())
    if (tagsUpper.includes('COD') && !parsed.financialStatus) {
      parsed.financialStatus = 'pending'
    }
    if (!parsed.financialStatus) parsed.financialStatus = 'pending'

    return json({
      ok: true,
      dto: parsed,
      prompt,
      customerSource,
      shopifyCustomerId,
    })
  } catch (e) {
    return err((e as Error).message, 500)
  }
})
