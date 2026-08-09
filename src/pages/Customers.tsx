import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCustomers } from '../hooks/useCustomers'
import { createCustomer, ensureConversation } from '../lib/db'
import { normalizePhoneForStorage, formatPhoneDisplay } from '../lib/phone'
import { toast } from '../components/Toast'
import { supabase } from '../lib/supabase'

export default function Customers() {
  const { customers, loading } = useCustomers()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search) ||
      (c.assignedTo ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const handleAdd = async () => {
    const phoneNorm = normalizePhoneForStorage(phone)
    if (!name.trim() || phoneNorm.length < 8) {
      toast('Enter a name and valid phone number', 'error')
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
      <div className="mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, phone, or assignee…"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full max-w-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Name</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Phone</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Assigned To</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Tags</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400 text-sm">Loading…</td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400 text-sm">
                  {search
                    ? 'No customers match your search.'
                    : 'No customers yet. Add one manually or wait for WhatsApp messages.'}
                </td>
              </tr>
            )}
            {filtered.map((c) => (
              <tr
                key={c.id}
                onClick={() => navigate(`/customers/${c.id}`)}
                className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
              >
                <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{c.name}</td>
                <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatPhoneDisplay(c.phone)}</td>
                <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{c.assignedTo ?? '—'}</td>
                <td className="px-4 py-3">
                  {c.tags?.map((t) => (
                    <span key={t} className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full mr-1">
                      {t}
                    </span>
                  ))}
                </td>
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                  {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
                <p className="text-xs text-gray-400 mt-1">Include country code (e.g. 91…)</p>
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
