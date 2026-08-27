import { makeServiceClient, cors, json, err } from '../_shared/supabase.ts'
import {
  loadShopifyConfig,
  shopifyFetch,
  nextLinkFromHeader,
  normalizePriceKey,
  type CachedVariant,
  type ShopifyProductsCache,
} from '../_shared/shopify.ts'

interface ShopifyVariant {
  id: number
  title: string
  sku: string | null
  price: string
}

interface ShopifyProduct {
  id: number
  title: string
  variants: ShopifyVariant[]
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
    let body: { instanceId?: string } = {}
    try { body = await req.json() } catch { /* optional */ }
    const cfg = await loadShopifyConfig(body.instanceId)
    const byPrice: Record<string, CachedVariant[]> = {}
    let rawCount = 0
    let nextUrl: string | null = `/products.json?limit=250&fields=id,title,variants`

    while (nextUrl) {
      const { data, link } = await shopifyFetch<{ products: ShopifyProduct[] }>(cfg, nextUrl)
      for (const product of data.products ?? []) {
        for (const variant of product.variants ?? []) {
          rawCount++
          const key = normalizePriceKey(variant.price)
          const entry: CachedVariant = {
            variantId: variant.id,
            productId: product.id,
            title: product.title,
            variantTitle: variant.title,
            sku: variant.sku ?? '',
            price: normalizePriceKey(variant.price),
            currency: 'INR',
          }
          if (!byPrice[key]) byPrice[key] = []
          byPrice[key].push(entry)
        }
      }
      nextUrl = nextLinkFromHeader(link)
    }

    const cache: ShopifyProductsCache = {
      byPrice,
      syncedAt: new Date().toISOString(),
      rawCount,
    }

    const { error: upsertErr } = await supabase.from('settings').upsert({
      key: 'shopify_products',
      value: cache,
      updated_at: new Date().toISOString(),
    })
    if (upsertErr) return err(upsertErr.message, 500)

    return json({
      ok: true,
      rawCount,
      priceBuckets: Object.keys(byPrice).length,
      syncedAt: cache.syncedAt,
    })
  } catch (e) {
    return err((e as Error).message, 500)
  }
})
