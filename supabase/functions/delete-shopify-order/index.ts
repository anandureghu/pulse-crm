import { makeServiceClient, cors, json, err } from '../_shared/supabase.ts'
import { loadShopifyConfig, shopifyFetch } from '../_shared/shopify.ts'

interface DeleteBody {
  /** Local shopify_orders.id */
  id?: string
  /** Shopify order id */
  shopifyOrderId?: string
  /** If true, permanently delete in Shopify after cancel. Default: cancel only. */
  hardDelete?: boolean
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

  let body: DeleteBody
  try {
    body = await req.json()
  } catch {
    return err('Invalid JSON')
  }

  if (!body.id && !body.shopifyOrderId) return err('id or shopifyOrderId required')

  let query = supabase
    .from('shopify_orders')
    .select('id, shopify_order_id, shopify_order_name')

  if (body.id) query = query.eq('id', body.id)
  else query = query.eq('shopify_order_id', body.shopifyOrderId!)

  const { data: row, error: findErr } = await query.maybeSingle()
  if (findErr) return err(findErr.message, 500)
  if (!row) return err('Order not found', 404)

  try {
    const cfg = await loadShopifyConfig()

    if (row.shopify_order_id) {
      // Cancel first (idempotent if already cancelled)
      try {
        await shopifyFetch(cfg, `/orders/${row.shopify_order_id}/cancel.json`, {
          method: 'POST',
          body: JSON.stringify({ reason: 'other', email: false }),
        })
      } catch (e) {
        const msg = (e as Error).message
        // Already cancelled / closed — still remove from local mirror
        if (!/already|cancelled|422/i.test(msg)) {
          console.warn('Shopify cancel warning:', msg)
        }
      }

      if (body.hardDelete) {
        try {
          await shopifyFetch(cfg, `/orders/${row.shopify_order_id}.json`, {
            method: 'DELETE',
          })
        } catch (e) {
          console.warn('Shopify hard delete warning:', (e as Error).message)
        }
      }
    }

    const { error: delErr } = await supabase.from('shopify_orders').delete().eq('id', row.id)
    if (delErr) return err(delErr.message, 500)

    return json({
      ok: true,
      id: row.id,
      shopifyOrderId: row.shopify_order_id,
      orderName: row.shopify_order_name,
    })
  } catch (e) {
    return err((e as Error).message, 500)
  }
})
