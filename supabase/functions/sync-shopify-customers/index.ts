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

/** Local 10-digit or 12-digit 91… from Shopify; null if unusable. */
function customerPhone(c: ShopifyCustomer): string | null {
  const raw =
    c.phone
    || c.default_address?.phone
    || c.addresses?.find((a) => a.phone)?.phone
    || ''
  const digits = normalizePhoneDigits(raw)
  return digits.length >= 8 ? digits : null
}

function toStoredPhone(digits: string): string {
  if (digits.length === 10) return `91${digits}`
  if (digits.length === 12 && digits.startsWith('91')) return digits
  if (digits.length > 10 && digits.startsWith('91')) return digits.slice(0, 12)
  return digits.length === 10 ? `91${digits}` : digits
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
        const phoneStored = toStoredPhone(phone)
        const name = customerName(c)
        const email = c.email?.trim() || null
        const shopifyId = String(c.id)

        const { data: byShopify } = await supabase
          .from('customers')
          .select('id')
          .eq('shopify_customer_id', shopifyId)
          .maybeSingle()

        let existingId = byShopify?.id as string | undefined
        if (!existingId) {
          const candidates = [phoneStored]
          if (phoneStored.startsWith('91') && phoneStored.length === 12) {
            candidates.push(phoneStored.slice(2))
          }
          for (const p of candidates) {
            const { data: hit } = await supabase.from('customers').select('id').eq('phone', p).maybeSingle()
            if (hit?.id) {
              existingId = hit.id
              break
            }
          }
        }

        if (existingId) {
          const { data: existing } = await supabase
            .from('customers')
            .select('tags')
            .eq('id', existingId)
            .maybeSingle()
          const tags = Array.isArray(existing?.tags) ? [...existing.tags as string[]] : []
          if (!tags.map((t) => t.toLowerCase()).includes('shopify')) tags.push('shopify')
          // Do not touch assigned_to — preserve CRM assignments
          await supabase.from('customers').update({
            name,
            email,
            phone: phoneStored,
            shopify_customer_id: shopifyId,
            tags,
          }).eq('id', existingId)
        } else {
          await supabase.from('customers').insert({
            name,
            phone: phoneStored,
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
