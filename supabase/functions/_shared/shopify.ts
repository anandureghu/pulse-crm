import { makeServiceClient } from './supabase.ts'

export interface ShopifyConfig {
  shopDomain: string
  clientId: string
  clientSecret: string
  apiVersion: string
  /** Legacy static token (pre–Dev Dashboard). Used only if client credentials are missing. */
  accessToken?: string
}

export interface CachedVariant {
  variantId: number
  productId: number
  title: string
  variantTitle: string
  sku: string
  price: string
  currency: string
}

export interface ShopifyProductsCache {
  byPrice: Record<string, CachedVariant[]>
  syncedAt: string | null
  rawCount: number
}

export interface OrderCustomerDto {
  firstName: string
  lastName: string
  phone: string
  email?: string | null
  address1: string
  address2?: string | null
  city: string
  province?: string | null
  zip: string
  country: string
}

export interface OrderDto {
  customer: OrderCustomerDto
  amount: number
  quantity: number
  tags: string[]
  note?: string | null
  financialStatus?: 'pending' | 'paid'
  shippingLines?: { title: string; price: string }[] | null
}

type TokenCache = { shop: string; token: string; expiresAt: number }
let tokenCache: TokenCache | null = null

export function normalizePriceKey(amount: number | string): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount
  if (Number.isNaN(n)) return '0.00'
  return n.toFixed(2)
}

export function normalizePhoneDigits(phone: string): string {
  return phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')
}

export async function loadShopifyConfig(): Promise<ShopifyConfig> {
  const supabase = makeServiceClient()
  const { data, error } = await supabase.from('settings').select('value').eq('key', 'shopify_config').single()
  if (error || !data?.value) throw new Error('Shopify not configured in Settings')
  const raw = data.value as Record<string, string>
  const shopDomain = (raw.shopDomain ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '')
  const clientId = (raw.clientId ?? '').trim()
  const clientSecret = (raw.clientSecret ?? '').trim()
  const accessToken = (raw.accessToken ?? '').trim()
  if (!shopDomain) throw new Error('Shopify shop domain required in Settings')
  if (!clientId && !clientSecret && !accessToken) {
    throw new Error('Shopify Client ID + Client secret required in Settings (Dev Dashboard → Settings)')
  }
  if ((clientId && !clientSecret) || (!clientId && clientSecret)) {
    throw new Error('Both Shopify Client ID and Client secret are required')
  }
  return {
    shopDomain,
    clientId,
    clientSecret,
    accessToken: accessToken || undefined,
    apiVersion: raw.apiVersion || '2024-10',
  }
}

/** Exchange client credentials for a short-lived Admin API token (~24h). */
export async function getAccessToken(cfg: ShopifyConfig): Promise<string> {
  if (cfg.clientId && cfg.clientSecret) {
    const now = Date.now()
    if (
      tokenCache
      && tokenCache.shop === cfg.shopDomain
      && tokenCache.expiresAt > now + 60_000
    ) {
      return tokenCache.token
    }

    const res = await fetch(`https://${cfg.shopDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
      }),
    })
    const body = await res.json().catch(() => ({})) as {
      access_token?: string
      expires_in?: number
      error?: string
      error_description?: string
    }
    if (!res.ok || !body.access_token) {
      const msg = body.error_description || body.error || JSON.stringify(body) || res.statusText
      throw new Error(`Shopify auth failed: ${msg}`)
    }
    const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 86_400
    tokenCache = {
      shop: cfg.shopDomain,
      token: body.access_token,
      expiresAt: now + expiresIn * 1000,
    }
    return body.access_token
  }

  if (cfg.accessToken) return cfg.accessToken
  throw new Error('Shopify credentials missing')
}

function shopifyBase(cfg: ShopifyConfig): string {
  return `https://${cfg.shopDomain}/admin/api/${cfg.apiVersion}`
}

export async function shopifyFetch<T = unknown>(
  cfg: ShopifyConfig,
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; link: string | null }> {
  const token = await getAccessToken(cfg)
  const url = path.startsWith('http') ? path : `${shopifyBase(cfg)}${path}`
  const res = await fetch(url, {
    ...init,
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text }
  }
  if (!res.ok) {
    // Token may have been revoked — clear cache so next call re-auths
    if (res.status === 401) tokenCache = null
    const errMsg =
      (body as { errors?: unknown })?.errors != null
        ? JSON.stringify((body as { errors: unknown }).errors)
        : text || res.statusText
    throw new Error(`Shopify ${res.status}: ${errMsg}`)
  }
  return { data: body as T, link: res.headers.get('link') }
}

/** Parse Shopify Link header for next page URL */
export function nextLinkFromHeader(link: string | null): string | null {
  if (!link) return null
  const match = link.split(',').map((p) => p.trim()).find((p) => p.includes('rel="next"'))
  if (!match) return null
  const urlMatch = match.match(/<([^>]+)>/)
  return urlMatch?.[1] ?? null
}
