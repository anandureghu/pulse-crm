import { makeServiceClient, cors, json, err } from '../_shared/supabase.ts'
import {
  loadShopifyConfig,
  shopifyFetch,
  normalizePhoneDigits,
  type OrderDto,
} from '../_shared/shopify.ts'
import { ensureProvince } from '../_shared/address.ts'

interface CreateBody {
  dto: OrderDto
  variantId: number
  prompt?: string
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

  let body: CreateBody
  try {
    body = await req.json()
  } catch {
    return err('Invalid JSON')
  }

  let { dto, variantId, prompt } = body
  if (!dto?.customer) return err('dto.customer required')
  if (!variantId) return err('variantId required')
  if (dto.amount == null) return err('dto.amount required')

  const phoneDigits = normalizePhoneDigits(dto.customer.phone || '')
  if (phoneDigits.length < 10) return err('Invalid phone number')

  let shopifyCustomerId: string | null = null
  let shopifyOrderId: string | null = null
  let shopifyOrderName: string | null = null

  try {
    const cfg = await loadShopifyConfig()

    // Fill Indian state if missing (PIN/city lookup, then OpenAI)
    const { data: aiRow } = await supabase.from('settings').select('value').eq('key', 'ai_config').maybeSingle()
    const aiCfg = aiRow?.value as { apiKey?: string; model?: string } | null
    dto = {
      ...dto,
      customer: await ensureProvince(dto.customer, {
        apiKey: aiCfg?.apiKey ?? '',
        model: aiCfg?.model,
      }),
    }
    if (!(dto.customer.province || '').trim() && (dto.customer.country || 'IN').toUpperCase() === 'IN') {
      return err('State/province is required for Indian addresses. Add province (e.g. Kerala) and retry.', 400)
    }

    // ── Find or create customer ──────────────────────────────────────────────
    const queryParts: string[] = [`phone:${phoneDigits}`]
    if (dto.customer.email?.trim()) {
      queryParts.push(`email:${dto.customer.email.trim()}`)
    }
    const searchQ = encodeURIComponent(queryParts.join(' OR '))
    const { data: searchData } = await shopifyFetch<{
      customers: Array<{ id: number; phone?: string; email?: string }>
    }>(cfg, `/customers/search.json?query=${searchQ}`)

    const existing = searchData.customers?.[0]
    if (existing) {
      shopifyCustomerId = String(existing.id)
    } else {
      const phoneE164 = phoneDigits.length === 10 ? `+91${phoneDigits}` : `+${phoneDigits}`
      const { data: created } = await shopifyFetch<{ customer: { id: number } }>(cfg, '/customers.json', {
        method: 'POST',
        body: JSON.stringify({
          customer: {
            first_name: dto.customer.firstName || 'Customer',
            last_name: dto.customer.lastName || '',
            email: dto.customer.email || undefined,
            phone: phoneE164,
            verified_email: false,
            addresses: [
              {
                address1: dto.customer.address1,
                address2: dto.customer.address2 || undefined,
                city: dto.customer.city,
                province: dto.customer.province || undefined,
                zip: dto.customer.zip,
                country: dto.customer.country || 'IN',
                phone: phoneE164,
                first_name: dto.customer.firstName || 'Customer',
                last_name: dto.customer.lastName || '',
                default: true,
              },
            ],
          },
        }),
      })
      shopifyCustomerId = String(created.customer.id)
    }

    const tags = (Array.isArray(dto.tags) ? dto.tags : [])
      .map((t) => String(t).trim())
      .filter(Boolean)
    const tagsStr = tags.join(', ')
    const isCod = tags.some((t) => t.toUpperCase() === 'COD') || dto.financialStatus === 'pending'
    const quantity = dto.quantity && dto.quantity > 0 ? dto.quantity : 1

    const shippingAddress = {
      first_name: dto.customer.firstName || 'Customer',
      last_name: dto.customer.lastName || '',
      address1: dto.customer.address1,
      address2: dto.customer.address2 || undefined,
      city: dto.customer.city,
      province: dto.customer.province || undefined,
      zip: dto.customer.zip,
      country: dto.customer.country || 'IN',
      phone: phoneDigits.length === 10 ? `+91${phoneDigits}` : `+${phoneDigits}`,
    }

    // Shopify rejects tags: "" — omit when empty; must be a comma-separated string when set
    const order: Record<string, unknown> = {
      line_items: [{ variant_id: Number(variantId), quantity }],
      customer: { id: Number(shopifyCustomerId) },
      shipping_address: shippingAddress,
      billing_address: shippingAddress,
      financial_status: isCod ? 'pending' : (dto.financialStatus || 'paid'),
      send_receipt: false,
      send_fulfillment_receipt: false,
      inventory_behaviour: 'decrement_ignoring_policy',
    }
    if (tagsStr) order.tags = tagsStr
    if (dto.note?.trim()) order.note = dto.note.trim()

    const orderPayload: Record<string, unknown> = { order }

    if (dto.shippingLines?.length) {
      ;(orderPayload.order as Record<string, unknown>).shipping_lines = dto.shippingLines.map((s) => ({
        title: s.title,
        price: s.price,
        code: s.title,
      }))
    }

    if (isCod) {
      ;(orderPayload.order as Record<string, unknown>).transactions = [
        {
          kind: 'sale',
          status: 'pending',
          amount: String(dto.amount),
          gateway: 'Cash on Delivery (COD)',
        },
      ]
    }

    const { data: orderRes } = await shopifyFetch<{ order: { id: number; name: string } }>(
      cfg,
      '/orders.json',
      { method: 'POST', body: JSON.stringify(orderPayload) },
    )

    shopifyOrderId = String(orderRes.order.id)
    shopifyOrderName = orderRes.order.name

    await supabase.from('shopify_orders').insert({
      shopify_order_id: shopifyOrderId,
      shopify_order_name: shopifyOrderName,
      shopify_customer_id: shopifyCustomerId,
      phone: phoneDigits,
      email: dto.customer.email || null,
      amount: dto.amount,
      variant_id: String(variantId),
      tags,
      prompt: prompt || null,
      parsed_dto: dto,
      status: 'created',
      created_by: user.id,
    })

    const adminUrl = `https://${cfg.shopDomain}/admin/orders/${shopifyOrderId}`

    return json({
      ok: true,
      orderId: shopifyOrderId,
      orderName: shopifyOrderName,
      customerId: shopifyCustomerId,
      adminUrl,
    })
  } catch (e) {
    const message = (e as Error).message
    await supabase.from('shopify_orders').insert({
      shopify_order_id: shopifyOrderId,
      shopify_order_name: shopifyOrderName,
      shopify_customer_id: shopifyCustomerId,
      phone: phoneDigits,
      email: dto.customer.email || null,
      amount: dto.amount,
      variant_id: String(variantId),
      tags: Array.isArray(dto.tags) ? dto.tags : [],
      prompt: prompt || null,
      parsed_dto: dto,
      status: 'failed',
      error: message,
      created_by: user.id,
    })
    return err(message, 500)
  }
})
