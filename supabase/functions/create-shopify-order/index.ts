import { makeServiceClient, cors, json, err } from '../_shared/supabase.ts'
import {
  loadShopifyConfig,
  shopifyGraphql,
  shopifyAccessScopeHandles,
  shopifyGid,
  fromShopifyGid,
  normalizePhoneDigits,
  isAddressComplete,
  findShopifyCustomer,
  mergeCustomerFromShopify,
  toGraphqlMailingAddress,
  normalizeDiscount,
  orderTotalAfterDiscount,
  type OrderDto,
  type ShopifyConfig,
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

const ORDER_CREATE_MUTATION = `#graphql
  mutation OrderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
    orderCreate(order: $order, options: $options) {
      userErrors { field message }
      order {
        id
        name
        shippingAddress { address1 }
        billingAddress { address1 }
        customer { id }
      }
    }
  }
`

const ORDER_UPDATE_MUTATION = `#graphql
  mutation OrderUpdate($input: OrderInput!) {
    orderUpdate(input: $input) {
      userErrors { field message }
      order {
        id
        shippingAddress { address1 }
        billingAddress { address1 }
      }
    }
  }
`

function moneyBag(amount: number, currency: string) {
  return {
    shopMoney: {
      amount: Number(amount).toFixed(2),
      currencyCode: currency,
    },
  }
}

async function shopCurrency(cfg: ShopifyConfig): Promise<string> {
  const data = await shopifyGraphql<{ shop: { currencyCode: string } }>(
    cfg,
    `query { shop { currencyCode } }`,
  )
  return data.shop?.currencyCode || 'INR'
}

async function withScopeHint(cfg: ShopifyConfig, message: string): Promise<string> {
  if (!/403|not authorized|access denied|service is unavailable/i.test(message)) return message
  const scopes = await shopifyAccessScopeHandles(cfg)
  const needed = ['write_orders', 'read_orders', 'write_customers', 'read_customers']
  const missing = needed.filter((s) => !scopes.includes(s))
  if (missing.length) {
    return `${message} Missing Shopify scopes: ${missing.join(', ')}. Add them in Dev Dashboard and reinstall the app on the shop.`
  }
  if (scopes.length) {
    return `${message} App scopes (${scopes.join(', ')}). If write_orders is present, the store plan may be paused or not allow API order creation.`
  }
  return `${message} Confirm write_orders is granted, the app is installed, and the Shopify store subscription is active.`
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
  let cfg: ShopifyConfig | null = null

  try {
    cfg = await loadShopifyConfig()

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

    const tags = (Array.isArray(dto.tags) ? dto.tags : [])
      .map((t) => String(t).trim())
      .filter(Boolean)
    const isCod = tags.some((t) => t.toUpperCase() === 'COD') || dto.financialStatus === 'pending'
    const discount = normalizeDiscount(dto.discount)
    dto = { ...dto, discount }
    const payable = orderTotalAfterDiscount(dto)
    dto = { ...dto, amount: payable }

    const phoneE164 = phoneDigits.length === 10 ? `+91${phoneDigits}` : `+${phoneDigits}`
    const mailing = toGraphqlMailingAddress(dto.customer, phoneE164)
    const currency = await shopCurrency(cfg)

    const customerInput = shopifyCustomerId
      ? {
          toUpsert: {
            id: shopifyGid('Customer', shopifyCustomerId),
            firstName: mailing.firstName,
            lastName: mailing.lastName,
            email: dto.customer.email?.trim() || undefined,
            phone: phoneE164,
          },
        }
      : {
          toUpsert: {
            firstName: mailing.firstName,
            lastName: mailing.lastName,
            email: dto.customer.email?.trim() || undefined,
            phone: phoneE164,
          },
        }

    const order: Record<string, unknown> = {
      lineItems: selected.map((l) => ({
        variantId: shopifyGid('ProductVariant', l.variantId),
        quantity: Math.max(1, Number(l.quantity) || 1),
        requiresShipping: true,
      })),
      customer: customerInput,
      shippingAddress: mailing,
      billingAddress: { ...mailing },
      financialStatus: isCod ? 'PENDING' : (dto.financialStatus === 'pending' ? 'PENDING' : 'PAID'),
      phone: phoneE164,
    }
    if (tags.length) order.tags = tags
    if (dto.note?.trim()) order.note = dto.note.trim()
    if (dto.customer.email?.trim()) order.email = dto.customer.email.trim()

    if (discount) {
      const code = (discount.code || 'DISCOUNT').slice(0, 255)
      if (discount.type === 'percentage') {
        order.discountCode = {
          itemPercentageDiscountCode: { code, percentage: discount.amount },
        }
      } else {
        order.discountCode = {
          itemFixedDiscountCode: { code, amountSet: moneyBag(discount.amount, currency) },
        }
      }
    }

    if (dto.shippingLines?.length) {
      order.shippingLines = dto.shippingLines.map((s) => ({
        title: s.title,
        code: s.title,
        priceSet: moneyBag(parseFloat(String(s.price)) || 0, currency),
      }))
    }

    if (isCod) {
      order.transactions = [
        {
          kind: 'SALE',
          status: 'PENDING',
          amountSet: moneyBag(payable, currency),
          gateway: 'Cash on Delivery (COD)',
        },
      ]
    }

    const created = await shopifyGraphql<{
      orderCreate: {
        userErrors: { field?: string[] | null; message: string }[]
        order: {
          id: string
          name: string
          shippingAddress?: { address1?: string | null } | null
          billingAddress?: { address1?: string | null } | null
          customer?: { id: string } | null
        } | null
      }
    }>(cfg, ORDER_CREATE_MUTATION, {
      order,
      options: {
        inventoryBehaviour: 'DECREMENT_IGNORING_POLICY',
        sendReceipt: false,
        sendFulfillmentReceipt: false,
      },
    })

    const payload = created.orderCreate
    if (payload.userErrors?.length) {
      throw new Error(payload.userErrors.map((e) => {
        const field = e.field?.length ? `${e.field.join('.')}: ` : ''
        return `${field}${e.message}`
      }).join('; '))
    }
    if (!payload.order) throw new Error('Shopify orderCreate returned no order')

    const shopifyOrderId = fromShopifyGid(payload.order.id)
    if (!shopifyOrderId) throw new Error('Shopify orderCreate returned no order id')
    const shopifyOrderName = payload.order.name
    shopifyCustomerId = fromShopifyGid(payload.order.customer?.id) || shopifyCustomerId

    const shipOk = Boolean(payload.order.shippingAddress?.address1?.trim())
    const billOk = Boolean(payload.order.billingAddress?.address1?.trim())
    if (!shipOk || !billOk) {
      console.warn('Order created without addresses; applying GraphQL orderUpdate', {
        orderId: shopifyOrderId,
        shipOk,
        billOk,
      })
      try {
        const updated = await shopifyGraphql<{
          orderUpdate: { userErrors: { message: string }[] }
        }>(cfg, ORDER_UPDATE_MUTATION, {
          input: {
            id: payload.order.id,
            shippingAddress: mailing,
          },
        })
        if (updated.orderUpdate.userErrors?.length) {
          console.error('orderUpdate address fix failed', updated.orderUpdate.userErrors)
        }
      } catch (e) {
        console.error('orderUpdate address fix failed', e)
      }
    }

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
    const hinted = cfg ? await withScopeHint(cfg, message) : message
    return err(hinted, 500)
  }
})
