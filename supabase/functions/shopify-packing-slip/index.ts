import { makeServiceClient, cors, json, err } from '../_shared/supabase.ts'
import { loadShopifyConfig, shopifyGraphql, shopifyGid } from '../_shared/shopify.ts'

const PACKING_SLIP_QUERY = `#graphql
  query PackingSlip($id: ID!) {
    shop { name }
    order(id: $id) {
      id
      name
      createdAt
      cancelledAt
      displayFinancialStatus
      displayFulfillmentStatus
      note
      tags
      email
      phone
      paymentGatewayNames
      totalPriceSet { shopMoney { amount currencyCode } }
      subtotalPriceSet { shopMoney { amount currencyCode } }
      totalShippingPriceSet { shopMoney { amount currencyCode } }
      totalDiscountsSet { shopMoney { amount currencyCode } }
      customer { firstName lastName email phone }
      shippingAddress {
        name firstName lastName company address1 address2 city province zip country phone
      }
      billingAddress {
        name firstName lastName company address1 address2 city province zip country phone
      }
      shippingLine { title }
      lineItems(first: 100) {
        nodes {
          name
          sku
          quantity
          variantTitle
          originalUnitPriceSet { shopMoney { amount currencyCode } }
          discountedTotalSet { shopMoney { amount currencyCode } }
        }
      }
      fulfillments(first: 10) {
        nodes {
          status
          createdAt
          trackingInfo { company number url }
        }
      }
    }
  }
`

interface MoneySet {
  shopMoney?: { amount?: string; currencyCode?: string }
}

interface GqlAddress {
  name?: string | null
  firstName?: string | null
  lastName?: string | null
  company?: string | null
  address1?: string | null
  address2?: string | null
  city?: string | null
  province?: string | null
  zip?: string | null
  country?: string | null
  phone?: string | null
}

function money(set?: MoneySet | null) {
  const m = set?.shopMoney
  if (!m?.amount) return null
  return { amount: m.amount, currencyCode: m.currencyCode || 'INR' }
}

function address(a?: GqlAddress | null) {
  if (!a) return null
  const name = (a.name || [a.firstName, a.lastName].filter(Boolean).join(' ')).trim()
  return {
    name: name || null,
    company: a.company?.trim() || null,
    address1: a.address1?.trim() || null,
    address2: a.address2?.trim() || null,
    city: a.city?.trim() || null,
    province: a.province?.trim() || null,
    zip: a.zip?.trim() || null,
    country: a.country?.trim() || null,
    phone: a.phone?.trim() || null,
  }
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

  let body: { shopifyOrderId?: string }
  try {
    body = await req.json()
  } catch {
    return err('Invalid JSON')
  }

  const shopifyOrderId = String(body.shopifyOrderId ?? '').trim()
  if (!shopifyOrderId) return err('shopifyOrderId required')

  try {
    const cfg = await loadShopifyConfig()
    const data = await shopifyGraphql<{
      shop: { name: string }
      order: {
        id: string
        name: string
        createdAt: string
        cancelledAt?: string | null
        displayFinancialStatus?: string | null
        displayFulfillmentStatus?: string | null
        note?: string | null
        tags?: string[]
        email?: string | null
        phone?: string | null
        paymentGatewayNames?: string[]
        totalPriceSet?: MoneySet
        subtotalPriceSet?: MoneySet
        totalShippingPriceSet?: MoneySet
        totalDiscountsSet?: MoneySet
        customer?: { firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null } | null
        shippingAddress?: GqlAddress | null
        billingAddress?: GqlAddress | null
        shippingLine?: { title?: string | null } | null
        lineItems?: {
          nodes: Array<{
            name?: string | null
            sku?: string | null
            quantity?: number | null
            variantTitle?: string | null
            originalUnitPriceSet?: MoneySet
            discountedTotalSet?: MoneySet
          }>
        }
        fulfillments?: {
          nodes: Array<{
            status?: string | null
            createdAt?: string | null
            trackingInfo?: Array<{ company?: string | null; number?: string | null; url?: string | null }>
          }>
        }
      } | null
    }>(cfg, PACKING_SLIP_QUERY, { id: shopifyGid('Order', shopifyOrderId) })

    if (!data.order) return err('Order not found in Shopify', 404)

    const o = data.order
    const customerName = [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(' ').trim()
    const tags = (o.tags ?? []).map((t) => String(t).trim()).filter(Boolean)
    const isCod = tags.some((t) => t.toUpperCase() === 'COD')
      || (o.displayFinancialStatus || '').toUpperCase() === 'PENDING'
      || (o.paymentGatewayNames ?? []).some((g) => /cod|cash on delivery/i.test(g))

    return json({
      generated: true,
      generatedAt: new Date().toISOString(),
      shop: { name: data.shop?.name || cfg.shopDomain, domain: cfg.shopDomain },
      order: {
        id: shopifyOrderId,
        name: o.name,
        createdAt: o.createdAt,
        cancelled: Boolean(o.cancelledAt),
        financialStatus: o.displayFinancialStatus || null,
        fulfillmentStatus: o.displayFulfillmentStatus || null,
        note: o.note?.trim() || null,
        tags,
        email: o.email || o.customer?.email || null,
        phone: o.phone || o.shippingAddress?.phone || o.customer?.phone || null,
        customerName: customerName || o.shippingAddress?.name || null,
        isCod,
        totals: {
          subtotal: money(o.subtotalPriceSet),
          shipping: money(o.totalShippingPriceSet),
          discounts: money(o.totalDiscountsSet),
          total: money(o.totalPriceSet),
        },
        shippingMethod: o.shippingLine?.title || null,
        shippingAddress: address(o.shippingAddress),
        billingAddress: address(o.billingAddress),
        lineItems: (o.lineItems?.nodes ?? []).map((li) => ({
          name: li.name || 'Item',
          sku: li.sku || null,
          quantity: li.quantity || 1,
          variantTitle: li.variantTitle && li.variantTitle !== 'Default Title' ? li.variantTitle : null,
          unitPrice: money(li.originalUnitPriceSet),
          lineTotal: money(li.discountedTotalSet),
        })),
        fulfillments: (o.fulfillments?.nodes ?? []).map((f) => ({
          status: f.status || null,
          createdAt: f.createdAt || null,
          tracking: (f.trackingInfo ?? []).map((t) => ({
            company: t.company || null,
            number: t.number || null,
            url: t.url || null,
          })),
        })),
      },
    })
  } catch (e) {
    return err((e as Error).message, 500)
  }
})
