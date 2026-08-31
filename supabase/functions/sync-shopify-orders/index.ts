import { makeServiceClient, cors, json, err } from '../_shared/supabase.ts'
import {
  loadShopifyConfig,
  shopifyFetch,
  nextLinkFromHeader,
  normalizePhoneDigits,
} from '../_shared/shopify.ts'

interface ShopifyOrder {
  id: number
  name: string
  email?: string | null
  total_price?: string
  tags?: string
  created_at?: string
  cancelled_at?: string | null
  financial_status?: string
  customer?: {
    id?: number
    first_name?: string
    last_name?: string
    email?: string | null
    phone?: string | null
  } | null
  shipping_address?: {
    first_name?: string
    last_name?: string
    phone?: string
  } | null
  billing_address?: {
    first_name?: string
    last_name?: string
    phone?: string
  } | null
}

function orderCustomerName(o: ShopifyOrder): string {
  const c = o.customer
  const fromCustomer = [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim()
  if (fromCustomer) return fromCustomer
  const ship = [o.shipping_address?.first_name, o.shipping_address?.last_name].filter(Boolean).join(' ').trim()
  if (ship) return ship
  const bill = [o.billing_address?.first_name, o.billing_address?.last_name].filter(Boolean).join(' ').trim()
  return bill || o.email || '—'
}

function orderPhone(o: ShopifyOrder): string | null {
  const raw =
    o.shipping_address?.phone
    || o.billing_address?.phone
    || o.customer?.phone
    || ''
  const digits = normalizePhoneDigits(raw)
  return digits.length >= 8 ? digits : null
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

  try {
    let body: { instanceId?: string; organizationId?: string } = {}
    try { body = await req.json() } catch { /* empty body ok for legacy */ }
    const instanceId = body.instanceId
    const organizationId = body.organizationId
    if (!instanceId || !organizationId) {
      return err('instanceId and organizationId required', 400)
    }

    const cfg = await loadShopifyConfig(instanceId)
    let nextUrl: string | null =
      '/orders.json?status=any&limit=250&fields=id,name,email,total_price,tags,created_at,cancelled_at,financial_status,customer,shipping_address,billing_address'
    let synced = 0
    let removed = 0
    const seenIds = new Set<string>()

    while (nextUrl) {
      const { data, link } = await shopifyFetch<{ orders: ShopifyOrder[] }>(cfg, nextUrl)
      for (const o of data.orders ?? []) {
        const shopifyOrderId = String(o.id)
        seenIds.add(shopifyOrderId)

        // Cancelled/deleted in Shopify should not appear in CRM listing
        if (o.cancelled_at) {
          await supabase
            .from('shopify_orders')
            .delete()
            .eq('instance_id', instanceId)
            .eq('shopify_order_id', shopifyOrderId)
          removed++
          continue
        }

        const tags = (o.tags || '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
        const customerName = orderCustomerName(o)
        const phone = orderPhone(o)
        const email = o.email || o.customer?.email || null
        const amount = o.total_price != null ? Number(o.total_price) : null
        const shopifyCustomerId = o.customer?.id != null ? String(o.customer.id) : null

        const { data: existing } = await supabase
          .from('shopify_orders')
          .select('id')
          .eq('instance_id', instanceId)
          .eq('shopify_order_id', shopifyOrderId)
          .maybeSingle()

        const row = {
          shopify_order_id: shopifyOrderId,
          shopify_order_name: o.name,
          shopify_customer_id: shopifyCustomerId,
          customer_name: customerName,
          phone,
          email,
          amount,
          tags,
          status: 'created' as const,
          error: null,
          prompt: null,
          parsed_dto: null,
          organization_id: organizationId,
          instance_id: instanceId,
        }

        if (existing) {
          await supabase.from('shopify_orders').update(row).eq('id', existing.id)
        } else {
          await supabase.from('shopify_orders').insert({
            ...row,
            created_by: user.id,
            created_at: o.created_at || new Date().toISOString(),
          })
        }
        synced++
      }
      nextUrl = nextLinkFromHeader(link)
    }

    // Drop local rows for this instance that no longer exist in Shopify
    const { data: localRows } = await supabase
      .from('shopify_orders')
      .select('id, shopify_order_id')
      .eq('instance_id', instanceId)

    for (const row of localRows ?? []) {
      if (!row.shopify_order_id || !seenIds.has(row.shopify_order_id)) {
        await supabase.from('shopify_orders').delete().eq('id', row.id)
        removed++
      }
    }

    return json({ ok: true, synced, removed })
  } catch (e) {
    return err((e as Error).message, 500)
  }
})
