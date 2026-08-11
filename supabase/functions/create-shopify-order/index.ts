import { makeServiceClient, cors, json, err } from '../_shared/supabase.ts'
import {
  loadShopifyConfig,
  shopifyFetch,
  normalizePhoneDigits,
  isAddressComplete,
  findShopifyCustomer,
  mergeCustomerFromShopify,
  toShopifyMailingAddress,
  normalizeDiscount,
  orderTotalAfterDiscount,
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

  let { dto } = body
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
      const addressBlock = {
        ...toShopifyMailingAddress(dto.customer, phoneE164),
        default: true,
      }
      const { data: created } = await shopifyFetch<{ customer: { id: number } }>(cfg, '/customers.json', {
        method: 'POST',
        body: JSON.stringify({
          customer: {
            first_name: addressBlock.first_name,
            last_name: addressBlock.last_name,
            email: dto.customer.email || undefined,
            phone: phoneE164,
            verified_email: false,
            addresses: [addressBlock],
          },
        }),
      })
      shopifyCustomerId = String(created.customer.id)
    } else {
      // Keep Shopify customer default address in sync with the order DTO
      const phoneE164 = phoneDigits.length === 10 ? `+91${phoneDigits}` : `+${phoneDigits}`
      const addressBlock = {
        ...toShopifyMailingAddress(dto.customer, phoneE164),
        default: true,
      }
      try {
        await shopifyFetch(cfg, `/customers/${shopifyCustomerId}.json`, {
          method: 'PUT',
          body: JSON.stringify({
            customer: {
              id: Number(shopifyCustomerId),
              first_name: addressBlock.first_name,
              last_name: addressBlock.last_name,
              email: dto.customer.email || undefined,
              addresses: [addressBlock],
            },
          }),
        })
      } catch (e) {
        console.error('Failed to update Shopify customer address:', e)
      }
    }

    const tags = (Array.isArray(dto.tags) ? dto.tags : [])
      .map((t) => String(t).trim())
      .filter(Boolean)
    const tagsStr = tags.join(', ')
    const isCod = tags.some((t) => t.toUpperCase() === 'COD') || dto.financialStatus === 'pending'
    const discount = normalizeDiscount(dto.discount)
    dto = { ...dto, discount }
    const payable = orderTotalAfterDiscount(dto)
    dto = { ...dto, amount: payable }

    const phoneE164 = phoneDigits.length === 10 ? `+91${phoneDigits}` : `+${phoneDigits}`
    // Distinct objects; Shopify requires non-empty first_name + last_name or it drops both addresses
    const shippingAddress = toShopifyMailingAddress(dto.customer, phoneE164)
    const billingAddress = { ...shippingAddress }

    const order: Record<string, unknown> = {
      line_items: selected.map((l) => ({
        variant_id: Number(l.variantId),
        quantity: Math.max(1, Number(l.quantity) || 1),
      })),
      customer: { id: Number(shopifyCustomerId) },
      shipping_address: shippingAddress,
      billing_address: billingAddress,
      financial_status: isCod ? 'pending' : (dto.financialStatus || 'paid'),
      send_receipt: false,
      send_fulfillment_receipt: false,
      inventory_behaviour: 'decrement_ignoring_policy',
    }
    if (tagsStr) order.tags = tagsStr
    if (dto.note?.trim()) order.note = dto.note.trim()

    if (discount) {
      order.discount_codes = [
        {
          code: (discount.code || 'DISCOUNT').slice(0, 255),
          amount: String(discount.amount),
          type: discount.type,
        },
      ]
    }

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
          amount: String(payable),
          gateway: 'Cash on Delivery (COD)',
        },
      ]
    }

    const { data: orderRes } = await shopifyFetch<{
      order: {
        id: number
        name: string
        shipping_address?: { address1?: string | null } | null
        billing_address?: { address1?: string | null } | null
      }
    }>(cfg, '/orders.json', { method: 'POST', body: JSON.stringify(orderPayload) })

    shopifyOrderId = String(orderRes.order.id)
    shopifyOrderName = orderRes.order.name

    // If Shopify still dropped addresses, force-update the order
    const shipOk = Boolean(orderRes.order.shipping_address?.address1?.trim())
    const billOk = Boolean(orderRes.order.billing_address?.address1?.trim())
    if (!shipOk || !billOk) {
      console.warn('Order created without addresses; applying PUT fix', {
        orderId: shopifyOrderId,
        shipOk,
        billOk,
      })
      await shopifyFetch(cfg, `/orders/${shopifyOrderId}.json`, {
        method: 'PUT',
        body: JSON.stringify({
          order: {
            id: Number(shopifyOrderId),
            shipping_address: shippingAddress,
            billing_address: billingAddress,
          },
        }),
      })
    }

    // Local DB is a Shopify mirror only — client resyncs via sync-shopify-orders after create.
    const adminUrl = `https://${cfg.shopDomain}/admin/orders/${shopifyOrderId}`

    return json({
      ok: true,
      orderId: shopifyOrderId,
      orderName: shopifyOrderName,
      customerId: shopifyCustomerId,
      adminUrl,
    })
  } catch (e) {
    return err((e as Error).message, 500)
  }
})
