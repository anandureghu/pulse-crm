import { makeServiceClient, cors, json, err } from '../_shared/supabase.ts'
import {
  loadShopifyConfig,
  shopifyGraphql,
  normalizePriceKey,
  fromShopifyGid,
  type CachedVariant,
  type ShopifyProductsCache,
} from '../_shared/shopify.ts'

interface GqlMetafield {
  namespace: string
  key: string
  value: string
}

interface GqlVariant {
  id: string
  title: string
  sku: string | null
  price: string
  compareAtPrice: string | null
  barcode: string | null
  inventoryQuantity: number | null
  selectedOptions: { name: string; value: string }[]
  metafields: { nodes: GqlMetafield[] }
}

interface GqlProduct {
  id: string
  title: string
  vendor: string | null
  productType: string | null
  handle: string | null
  status: string
  tags: string[]
  descriptionHtml: string | null
  metafields: { nodes: GqlMetafield[] }
  variants: { nodes: GqlVariant[] }
}

const PRODUCTS_QUERY = `#graphql
  query SyncProducts($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        vendor
        productType
        handle
        status
        tags
        descriptionHtml
        metafields(first: 50) {
          nodes { namespace key value }
        }
        variants(first: 100) {
          nodes {
            id
            title
            sku
            price
            compareAtPrice
            barcode
            inventoryQuantity
            selectedOptions { name value }
            metafields(first: 50) {
              nodes { namespace key value }
            }
          }
        }
      }
    }
  }
`

function metafieldsToRecord(
  nodes: GqlMetafield[],
  prefix: 'product' | 'variant',
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const mf of nodes) {
    out[`${prefix}.${mf.namespace}.${mf.key}`] = mf.value
  }
  return out
}

function stripHtml(html: string | null): string {
  if (!html) return ''
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
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
    const cfg = await loadShopifyConfig()
    const byPrice: Record<string, CachedVariant[]> = {}
    let rawCount = 0
    let cursor: string | null = null
    let hasNextPage = true

    while (hasNextPage) {
      const data = await shopifyGraphql<{
        products: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
          nodes: GqlProduct[]
        }
      }>(cfg, PRODUCTS_QUERY, { cursor })

      for (const product of data.products?.nodes ?? []) {
        const productId = Number(fromShopifyGid(product.id))
        const productMetafields = metafieldsToRecord(product.metafields?.nodes ?? [], 'product')

        for (const variant of product.variants?.nodes ?? []) {
          rawCount++
          const variantId = Number(fromShopifyGid(variant.id))
          const key = normalizePriceKey(variant.price)
          const variantMetafields = metafieldsToRecord(variant.metafields?.nodes ?? [], 'variant')
          const selected = variant.selectedOptions ?? []

          const entry: CachedVariant = {
            variantId,
            productId,
            title: product.title,
            variantTitle: variant.title,
            sku: variant.sku ?? '',
            price: normalizePriceKey(variant.price),
            currency: 'INR',
            vendor: product.vendor ?? undefined,
            productType: product.productType ?? undefined,
            handle: product.handle ?? undefined,
            status: product.status,
            tags: product.tags?.length ? product.tags : undefined,
            description: stripHtml(product.descriptionHtml) || undefined,
            compareAtPrice: variant.compareAtPrice
              ? normalizePriceKey(variant.compareAtPrice)
              : undefined,
            barcode: variant.barcode ?? undefined,
            inventoryQuantity: variant.inventoryQuantity ?? undefined,
            option1: selected[0]?.value,
            option2: selected[1]?.value,
            option3: selected[2]?.value,
            metafields: Object.keys({ ...productMetafields, ...variantMetafields }).length
              ? { ...productMetafields, ...variantMetafields }
              : undefined,
          }

          if (!byPrice[key]) byPrice[key] = []
          byPrice[key].push(entry)
        }
      }

      hasNextPage = data.products?.pageInfo?.hasNextPage ?? false
      cursor = data.products?.pageInfo?.endCursor ?? null
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
