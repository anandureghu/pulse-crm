import { supabase } from './supabase'
import type { CatalogVariant, SendableProduct } from '../types'

interface CachedVariant {
  variantId: number
  productId: number
  title: string
  variantTitle: string
  sku: string
  price: string
  currency: string
  imageUrl?: string
  handle?: string
}

interface ShopifyProductsCache {
  byPrice: Record<string, CachedVariant[]>
  syncedAt: string | null
  rawCount: number
  shopDomain?: string
}

export interface GroupedCatalogProduct {
  productId: number
  title: string
  handle: string
  imageUrl: string
  productUrl: string
  variants: CatalogVariant[]
}

function productUrl(shopDomain: string | undefined, handle: string | undefined): string {
  if (!shopDomain || !handle) return ''
  const host = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return `https://${host}/products/${handle}`
}

export function flattenProductCache(cache: ShopifyProductsCache | null): CatalogVariant[] {
  if (!cache?.byPrice) return []
  const shopDomain = cache.shopDomain
  const map = new Map<number, CatalogVariant>()
  for (const variants of Object.values(cache.byPrice)) {
    for (const v of variants) {
      map.set(v.variantId, {
        variantId: v.variantId,
        productId: v.productId,
        title: v.title,
        variantTitle: v.variantTitle,
        sku: v.sku ?? '',
        price: v.price,
        currency: v.currency || 'INR',
        imageUrl: v.imageUrl ?? '',
        handle: v.handle ?? '',
        productUrl: productUrl(shopDomain, v.handle),
      })
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.title.localeCompare(b.title) || Number(a.price) - Number(b.price),
  )
}

export function groupCatalogProducts(variants: CatalogVariant[]): GroupedCatalogProduct[] {
  const map = new Map<number, GroupedCatalogProduct>()
  for (const v of variants) {
    const existing = map.get(v.productId)
    if (existing) {
      existing.variants.push(v)
      if (!existing.imageUrl && v.imageUrl) existing.imageUrl = v.imageUrl
      continue
    }
    map.set(v.productId, {
      productId: v.productId,
      title: v.title,
      handle: v.handle,
      imageUrl: v.imageUrl,
      productUrl: v.productUrl,
      variants: [v],
    })
  }
  return Array.from(map.values())
}

export function formatInr(price: string | null | undefined): string {
  if (!price) return ''
  const n = Number(price)
  if (Number.isNaN(n)) return `₹${price}`
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

export function formatProductCaption(p: SendableProduct): string {
  if (p.body?.trim()) return p.body.trim()
  const lines: string[] = [`*${p.title}*`]
  if (p.variantTitle && p.variantTitle !== 'Default Title') lines.push(p.variantTitle)
  if (p.price) lines.push(formatInr(p.price))
  if (p.sku) lines.push(`SKU: ${p.sku}`)
  if (p.productUrl) lines.push(p.productUrl)
  return lines.join('\n')
}

export async function loadShopifyProductCache(): Promise<ShopifyProductsCache | null> {
  const { data } = await supabase.from('settings').select('value').eq('key', 'shopify_products').maybeSingle()
  if (!data?.value) return null
  return data.value as unknown as ShopifyProductsCache
}

export function matchesProductQuery(v: CatalogVariant, q: string): boolean {
  if (!q) return true
  const hay = `${v.title} ${v.variantTitle} ${v.sku} ${v.price}`.toLowerCase()
  return hay.includes(q)
}
