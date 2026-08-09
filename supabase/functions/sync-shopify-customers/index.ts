import { makeServiceClient, cors, json, err } from '../_shared/supabase.ts'
import {
  loadShopifyConfig,
  shopifyFetch,
  nextLinkFromHeader,
  normalizePhoneDigits,
} from '../_shared/shopify.ts'

interface ShopifyAddress {
  address1?: string
  city?: string
  phone?: string
}

interface ShopifyCustomer {
  id: number
  first_name?: string
  last_name?: string
  email?: string | null
  phone?: string | null
  default_address?: ShopifyAddress
  addresses?: ShopifyAddress[]
}

function customerName(c: ShopifyCustomer): string {
  const n = [c.first_name, c.last_name].filter(Boolean).join(' ').trim()
  return n || c.email || c.phone || `Shopify ${c.id}`
}

function customerPhone(c: ShopifyCustomer): string | null {
  const raw =
    c.phone
    || c.default_address?.phone
    || c.addresses?.find((a) => a.phone)?.phone
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
    const cfg = await loadShopifyConfig()
    let nextUrl: string | null =
      '/customers.json?limit=250&fields=id,first_name,last_name,email,phone,default_address,addresses'
    let synced = 0
    let skipped = 0

    while (nextUrl) {
      const { data, link } = await shopifyFetch<{ customers: ShopifyCustomer[] }>(cfg, nextUrl)
      for (const c of data.customers ?? []) {
        const phone = customerPhone(c)
        if (!phone) {
          skipped++
          continue
        }
        const name = customerName(c)
        const email = c.email?.trim() || null
        const shopifyId = String(c.id)

        const { data: byShopify } = await supabase
          .from('customers')
          .select('id')
          .eq('shopify_customer_id', shopifyId)
          .maybeSingle()

        const { data: byPhone } = byShopify
          ? { data: null }
          : await supabase.from('customers').select('id').eq('phone', phone).maybeSingle()

        const existingId = byShopify?.id ?? byPhone?.id
        if (existingId) {
          await supabase.from('customers').update({
            name,
            email,
            phone,
            shopify_customer_id: shopifyId,
          }).eq('id', existingId)
        } else {
          await supabase.from('customers').insert({
            name,
            phone,
            email,
            shopify_customer_id: shopifyId,
            assigned_to: null,
            tags: ['shopify'],
          })
        }
        synced++
      }
      nextUrl = nextLinkFromHeader(link)
    }

    return json({ ok: true, synced, skipped })
  } catch (e) {
    return err((e as Error).message, 500)
  }
})
