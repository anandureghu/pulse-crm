import { makeServiceClient, cors, json, err } from '../_shared/supabase.ts'
import {
  loadShopifyConfig,
  shopifyFetch,
  normalizePhoneDigits,
  isAddressComplete,
  findShopifyCustomer,
  mergeCustomerFromShopify,
  type OrderDto,
} from '../_shared/shopify.ts'
import { ensureProvince } from '../_shared/address.ts'

interface SelectedLine {
  variantId: number
  quantity: number
  amount?: number
}

interface CreateBody {
  dto: OrderDto
  /** Multi-product selection from the UI */
  lineItems?: SelectedLine[]
  /** @deprecated single-variant create — still accepted */
  variantId?: number
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

  let { dto, prompt } = body
  if (!dto?.customer) return err('dto.customer required')
  if (dto.amount == null) return err('dto.amount required')

  let selected: SelectedLine[] = Array.isArray(body.lineItems)
    ? body.lineItems.filter((l) => l?.variantId && (l.quantity ?? 0) > 0)
    : []

  if (selected.length === 0 && body.variantId) {
    const qty = dto.lineItems?.[0]?.quantity || dto.quantity || 1
    selected = [{ variantId: body.variantId, quantity: qty, amount: dto.lineItems?.[0]?.amount ?? dto.amount }]
  }

  if (selected.length === 0) return err('lineItems (or variantId) required')

  const phoneDigits = normalizePhoneDigits(dto.customer.phone || '')
  if (phoneDigits.length < 10) return err('Invalid phone number')

  let shopifyCustomerId: string | null = null
  let shopifyOrderId: string | null = null
  let shopifyOrderName: string | null = null
  const variantIdsLog = selected.map((l) => String(l.variantId)).join(',')

  try {
    const cfg = await loadShopifyConfig()

    // Returning customer: fill missing address from Shopify before validating
    {
      const existing = await findShopifyCustomer(cfg, phoneDigits, dto.customer.email)
      if (existing) {
        shopifyCustomerId = String(existing.id)
        dto = { ...dto, customer: mergeCustomerFromShopify(dto.customer, existing) }
      }
    }

    if (!isAddressComplete(dto.customer)) {
      return err(
        shopifyCustomerId
          ? 'Customer exists in Shopify but has no shipping address. Add address and retry.'
          : 'Shipping address is required for new customers.',
        400,
      )
    }

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

    if (!shopifyCustomerId) {
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

    const order: Record<string, unknown> = {
      line_items: selected.map((l) => ({
        variant_id: Number(l.variantId),
        quantity: Math.max(1, Number(l.quantity) || 1),
      })),
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
      variant_id: variantIdsLog,
      tags,
      prompt: prompt || null,
      parsed_dto: { ...dto, selectedLineItems: selected },
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
      variant_id: variantIdsLog,
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
