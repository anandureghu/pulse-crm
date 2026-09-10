import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCustomers } from '../hooks/useCustomers'
import { createCustomer, ensureConversation } from '../lib/db'
import { useTenantStore } from '../store/tenantStore'
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

type StatusFilter = 'all' | 'assigned' | 'unassigned' | 'shopify'

export default function Customers() {
  const { customers, loading } = useCustomers()
  const navigate = useNavigate()
  const organizationId = useTenantStore((s) => s.activeOrganizationId)
  const instanceId = useTenantStore((s) => s.activeInstanceId)
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const handleAdd = async () => {
    const phoneNorm = normalizePhoneForStorage(phone)
    if (!name.trim() || !isValidIndianMobile(phone)) {
      toast('Enter a name and a valid 10-digit Indian mobile (with or without +91)', 'error')
      return
    }
    if (!organizationId || !instanceId) {
      toast('Select an organization and instance first', 'error')
      return
    }
    const scope = { organizationId, instanceId }
    setSaving(true)
    try {
      const existing = customers.find((c) => normalizePhoneForStorage(c.phone) === phoneNorm)
      if (existing) {
        const convId = await ensureConversation(scope, existing.id)
        toast('Contact already exists — opening chat', 'success')
        setShowAdd(false)
        navigate(`/inbox?c=${convId}`)
        return
      }
      const created = await createCustomer(scope, {
        name: name.trim(),
        phone: phoneNorm,
        assignedTo: null,
        tags: [],
        aiAutoreply: false,
      })
      const convId = await ensureConversation(scope, created.id)
      toast('Contact added', 'success')
      setShowAdd(false)
      setName('')
      setPhone('')
      navigate(`/inbox?c=${convId}`)
    } catch (e) {
      toast((e as Error).message || 'Failed to add contact', 'error')
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
          body: JSON.stringify({
            organizationId,
            instanceId,
          }),
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
        filterEmptyLabel: 'No tag',
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

  const visibleCustomers = useMemo(() => {
    switch (statusFilter) {
      case 'assigned':
        return customers.filter(isAssigned)
      case 'unassigned':
        return customers.filter((c) => !isAssigned(c))
      case 'shopify':
        return customers.filter(hasShopifyTag)
      default:
        return customers
    }
  }, [customers, statusFilter])

  const assignedCount = useMemo(() => customers.filter(isAssigned).length, [customers])
  const shopifyCount = useMemo(() => customers.filter(hasShopifyTag).length, [customers])
  const unassignedCount = customers.length - assignedCount

  return (
    <div className="p-4 sm:p-6 max-w-full">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold text-gray-800">Contacts</h2>
          <span className="text-sm text-gray-400">{customers.length} total · leads & enquiries</span>
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
            + Add contact
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
        emptyMessage="No contacts match this filter."
        filterBar={
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            <span className="font-medium text-gray-600">Status</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="border border-gray-300 rounded-lg px-2.5 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-500 bg-white min-w-[160px]"
            >
              <option value="all">All ({customers.length})</option>
              <option value="assigned">Assigned ({assignedCount})</option>
              <option value="unassigned">Unassigned ({unassignedCount})</option>
              <option value="shopify">Shopify ({shopifyCount})</option>
            </select>
          </label>
        }
      />

      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-gray-800 mb-4">Add contact</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="Contact name"
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
