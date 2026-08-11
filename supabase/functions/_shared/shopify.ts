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

/** One product line from the prompt (matched to Shopify by unit price). */
export interface OrderLineItemDto {
  amount: number
  quantity: number
  hint?: string | null
}

/** Order-level discount applied when creating the Shopify order. */
export interface OrderDiscountDto {
  /** Fixed rupees off, or percentage value (e.g. 10 for 10%). */
  amount: number
  type: 'fixed_amount' | 'percentage'
  /** Shown as the discount code label in Shopify (optional). */
  code?: string | null
}

export interface OrderDto {
  customer: OrderCustomerDto
  /** Product lines — one or more. Prefer this over legacy quantity. */
  lineItems: OrderLineItemDto[]
  /** Order total after discount (sum of lines + shipping − discount). */
  amount: number
  /** @deprecated use lineItems[0].quantity — kept for older clients */
  quantity?: number
  tags: string[]
  note?: string | null
  financialStatus?: 'pending' | 'paid'
  shippingLines?: { title: string; price: string }[] | null
  /** Optional order-level discount (do not bake into line item prices). */
  discount?: OrderDiscountDto | null
}

export function normalizeDiscount(raw: unknown): OrderDiscountDto | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  const amount = Number(d.amount)
  if (Number.isNaN(amount) || amount <= 0) return null
  const typeRaw = String(d.type ?? 'fixed_amount').toLowerCase()
  const type: OrderDiscountDto['type'] =
    typeRaw === 'percentage' || typeRaw === 'percent' ? 'percentage' : 'fixed_amount'
  const code = typeof d.code === 'string' && d.code.trim() ? d.code.trim() : null
  return { amount, type, code }
}

/** Line subtotal + shipping, before discount. */
export function orderSubtotal(dto: Pick<OrderDto, 'lineItems' | 'shippingLines'>): number {
  const lines = (dto.lineItems ?? []).reduce((s, li) => s + Number(li.amount) * Math.max(1, Number(li.quantity) || 1), 0)
  const shipping = (dto.shippingLines ?? []).reduce((s, l) => s + (parseFloat(String(l.price)) || 0), 0)
  return lines + shipping
}

/** Rupees discounted from subtotal. */
export function discountRupees(subtotal: number, discount?: OrderDiscountDto | null): number {
  if (!discount || !(discount.amount > 0) || subtotal <= 0) return 0
  if (discount.type === 'percentage') {
    return Math.min(subtotal, (subtotal * discount.amount) / 100)
  }
  return Math.min(subtotal, discount.amount)
}

export function orderTotalAfterDiscount(dto: Pick<OrderDto, 'lineItems' | 'shippingLines' | 'discount'>): number {
  const sub = orderSubtotal(dto)
  return Math.max(0, Math.round((sub - discountRupees(sub, dto.discount)) * 100) / 100)
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

export function isAddressComplete(c: OrderCustomerDto): boolean {
  return Boolean(c.address1?.trim() && c.city?.trim() && c.zip?.trim())
}

/**
 * Build a Shopify mailing address. Shopify silently drops shipping_address /
 * billing_address on order create if first_name OR last_name is blank.
 */
export function toShopifyMailingAddress(
  customer: OrderCustomerDto,
  phoneE164: string,
): Record<string, string> {
  const first = (customer.firstName || '').trim() || 'Customer'
  // Empty last_name → Shopify ignores the entire address object
  const last = (customer.lastName || '').trim() || '.'

  const countryRaw = (customer.country || 'IN').trim()
  const upper = countryRaw.toUpperCase()
  const isIN = upper === 'IN' || upper === 'INDIA'

  const addr: Record<string, string> = {
    first_name: first,
    last_name: last,
    address1: (customer.address1 || '').trim(),
    city: (customer.city || '').trim(),
    zip: (customer.zip || '').trim(),
    phone: phoneE164,
    country: isIN ? 'India' : countryRaw,
    country_code: isIN ? 'IN' : upper.slice(0, 2),
  }
  const address2 = (customer.address2 || '').trim()
  if (address2) addr.address2 = address2
  const province = (customer.province || '').trim()
  if (province) addr.province = province
  return addr
}

interface ShopifyAddress {
  address1?: string
  address2?: string
  city?: string
  province?: string
  zip?: string
  country_code?: string
  country?: string
  first_name?: string
  last_name?: string
  phone?: string
  default?: boolean
}

interface ShopifyCustomer {
  id: number
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
  default_address?: ShopifyAddress
  addresses?: ShopifyAddress[]
}

/** Find Shopify customer by phone (and optionally email). */
export async function findShopifyCustomer(
  cfg: ShopifyConfig,
  phoneDigits: string,
  email?: string | null,
): Promise<ShopifyCustomer | null> {
  const queryParts: string[] = [`phone:${phoneDigits}`]
  if (email?.trim()) queryParts.push(`email:${email.trim()}`)
  const searchQ = encodeURIComponent(queryParts.join(' OR '))
  const { data } = await shopifyFetch<{ customers: ShopifyCustomer[] }>(
    cfg,
    `/customers/search.json?query=${searchQ}`,
  )
  return data.customers?.[0] ?? null
}

/**
 * Fill missing name/address fields from an existing Shopify customer.
 * Prompt values win when already present.
 */
export function mergeCustomerFromShopify(
  customer: OrderCustomerDto,
  shopify: ShopifyCustomer,
): OrderCustomerDto {
  const addr =
    shopify.default_address
    || shopify.addresses?.find((a) => a.default)
    || shopify.addresses?.[0]

  const country =
    customer.country?.trim()
    || addr?.country_code
    || (addr?.country === 'India' ? 'IN' : addr?.country)
    || 'IN'

  return {
    firstName: customer.firstName?.trim() || shopify.first_name || addr?.first_name || '',
    lastName: customer.lastName?.trim() || shopify.last_name || addr?.last_name || '',
    phone: customer.phone,
    email: customer.email?.trim() || shopify.email || null,
    address1: customer.address1?.trim() || addr?.address1 || '',
    address2: customer.address2?.trim() || addr?.address2 || null,
    city: customer.city?.trim() || addr?.city || '',
    province: customer.province?.trim() || addr?.province || null,
    zip: customer.zip?.trim() || addr?.zip || '',
    country,
  }
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
