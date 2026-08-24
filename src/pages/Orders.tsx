import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../components/Toast'
import { formatPhoneDisplay } from '../lib/phone'

interface CachedVariant {
  variantId: number
  productId: number
  title: string
  variantTitle: string
  sku: string
  price: string
  currency: string
}

interface ShopifyProductsCache {
  byPrice: Record<string, CachedVariant[]>
  syncedAt: string | null
  rawCount: number
}

interface OrderCustomerDto {
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

interface OrderLineItemDto {
  amount: number
  quantity: number
  hint?: string | null
}

interface OrderDiscountDto {
  amount: number
  type: 'fixed_amount' | 'percentage'
  code?: string | null
}

interface OrderDto {
  customer: OrderCustomerDto
  lineItems: OrderLineItemDto[]
  amount: number
  quantity?: number
  tags: string[]
  note?: string | null
  financialStatus?: 'pending' | 'paid'
  shippingLines?: { title: string; price: string }[] | null
  discount?: OrderDiscountDto | null
}

function lineSubtotal(lines: OrderLineItemDto[]): number {
  return lines.reduce((s, li) => s + li.amount * li.quantity, 0)
}

function discountOff(subtotal: number, discount?: OrderDiscountDto | null): number {
  if (!discount || !(discount.amount > 0) || subtotal <= 0) return 0
  if (discount.type === 'percentage') return Math.min(subtotal, (subtotal * discount.amount) / 100)
  return Math.min(subtotal, discount.amount)
}

function payableTotal(dto: OrderDto): number {
  const shipping = (dto.shippingLines ?? []).reduce((s, l) => s + (parseFloat(l.price) || 0), 0)
  const sub = lineSubtotal(dto.lineItems?.length ? dto.lineItems : [{ amount: dto.amount, quantity: 1, hint: null }]) + shipping
  return Math.max(0, Math.round((sub - discountOff(sub, dto.discount)) * 100) / 100)
}

interface ShopifyOrderRow {
  id: string
  shopify_order_id: string | null
  shopify_order_name: string | null
  customer_name: string | null
  phone: string | null
  email: string | null
  amount: number | null
  tags: string[] | null
  status: string
  error: string | null
  created_at: string
}

type Tab = 'create' | 'products' | 'orders'

const TABS: { id: Tab; label: string }[] = [
  { id: 'create', label: 'Create order' },
  { id: 'products', label: 'Products' },
  { id: 'orders', label: 'Orders' },
]

const ORDER_DRAFT_KEY = 'pulsrm_order_create_draft'

interface OrderCreateDraft {
  prompt: string
  dto: OrderDto | null
  tagsInput: string
  selectedByLine: (number | null)[]
}

function loadOrderDraft(): OrderCreateDraft | null {
  try {
    const raw = sessionStorage.getItem(ORDER_DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as OrderCreateDraft
    if (typeof parsed?.prompt !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

function saveOrderDraft(draft: OrderCreateDraft) {
  try {
    const empty = !draft.prompt.trim() && !draft.dto
    if (empty) sessionStorage.removeItem(ORDER_DRAFT_KEY)
    else sessionStorage.setItem(ORDER_DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // ignore quota / private mode
  }
}

function clearOrderDraft() {
  try {
    sessionStorage.removeItem(ORDER_DRAFT_KEY)
  } catch {
    // ignore
  }
}

function priceKey(amount: number): string {
  return Number(amount).toFixed(2)
}

function scoreHint(variant: CachedVariant, hint: string | null | undefined): number {
  if (!hint?.trim()) return 0
  const h = hint.toLowerCase()
  const title = `${variant.title} ${variant.variantTitle} ${variant.sku}`.toLowerCase()
  if (title.includes(h) || h.includes(variant.title.toLowerCase())) return 10
  const words = h.split(/\s+/).filter((w) => w.length > 2)
  return words.reduce((s, w) => s + (title.includes(w) ? 1 : 0), 0)
}

function pickBestVariant(matches: CachedVariant[], hint?: string | null): number | null {
  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0].variantId
  if (!hint?.trim()) return null
  const ranked = [...matches].sort((a, b) => scoreHint(b, hint) - scoreHint(a, hint))
  return scoreHint(ranked[0], hint) > 0 ? ranked[0].variantId : null
}

async function invokeFunction<T>(name: string, body: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`)
  return data as T
}

export default function Orders() {
  const [tab, setTab] = useState<Tab>('create')
  const [prompt, setPrompt] = useState(() => loadOrderDraft()?.prompt ?? '')
  const [dto, setDto] = useState<OrderDto | null>(() => loadOrderDraft()?.dto ?? null)
  const [cache, setCache] = useState<ShopifyProductsCache | null>(null)
  /** Selected variant id per line index */
  const [selectedByLine, setSelectedByLine] = useState<(number | null)[]>(() => loadOrderDraft()?.selectedByLine ?? [])
  const [parsing, setParsing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [recent, setRecent] = useState<ShopifyOrderRow[]>([])
  const [tagsInput, setTagsInput] = useState(() => loadOrderDraft()?.tagsInput ?? '')
  const [productSearch, setProductSearch] = useState('')
  const [formKey, setFormKey] = useState(0)
  const [syncingOrders, setSyncingOrders] = useState(false)
  const [syncingCustomers, setSyncingCustomers] = useState(false)
  const [editing, setEditing] = useState<ShopifyOrderRow | null>(null)
  const [editTags, setEditTags] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editCustomerName, setEditCustomerName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editNote, setEditNote] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const resetCreateForm = () => {
    clearOrderDraft()
    setPrompt('')
    setDto(null)
    setTagsInput('')
    setSelectedByLine([])
    setFormKey((k) => k + 1)
  }

  const loadCache = useCallback(async () => {
    const { data } = await supabase.from('settings').select('value').eq('key', 'shopify_products').maybeSingle()
    if (data?.value) setCache(data.value as unknown as ShopifyProductsCache)
  }, [])

  /** Only list orders that exist in Shopify (synced mirror). */
  const loadRecent = useCallback(async () => {
    const { data } = await supabase
      .from('shopify_orders')
      .select('id, shopify_order_id, shopify_order_name, customer_name, phone, email, amount, tags, status, error, created_at')
      .not('shopify_order_id', 'is', null)
      .eq('status', 'created')
      .order('created_at', { ascending: false })
      .limit(100)
    setRecent((data as ShopifyOrderRow[]) ?? [])
  }, [])

  const resyncOrders = useCallback(async () => {
    const res = await invokeFunction<{ synced: number; removed?: number }>('sync-shopify-orders', {})
    await loadRecent()
    return res
  }, [loadRecent])

  useEffect(() => {
    loadCache()
    loadRecent()
  }, [loadCache, loadRecent])

  useEffect(() => {
    saveOrderDraft({ prompt, dto, tagsInput, selectedByLine })
  }, [prompt, dto, tagsInput, selectedByLine])

  const allProducts = useMemo(() => {
    if (!cache?.byPrice) return []
    const map = new Map<number, CachedVariant>()
    for (const variants of Object.values(cache.byPrice)) {
      for (const v of variants) map.set(v.variantId, v)
    }
    return Array.from(map.values()).sort((a, b) =>
      a.title.localeCompare(b.title) || Number(a.price) - Number(b.price),
    )
  }, [cache])

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase()
    if (!q) return allProducts
    return allProducts.filter((p) =>
      p.title.toLowerCase().includes(q)
      || p.variantTitle.toLowerCase().includes(q)
      || p.sku.toLowerCase().includes(q)
      || p.price.includes(q),
    )
  }, [allProducts, productSearch])

  const lineItems = dto?.lineItems?.length
    ? dto.lineItems
    : dto
      ? [{ amount: dto.amount, quantity: dto.quantity || 1, hint: null as string | null }]
      : []

  const lineMatches = useMemo(() => {
    if (!cache?.byPrice) return lineItems.map(() => [] as CachedVariant[])
    return lineItems.map((li) => cache.byPrice[priceKey(li.amount)] ?? [])
  }, [cache, lineItems])

  // Auto-select variants when line items / cache change
  useEffect(() => {
    if (!dto) {
      setSelectedByLine([])
      return
    }
    if (!cache?.byPrice) return
    setSelectedByLine((prev) =>
      lineItems.map((li, i) => {
        const matches = lineMatches[i] ?? []
        const prevId = prev[i] ?? null
        if (prevId && matches.some((m) => m.variantId === prevId)) return prevId
        return pickBestVariant(matches, li.hint)
      }),
    )
    // Only re-run when dto identity / amounts change, not on every selectedByLine edit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dto, cache])

  const allLinesReady = lineItems.length > 0
    && selectedByLine.length === lineItems.length
    && selectedByLine.every((id, i) => id != null && (lineMatches[i]?.length ?? 0) > 0)

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await invokeFunction<{ rawCount: number; priceBuckets: number; syncedAt: string }>(
        'sync-shopify-products',
        {},
      )
      await loadCache()
      toast(`Synced ${res.rawCount} variants (${res.priceBuckets} price buckets)`, 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSyncing(false)
    }
  }

  const handleParse = async () => {
    if (!prompt.trim()) {
      toast('Paste an order prompt first', 'error')
      return
    }
    setParsing(true)
    try {
      const res = await invokeFunction<{
        dto: OrderDto
        customerSource?: 'prompt' | 'shopify' | 'new'
        shopifyCustomerId?: string | null
      }>('parse-order-prompt', { prompt })
      const normalized: OrderDto = {
        ...res.dto,
        lineItems: res.dto.lineItems?.length
          ? res.dto.lineItems
          : [{ amount: res.dto.amount, quantity: res.dto.quantity || 1, hint: null }],
        discount: res.dto.discount?.amount && res.dto.discount.amount > 0
          ? {
              amount: Number(res.dto.discount.amount),
              type: res.dto.discount.type === 'percentage' ? 'percentage' : 'fixed_amount',
              code: res.dto.discount.code ?? null,
            }
          : null,
      }
      normalized.amount = payableTotal(normalized)
      setDto(normalized)
      setTagsInput((normalized.tags ?? []).join(', '))
      setSelectedByLine([])
      if (res.customerSource === 'shopify') {
        toast('Existing Shopify customer — name & address loaded from Shopify', 'success')
      } else if (normalized.lineItems.length > 1) {
        toast(`Parsed ${normalized.lineItems.length} products — review before creating`, 'success')
      } else {
        toast('Prompt parsed — review details before creating', 'success')
      }
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setParsing(false)
    }
  }

  const updateCustomer = <K extends keyof OrderCustomerDto>(key: K, value: OrderCustomerDto[K]) => {
    setDto((d) => (d ? { ...d, customer: { ...d.customer, [key]: value } } : d))
  }

  const updateLine = (index: number, patch: Partial<OrderLineItemDto>) => {
    setDto((d) => {
      if (!d) return d
      const lines = [...(d.lineItems?.length ? d.lineItems : [{ amount: d.amount, quantity: 1, hint: null }])]
      lines[index] = { ...lines[index], ...patch }
      const next = { ...d, lineItems: lines }
      return { ...next, amount: payableTotal(next) }
    })
  }

  const updateDiscount = (patch: Partial<OrderDiscountDto> | null) => {
    setDto((d) => {
      if (!d) return d
      if (patch === null) {
        const next = { ...d, discount: null }
        return { ...next, amount: payableTotal(next) }
      }
      const current = d.discount ?? { amount: 0, type: 'fixed_amount' as const, code: 'DISCOUNT' }
      const discount = { ...current, ...patch }
      const next = {
        ...d,
        discount: discount.amount > 0 ? discount : null,
      }
      return { ...next, amount: payableTotal(next) }
    })
  }

  const handleCreate = async () => {
    if (!dto) {
      toast('Parse a prompt first', 'error')
      return
    }
    if (!allLinesReady) {
      toast('Resolve every line item (sync products or pick variants)', 'error')
      return
    }
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const mergedTags = tags.length > 0 ? tags : (dto.tags ?? []).map((t) => String(t).trim()).filter(Boolean)
    const lines = lineItems
    const payload: OrderDto = { ...dto, lineItems: lines, tags: mergedTags }

    setCreating(true)
    try {
      const res = await invokeFunction<{
        orderName: string
        adminUrl: string
      }>('create-shopify-order', {
        dto: payload,
        lineItems: lines.map((li, i) => ({
          variantId: selectedByLine[i]!,
          quantity: li.quantity,
          amount: li.amount,
        })),
        prompt,
      })
      toast(`Order ${res.orderName} created — syncing from Shopify…`, 'success')
      resetCreateForm()
      setTab('orders')
      setSyncingOrders(true)
      try {
        const syncRes = await resyncOrders()
        toast(`Synced ${syncRes.synced} orders from Shopify`, 'success')
      } catch (syncErr) {
        toast((syncErr as Error).message, 'error')
        await loadRecent()
      } finally {
        setSyncingOrders(false)
      }
      if (res.adminUrl) window.open(res.adminUrl, '_blank', 'noopener,noreferrer')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setCreating(false)
    }
  }

  const openEdit = (row: ShopifyOrderRow) => {
    setEditing(row)
    setEditTags((row.tags ?? []).join(', '))
    setEditEmail(row.email ?? '')
    setEditCustomerName(row.customer_name ?? '')
    setEditPhone(row.phone ?? '')
    setEditNote('')
  }

  const handleSaveEdit = async () => {
    if (!editing) return
    setSavingEdit(true)
    try {
      const payload: Record<string, unknown> = {
        id: editing.id,
        tags: editTags.split(',').map((t) => t.trim()).filter(Boolean),
        email: editEmail.trim() || null,
        customerName: editCustomerName.trim() || null,
        phone: editPhone.trim() || null,
      }
      if (editNote.trim()) payload.note = editNote.trim()
      await invokeFunction('update-shopify-order', payload)
      toast('Order updated', 'success')
      setEditing(null)
      await loadRecent()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDelete = async (row: ShopifyOrderRow) => {
    const label = row.shopify_order_name || row.shopify_order_id || 'this order'
    if (!window.confirm(`Cancel and remove ${label} from the CRM list?`)) return
    setDeletingId(row.id)
    try {
      await invokeFunction('delete-shopify-order', { id: row.id })
      toast(`Removed ${label}`, 'success')
      if (editing?.id === row.id) setEditing(null)
      await loadRecent()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl w-full min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-800">Orders</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Create Shopify orders from a prompt, browse synced products, and manage orders synced from Shopify.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-gray-400 text-right">
            {cache?.syncedAt
              ? <>Last sync: {new Date(cache.syncedAt).toLocaleString()} · {cache.rawCount} variants</>
              : 'Products not synced yet'}
          </div>
          <button
            onClick={async () => {
              setSyncingCustomers(true)
              try {
                const res = await invokeFunction<{ synced: number; skipped: number }>('sync-shopify-customers', {})
                toast(`Synced ${res.synced} customers`, 'success')
              } catch (e) {
                toast((e as Error).message, 'error')
              } finally {
                setSyncingCustomers(false)
              }
            }}
            disabled={syncingCustomers}
            className="bg-white border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {syncingCustomers ? '…' : 'Sync customers'}
          </button>
          <button
            onClick={async () => {
              setSyncingOrders(true)
              try {
                const res = await resyncOrders()
                toast(`Synced ${res.synced} orders`, 'success')
              } catch (e) {
                toast((e as Error).message, 'error')
              } finally {
                setSyncingOrders(false)
              }
            }}
            disabled={syncingOrders}
            className="bg-white border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {syncingOrders ? '…' : 'Sync orders'}
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="bg-white border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Sync products'}
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200 mb-5">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === id
                ? 'border-green-600 text-green-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {label}
            {id === 'products' && allProducts.length > 0 && (
              <span className="ml-1.5 text-xs text-gray-400">({allProducts.length})</span>
            )}
            {id === 'orders' && recent.length > 0 && (
              <span className="ml-1.5 text-xs text-gray-400">({recent.length})</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'create' && (
        <div key={formKey}>
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5 space-y-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Order prompt</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={8}
                placeholder={`Sandhu U\nKottur house\nKunnamangalam po 673571\nNear IIM\nCalicut\n9400877821\nEssential kit 999\nFoam wash 999\nCOD`}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleParse}
                disabled={parsing}
                className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
              >
                {parsing ? 'Parsing…' : 'Parse with AI'}
              </button>
              {(prompt.trim() || dto) && (
                <button
                  type="button"
                  onClick={resetCreateForm}
                  disabled={parsing || creating}
                  className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {dto && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5 space-y-4">
              <h3 className="font-semibold text-gray-700">Review order</h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="First name" value={dto.customer.firstName} onChange={(v) => updateCustomer('firstName', v)} />
                <Field label="Last name" value={dto.customer.lastName} onChange={(v) => updateCustomer('lastName', v)} />
                <Field label="Phone" value={dto.customer.phone} onChange={(v) => updateCustomer('phone', v)} />
                <Field label="Email" value={dto.customer.email ?? ''} onChange={(v) => updateCustomer('email', v)} />
                <Field label="Address 1" value={dto.customer.address1} onChange={(v) => updateCustomer('address1', v)} className="sm:col-span-2" />
                <Field label="Address 2" value={dto.customer.address2 ?? ''} onChange={(v) => updateCustomer('address2', v)} className="sm:col-span-2" />
                <Field label="City" value={dto.customer.city} onChange={(v) => updateCustomer('city', v)} />
                <Field label="Province / state" value={dto.customer.province ?? ''} onChange={(v) => updateCustomer('province', v)} />
                <Field label="PIN / zip" value={dto.customer.zip} onChange={(v) => updateCustomer('zip', v)} />
                <Field label="Country" value={dto.customer.country} onChange={(v) => updateCustomer('country', v)} />
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Order total (after discount)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={dto.amount}
                    readOnly
                    className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-700"
                  />
                </div>
                <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-lg border border-dashed border-gray-200 p-3">
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Discount</label>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={dto.discount?.amount ?? ''}
                      placeholder="0"
                      onChange={(e) => {
                        const n = parseFloat(e.target.value)
                        if (!e.target.value.trim() || Number.isNaN(n) || n <= 0) {
                          updateDiscount(null)
                          return
                        }
                        updateDiscount({ amount: n })
                      }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Discount type</label>
                    <select
                      value={dto.discount?.type ?? 'fixed_amount'}
                      onChange={(e) =>
                        updateDiscount({
                          amount: dto.discount?.amount ?? 0,
                          type: e.target.value as 'fixed_amount' | 'percentage',
                        })
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    >
                      <option value="fixed_amount">Fixed (₹)</option>
                      <option value="percentage">Percentage (%)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Discount code / label</label>
                    <input
                      type="text"
                      value={dto.discount?.code ?? ''}
                      placeholder="DISCOUNT"
                      onChange={(e) =>
                        updateDiscount({
                          amount: dto.discount?.amount ?? 0,
                          code: e.target.value.trim() || null,
                        })
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                  {dto.discount && dto.discount.amount > 0 && (
                    <p className="sm:col-span-3 text-xs text-gray-500">
                      Subtotal ₹{lineSubtotal(lineItems).toFixed(2)} − discount ₹
                      {discountOff(lineSubtotal(lineItems), dto.discount).toFixed(2)} = ₹{dto.amount.toFixed(2)}
                    </p>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm text-gray-600 mb-1">Tags (comma-separated)</label>
                  <input
                    type="text"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    placeholder="COD"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm text-gray-600 mb-1">Note</label>
                  <input
                    type="text"
                    value={dto.note ?? ''}
                    onChange={(e) => setDto({ ...dto, note: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Payment</label>
                  <select
                    value={dto.financialStatus ?? 'pending'}
                    onChange={(e) => setDto({ ...dto, financialStatus: e.target.value as 'pending' | 'paid' })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    <option value="pending">Pending (COD)</option>
                    <option value="paid">Paid</option>
                  </select>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4 space-y-4">
                <h4 className="text-sm font-medium text-gray-700">
                  Products ({lineItems.length})
                </h4>
                {lineItems.map((li, i) => {
                  const matches = lineMatches[i] ?? []
                  const selected = selectedByLine[i] ?? null
                  return (
                    <div key={i} className="rounded-lg border border-gray-200 p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-gray-800">
                          Line {i + 1}
                          {li.hint ? <span className="font-normal text-gray-500"> · {li.hint}</span> : null}
                        </p>
                        <div className="flex gap-2 items-center text-sm">
                          <label className="text-gray-500">
                            ₹
                            <input
                              type="number"
                              step="0.01"
                              value={li.amount}
                              onChange={(e) => updateLine(i, { amount: parseFloat(e.target.value) || 0 })}
                              className="ml-1 w-24 border border-gray-300 rounded-lg px-2 py-1"
                            />
                          </label>
                          <label className="text-gray-500">
                            Qty
                            <input
                              type="number"
                              min={1}
                              value={li.quantity}
                              onChange={(e) => updateLine(i, { quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                              className="ml-1 w-16 border border-gray-300 rounded-lg px-2 py-1"
                            />
                          </label>
                        </div>
                      </div>

                      {matches.length === 0 && (
                        <p className="text-sm text-red-500">
                          No product at ₹{priceKey(li.amount)} — sync or fix price.
                        </p>
                      )}
                      {matches.length === 1 && (
                        <p className="text-sm text-gray-600">
                          Auto-selected: <span className="font-medium">{matches[0].title}</span>
                          {matches[0].variantTitle && matches[0].variantTitle !== 'Default Title'
                            ? ` — ${matches[0].variantTitle}`
                            : ''}
                          {matches[0].sku ? ` · SKU ${matches[0].sku}` : ''}
                        </p>
                      )}
                      {matches.length > 1 && (
                        <div className="space-y-2">
                          <p className="text-sm text-amber-600">
                            Multiple products at this price — pick one:
                          </p>
                          {matches.map((m) => (
                            <label
                              key={m.variantId}
                              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${
                                selected === m.variantId
                                  ? 'border-green-500 bg-green-50'
                                  : 'border-gray-200 hover:bg-gray-50'
                              }`}
                            >
                              <input
                                type="radio"
                                name={`variant-${i}`}
                                checked={selected === m.variantId}
                                onChange={() =>
                                  setSelectedByLine((prev) => {
                                    const next = [...prev]
                                    next[i] = m.variantId
                                    return next
                                  })
                                }
                                className="mt-1"
                              />
                              <div className="text-sm">
                                <div className="font-medium text-gray-800">{m.title}</div>
                                <div className="text-gray-500">
                                  {m.variantTitle !== 'Default Title' ? m.variantTitle : 'Default'}
                                  {m.sku ? ` · ${m.sku}` : ''} · ₹{m.price}
                                </div>
                              </div>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleCreate}
                  disabled={creating || !allLinesReady}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
                >
                  {creating ? 'Creating…' : 'Create Shopify order'}
                </button>
                <button
                  type="button"
                  onClick={resetCreateForm}
                  disabled={creating}
                  className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'products' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h3 className="font-semibold text-gray-700">Synced products</h3>
            <input
              type="search"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Search title, SKU, price…"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          {allProducts.length === 0 ? (
            <p className="text-sm text-gray-400">
              No products cached yet. Click <span className="font-medium text-gray-600">Sync products</span> to pull from Shopify.
            </p>
          ) : (
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100">
                    <th className="py-2 pr-3 font-medium">Product</th>
                    <th className="py-2 pr-3 font-medium">Variant</th>
                    <th className="py-2 pr-3 font-medium">SKU</th>
                    <th className="py-2 pr-3 font-medium">Price</th>
                    <th className="py-2 font-medium">Variant ID</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((p) => (
                    <tr key={p.variantId} className="border-b border-gray-50">
                      <td className="py-2 pr-3 text-gray-800 font-medium">{p.title}</td>
                      <td className="py-2 pr-3 text-gray-600">
                        {p.variantTitle !== 'Default Title' ? p.variantTitle : 'Default'}
                      </td>
                      <td className="py-2 pr-3 font-mono text-gray-500">{p.sku || '—'}</td>
                      <td className="py-2 pr-3 text-gray-700">₹{p.price}</td>
                      <td className="py-2 font-mono text-xs text-gray-400">{p.variantId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredProducts.length === 0 && (
                <p className="text-sm text-gray-400 mt-3">No products match “{productSearch}”.</p>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'orders' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-700">Shopify orders</h3>
            <button
              type="button"
              onClick={() => loadRecent()}
              className="text-sm text-green-600 hover:text-green-700"
            >
              Refresh
            </button>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            Showing orders synced from Shopify only. Create an order or click Sync orders to refresh.
          </p>

          {editing && (
            <div className="mb-4 rounded-lg border border-green-200 bg-green-50/50 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-gray-800">
                  Edit {editing.shopify_order_name ?? 'order'}
                </h4>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Customer name" value={editCustomerName} onChange={setEditCustomerName} />
                <Field label="Phone" value={editPhone} onChange={setEditPhone} />
                <Field label="Email" value={editEmail} onChange={setEditEmail} />
                <Field label="Tags (comma-separated)" value={editTags} onChange={setEditTags} />
                <div className="sm:col-span-2">
                  <Field label="Note (Shopify)" value={editNote} onChange={setEditNote} />
                </div>
              </div>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={savingEdit}
                className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
              >
                {savingEdit ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          )}

          {recent.length === 0 ? (
            <p className="text-sm text-gray-400">
              No synced Shopify orders yet. Create an order or click <span className="font-medium text-gray-600">Sync orders</span>.
            </p>
          ) : (
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100">
                    <th className="py-2 pr-3 font-medium">Order</th>
                    <th className="py-2 pr-3 font-medium">Customer</th>
                    <th className="py-2 pr-3 font-medium">Phone</th>
                    <th className="py-2 pr-3 font-medium">Email</th>
                    <th className="py-2 pr-3 font-medium">Amount</th>
                    <th className="py-2 pr-3 font-medium">Tags</th>
                    <th className="py-2 pr-3 font-medium">When</th>
                    <th className="py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((row) => (
                    <tr key={row.id} className="border-b border-gray-50">
                      <td className="py-2 pr-3 font-mono text-gray-800">
                        {row.shopify_order_name ?? '—'}
                      </td>
                      <td className="py-2 pr-3 text-gray-800 whitespace-nowrap">
                        {row.customer_name || '—'}
                      </td>
                      <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">
                        {row.phone ? formatPhoneDisplay(row.phone) : '—'}
                      </td>
                      <td className="py-2 pr-3 text-gray-500">{row.email ?? '—'}</td>
                      <td className="py-2 pr-3 text-gray-600">
                        {row.amount != null ? `₹${Number(row.amount).toFixed(2)}` : '—'}
                      </td>
                      <td className="py-2 pr-3 text-gray-500">
                        {(row.tags ?? []).join(', ') || '—'}
                      </td>
                      <td className="py-2 pr-3 text-gray-400 whitespace-nowrap">
                        {new Date(row.created_at).toLocaleString()}
                      </td>
                      <td className="py-2 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(row)}
                            className="text-sm text-green-600 hover:text-green-700"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(row)}
                            disabled={deletingId === row.id}
                            className="text-sm text-red-500 hover:text-red-600 disabled:opacity-50"
                          >
                            {deletingId === row.id ? '…' : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  className = '',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  className?: string
}) {
  return (
    <div className={className}>
      <label className="block text-sm text-gray-600 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
      />
    </div>
  )
}
