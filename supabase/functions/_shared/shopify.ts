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
  const searchQ = queryParts.join(' OR ')

  try {
    const data = await shopifyGraphql<{
      customers: {
        nodes: Array<{
          id: string
          firstName?: string | null
          lastName?: string | null
          email?: string | null
          phone?: string | null
          defaultAddress?: {
            address1?: string
            address2?: string
            city?: string
            province?: string
            zip?: string
            countryCodeV2?: string
            country?: string
            firstName?: string
            lastName?: string
            phone?: string
          } | null
        }>
      }
    }>(cfg, `#graphql
      query CustomerSearch($q: String!) {
        customers(first: 5, query: $q) {
          nodes {
            id firstName lastName email phone
            defaultAddress { address1 address2 city province zip countryCodeV2 country firstName lastName phone }
          }
        }
      }
    `, { q: searchQ })
    const node = data.customers?.nodes?.[0]
    if (!node) return null
    const numericId = Number(fromShopifyGid(node.id))
    const addr = node.defaultAddress
    return {
      id: Number.isFinite(numericId) ? numericId : 0,
      first_name: node.firstName ?? undefined,
      last_name: node.lastName ?? undefined,
      email: node.email ?? undefined,
      phone: node.phone ?? undefined,
      default_address: addr
        ? {
            address1: addr.address1,
            address2: addr.address2,
            city: addr.city,
            province: addr.province,
            zip: addr.zip,
            country_code: addr.countryCodeV2,
            country: addr.country,
            first_name: addr.firstName,
            last_name: addr.lastName,
            phone: addr.phone,
          }
        : undefined,
    }
  } catch (e) {
    console.warn('GraphQL customer search failed, falling back to REST', e)
  }

  const { data } = await shopifyFetch<{ customers: ShopifyCustomer[] }>(
    cfg,
    `/customers/search.json?query=${encodeURIComponent(searchQ)}`,
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
    apiVersion: resolveApiVersion(raw.apiVersion),
  }
}

/** Current stable Admin API version (Aug 2026). 2024-10 is past Shopify's 12-month window. */
export const SHOPIFY_API_VERSION = '2026-07'

function resolveApiVersion(raw?: string): string {
  const v = (raw ?? '').trim()
  const m = v.match(/^(\d{4})-(\d{2})$/)
  if (!m) return SHOPIFY_API_VERSION
  const year = Number(m[1])
  const month = Number(m[2])
  // As of Aug 2026, versions older than 2025-10 are unsupported (404 / odd 403s).
  if (year < 2025 || (year === 2025 && month < 10)) return SHOPIFY_API_VERSION
  return v
}

export function shopifyGid(resource: string, id: number | string): string {
  const raw = String(id)
  if (raw.startsWith('gid://')) return raw
  return `gid://shopify/${resource}/${raw}`
}

export function fromShopifyGid(gid: string | null | undefined): string | null {
  if (!gid) return null
  const id = gid.split('/').pop()
  return id || null
}

/** ISO 3166-2 codes Shopify GraphQL expects for Indian provinceCode. */
const IN_PROVINCE_CODES: Record<string, string> = {
  'andaman and nicobar islands': 'AN',
  'andhra pradesh': 'AP',
  'arunachal pradesh': 'AR',
  assam: 'AS',
  bihar: 'BR',
  chandigarh: 'CH',
  chhattisgarh: 'CG',
  'dadra and nagar haveli and daman and diu': 'DH',
  'daman and diu': 'DH',
  delhi: 'DL',
  'nct of delhi': 'DL',
  goa: 'GA',
  gujarat: 'GJ',
  haryana: 'HR',
  'himachal pradesh': 'HP',
  'jammu and kashmir': 'JK',
  jharkhand: 'JH',
  karnataka: 'KA',
  kerala: 'KL',
  ladakh: 'LA',
  lakshadweep: 'LD',
  'madhya pradesh': 'MP',
  maharashtra: 'MH',
  manipur: 'MN',
  meghalaya: 'ML',
  mizoram: 'MZ',
  nagaland: 'NL',
  odisha: 'OR',
  orissa: 'OR',
  puducherry: 'PY',
  pondicherry: 'PY',
  punjab: 'PB',
  rajasthan: 'RJ',
  sikkim: 'SK',
  'tamil nadu': 'TN',
  telangana: 'TS',
  tripura: 'TR',
  'uttar pradesh': 'UP',
  uttarakhand: 'UT',
  uttaranchal: 'UT',
  'west bengal': 'WB',
}

export function toGraphqlMailingAddress(
  customer: OrderCustomerDto,
  phoneE164: string,
): Record<string, string> {
  const first = (customer.firstName || '').trim() || 'Customer'
  const last = (customer.lastName || '').trim() || '.'
  const countryRaw = (customer.country || 'IN').trim()
  const upper = countryRaw.toUpperCase()
  const isIN = upper === 'IN' || upper === 'INDIA'
  const addr: Record<string, string> = {
    firstName: first,
    lastName: last,
    address1: (customer.address1 || '').trim(),
    city: (customer.city || '').trim(),
    zip: (customer.zip || '').trim(),
    phone: phoneE164,
    countryCode: isIN ? 'IN' : upper.slice(0, 2),
  }
  const address2 = (customer.address2 || '').trim()
  if (address2) addr.address2 = address2
  const province = (customer.province || '').trim()
  if (province) {
    if (isIN) {
      const code = IN_PROVINCE_CODES[province.toLowerCase()] || (province.length <= 3 ? province.toUpperCase() : '')
      if (code) addr.provinceCode = code
    } else if (province.length <= 3) {
      addr.provinceCode = province.toUpperCase()
    }
  }
  return addr
}

function shopifyErrorMessage(status: number, body: unknown, text: string, where: string): string {
  const errMsg =
    (body as { errors?: unknown })?.errors != null
      ? JSON.stringify((body as { errors: unknown }).errors)
      : text || `HTTP ${status}`
  const hint =
    status === 403
      ? ' Confirm the app has write_orders, is installed on this shop, and the store plan is active. After changing scopes, reinstall the app. Dev Dashboard apps should create orders via GraphQL (not REST POST /orders.json).'
      : ''
  return `Shopify ${status} on ${where}: ${errMsg}.${hint}`
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
    throw new Error(shopifyErrorMessage(res.status, body, text, path))
  }
  return { data: body as T, link: res.headers.get('link') }
}

export async function shopifyGraphql<T = Record<string, unknown>>(
  cfg: ShopifyConfig,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const token = await getAccessToken(cfg)
  const res = await fetch(`${shopifyBase(cfg)}/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text }
  }
  if (!res.ok) {
    if (res.status === 401) tokenCache = null
    throw new Error(shopifyErrorMessage(res.status, body, text, 'graphql.json'))
  }
  const json = body as { data?: T; errors?: { message: string }[] }
  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL: ${json.errors.map((e) => e.message).join('; ')}`)
  }
  if (!json.data) throw new Error('Shopify GraphQL: empty response')
  return json.data
}

export async function shopifyAccessScopeHandles(cfg: ShopifyConfig): Promise<string[]> {
  try {
    const data = await shopifyGraphql<{
      currentAppInstallation: { accessScopes: { handle: string }[] }
    }>(cfg, `query { currentAppInstallation { accessScopes { handle } } }`)
    return data.currentAppInstallation?.accessScopes?.map((s) => s.handle) ?? []
  } catch {
    return []
  }
}

/** Parse Shopify Link header for next page URL */
export function nextLinkFromHeader(link: string | null): string | null {
  if (!link) return null
  const match = link.split(',').map((p) => p.trim()).find((p) => p.includes('rel="next"'))
  if (!match) return null
  const urlMatch = match.match(/<([^>]+)>/)
  return urlMatch?.[1] ?? null
}
