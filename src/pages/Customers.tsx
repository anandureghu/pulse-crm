import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCustomers } from '../hooks/useCustomers'
import { createCustomer, ensureConversation } from '../lib/db'
import { normalizePhoneForStorage, formatPhoneDisplay, isValidIndianMobile } from '../lib/phone'
import { toast } from '../components/Toast'
import { supabase } from '../lib/supabase'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import type { Customer } from '../types'

function hasShopifyTag(c: Customer): boolean {
  return (c.tags ?? []).some((t) => t.toLowerCase() === 'shopify') || Boolean(c.shopifyCustomerId)
}

function isAssigned(c: Customer): boolean {
  return Boolean(c.assignedTo?.trim())
}

/** Assigned first, then organic, Shopify-tagged last. */
function customerPriority(a: Customer, b: Customer): number {
  const rank = (c: Customer) => {
    if (isAssigned(c)) return 0
    if (hasShopifyTag(c)) return 2
    return 1
  }
  return rank(a) - rank(b)
}

type QuickFilter = 'all' | 'assigned' | 'unassigned' | 'shopify' | `user:${string}`

function isUserFilter(f: QuickFilter): f is `user:${string}` {
  return f.startsWith('user:')
}

function userFromFilter(f: `user:${string}`): string {
  return f.slice('user:'.length)
}

export default function Customers() {
  const { customers, loading } = useCustomers()
  const navigate = useNavigate()
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all')

  const handleAdd = async () => {
    const phoneNorm = normalizePhoneForStorage(phone)
    if (!name.trim() || !isValidIndianMobile(phone)) {
      toast('Enter a name and a valid 10-digit Indian mobile (with or without +91)', 'error')
      return
    }
    setSaving(true)
    try {
      const existing = customers.find((c) => normalizePhoneForStorage(c.phone) === phoneNorm)
      if (existing) {
        const convId = await ensureConversation(existing.id)
        toast('Customer already exists — opening chat', 'success')
        setShowAdd(false)
        navigate(`/inbox?c=${convId}`)
        return
      }
      const created = await createCustomer({
        name: name.trim(),
        phone: phoneNorm,
        assignedTo: null,
        tags: [],
        aiAutoreply: false,
      })
      const convId = await ensureConversation(created.id)
      toast('Customer added', 'success')
      setShowAdd(false)
      setName('')
      setPhone('')
      navigate(`/inbox?c=${convId}`)
    } catch (e) {
      toast((e as Error).message || 'Failed to add customer', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleSyncShopify = async () => {
    setSyncing(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-shopify-customers`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: '{}',
        },
      )
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Sync failed')
      toast(`Synced ${body.synced} customers${body.skipped ? ` (${body.skipped} skipped)` : ''}`, 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSyncing(false)
    }
  }

  const columns = useMemo<DataTableColumn<Customer>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        accessor: (c) => c.name,
        className: 'font-medium text-gray-800 whitespace-nowrap',
      },
      {
        id: 'phone',
        header: 'Phone',
        accessor: (c) => formatPhoneDisplay(c.phone),
        className: 'text-gray-600 whitespace-nowrap',
        cell: (c) => formatPhoneDisplay(c.phone),
      },
      {
        id: 'assignedTo',
        header: 'Assigned To',
        accessor: (c) => c.assignedTo?.trim() || null,
        filterable: true,
        className: 'text-gray-600 whitespace-nowrap',
        cell: (c) => c.assignedTo?.trim() || '—',
      },
      {
        id: 'tags',
        header: 'Tags',
        accessor: (c) => (hasShopifyTag(c) ? 'shopify' : (c.tags ?? [])[0] || ''),
        filterable: true,
        sortable: true,
        cell: (c) =>
          c.tags?.length ? (
            <span className="flex flex-wrap gap-1">
              {c.tags.map((t) => (
                <span key={t} className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                  {t}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-gray-300">—</span>
          ),
      },
      {
        id: 'createdAt',
        header: 'Created',
        accessor: (c) => (c.createdAt ? new Date(c.createdAt).getTime() : 0),
        className: 'text-gray-500 whitespace-nowrap',
        cell: (c) => (c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—'),
      },
    ],
    [],
  )

  const assigneeChips = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of customers) {
      const a = c.assignedTo?.trim()
      if (!a) continue
      counts.set(a, (counts.get(a) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))
      .map(([user, count]) => ({ user, count, id: `user:${user}` as const }))
  }, [customers])

  const visibleCustomers = useMemo(() => {
    if (isUserFilter(quickFilter)) {
      const user = userFromFilter(quickFilter)
      return customers.filter((c) => c.assignedTo?.trim() === user)
    }
    switch (quickFilter) {
      case 'assigned':
        return customers.filter(isAssigned)
      case 'unassigned':
        return customers.filter((c) => !isAssigned(c))
      case 'shopify':
        return customers.filter(hasShopifyTag)
      default:
        return customers
    }
  }, [customers, quickFilter])

  const assignedCount = useMemo(() => customers.filter(isAssigned).length, [customers])
  const shopifyCount = useMemo(() => customers.filter(hasShopifyTag).length, [customers])

  const chipClass = (active: boolean) =>
    `px-2.5 py-1.5 rounded-lg text-sm border transition-colors ${
      active
        ? 'border-green-600 bg-green-50 text-green-700 font-medium'
        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
    }`

  return (
    <div className="p-4 sm:p-6 max-w-full">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold text-gray-800">Customers</h2>
          <span className="text-sm text-gray-400">{customers.length} total</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSyncShopify}
            disabled={syncing}
            className="border border-gray-300 text-gray-700 text-sm font-medium px-3 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Sync Shopify'}
          </button>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="bg-green-600 text-white text-sm font-medium px-3 py-2 rounded-lg hover:bg-green-700"
          >
            + Add customer
          </button>
        </div>
      </div>

      <DataTable
        data={visibleCustomers}
        columns={columns}
        getRowId={(c) => c.id}
        loading={loading}
        searchPlaceholder="Search by name, phone, or assignee…"
        searchFilter={(c, q) => {
          if (!q.trim()) return true
          const s = q.trim().toLowerCase()
          return (
            c.name.toLowerCase().includes(s)
            || c.phone.includes(s)
            || formatPhoneDisplay(c.phone).includes(s)
            || (c.assignedTo ?? '').toLowerCase().includes(s)
            || (c.tags ?? []).some((t) => t.toLowerCase().includes(s))
          )
        }}
        defaultSort={{ id: 'createdAt', dir: 'desc' }}
        secondaryCompare={customerPriority}
        defaultPageSize={10}
        pageSizeOptions={[10, 25, 50, 100]}
        onRowClick={(c) => navigate(`/customers/${c.id}`)}
        emptyMessage="No customers match this filter."
        filterBar={
          <div className="flex flex-col gap-2 text-xs text-gray-500 w-full sm:w-auto">
            <div className="flex flex-col gap-1">
              <span className="font-medium text-gray-600">Quick filter</span>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { id: 'all' as const, label: `All (${customers.length})` },
                    { id: 'assigned' as const, label: `Assigned (${assignedCount})` },
                    { id: 'unassigned' as const, label: `Unassigned (${customers.length - assignedCount})` },
                    { id: 'shopify' as const, label: `Shopify (${shopifyCount})` },
                  ] as const
                ).map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => setQuickFilter(chip.id)}
                    className={chipClass(quickFilter === chip.id)}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>
            {assigneeChips.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="font-medium text-gray-600">Assigned user</span>
                <div className="flex flex-wrap gap-1.5">
                  {assigneeChips.map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => setQuickFilter(chip.id)}
                      className={chipClass(quickFilter === chip.id)}
                      title={chip.user}
                    >
                      {chip.user} ({chip.count})
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        }
      />

      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-gray-800 mb-4">Add customer</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="Customer name"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">WhatsApp number</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  type="tel"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="9198XXXXXXXX"
                />
                <p className="text-xs text-gray-400 mt-1">
                  10 digits, or with 91 / +91 — saved as +91XXXXXXXXXX
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="flex-1 border border-gray-300 text-gray-700 text-sm font-medium py-2 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAdd}
                disabled={saving}
                className="flex-1 bg-green-600 text-white text-sm font-medium py-2 rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Add & chat'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
