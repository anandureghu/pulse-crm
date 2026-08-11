import { makeServiceClient, cors, json, err } from '../_shared/supabase.ts'
import { loadShopifyConfig, shopifyFetch, normalizePhoneDigits } from '../_shared/shopify.ts'

interface UpdateBody {
  /** Local shopify_orders.id */
  id?: string
  /** Shopify order id (preferred when known) */
  shopifyOrderId?: string
  tags?: string[]
  note?: string | null
  email?: string | null
  customerName?: string | null
  phone?: string | null
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

  let body: UpdateBody
  try {
    body = await req.json()
  } catch {
    return err('Invalid JSON')
  }

  if (!body.id && !body.shopifyOrderId) return err('id or shopifyOrderId required')

  let query = supabase
    .from('shopify_orders')
    .select('id, shopify_order_id, shopify_order_name, tags, email, customer_name, phone')

  if (body.id) query = query.eq('id', body.id)
  else query = query.eq('shopify_order_id', body.shopifyOrderId!)

  const { data: row, error: findErr } = await query.maybeSingle()
  if (findErr) return err(findErr.message, 500)
  if (!row?.shopify_order_id) return err('Order not found or not synced from Shopify', 404)

  const tags = body.tags !== undefined
    ? body.tags.map((t) => String(t).trim()).filter(Boolean)
    : (row.tags ?? [])
  const email = body.email !== undefined ? (body.email?.trim() || null) : row.email
  const customerName = body.customerName !== undefined
    ? (body.customerName?.trim() || null)
    : row.customer_name
  const phone = body.phone !== undefined
    ? (body.phone ? normalizePhoneDigits(body.phone) : null)
    : row.phone

  try {
    const cfg = await loadShopifyConfig()
    const orderPatch: Record<string, unknown> = {
      id: Number(row.shopify_order_id),
      tags: tags.join(', '),
      email: email || undefined,
    }
    if (body.note !== undefined) {
      orderPatch.note = body.note?.trim() || ''
    }

    await shopifyFetch(cfg, `/orders/${row.shopify_order_id}.json`, {
      method: 'PUT',
      body: JSON.stringify({ order: orderPatch }),
    })

    const { error: updErr } = await supabase
      .from('shopify_orders')
      .update({
        tags,
        email,
        customer_name: customerName,
        phone,
        status: 'created',
        error: null,
      })
      .eq('id', row.id)

    if (updErr) return err(updErr.message, 500)

    return json({
      ok: true,
      id: row.id,
      shopifyOrderId: row.shopify_order_id,
      orderName: row.shopify_order_name,
      tags,
      email,
      customerName,
      phone,
    })
  } catch (e) {
    return err((e as Error).message, 500)
  }
})
