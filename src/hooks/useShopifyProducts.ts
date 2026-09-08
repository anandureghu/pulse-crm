import { useEffect, useMemo, useState } from 'react'
import {
  flattenProductCache,
  groupCatalogProducts,
  loadShopifyProductCache,
  matchesProductQuery,
  type GroupedCatalogProduct,
} from '../lib/shopifyProducts'
import type { CatalogVariant } from '../types'

export function useShopifyProducts(query = '') {
  const [variants, setVariants] = useState<CatalogVariant[]>([])
  const [syncedAt, setSyncedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    loadShopifyProductCache()
      .then((cache) => {
        if (cancelled) return
        setVariants(flattenProductCache(cache))
        setSyncedAt(cache?.syncedAt ?? null)
      })
      .catch(() => {
        if (!cancelled) setVariants([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (q ? variants.filter((v) => matchesProductQuery(v, q)) : variants),
    [variants, q],
  )
  const grouped: GroupedCatalogProduct[] = useMemo(
    () => groupCatalogProducts(filtered),
    [filtered],
  )

  return { variants: filtered, grouped, allVariants: variants, syncedAt, loading }
}
