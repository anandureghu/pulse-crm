import { useEffect, useMemo, useState } from 'react'
import { useCustomers } from '../hooks/useCustomers'
import { useEnquiriesByCustomer } from '../hooks/useEnquiries'
import { useUsers } from '../hooks/useUsers'
import { useCreateFollowup } from '../hooks/useCreateFollowup'
import { useAuthStore } from '../store/authStore'
import { ensureEnquiryForCustomer, userLabel } from '../lib/db'
import { toast } from './Toast'
import type { EnrichedFollowup } from '../types'

export type FollowupFormMode = 'create' | 'edit'

interface FollowupFormModalProps {
  mode: FollowupFormMode
  /** Prefill / locked customer when scheduling from Customer Detail */
  lockedCustomerId?: string
  lockedCustomerName?: string
  editing?: EnrichedFollowup | null
  onClose: () => void
  onSaved?: (dueDateIso?: string) => void
  onUpdate?: (
    id: string,
    data: { note: string; dueDate: string; assignedTo: string }
  ) => Promise<boolean>
}

function toLocalDateParts(iso?: string) {
  const d = iso ? new Date(iso) : new Date()
  if (Number.isNaN(d.getTime())) {
    const now = new Date()
    return {
      date: now.toISOString().slice(0, 10),
      time: '09:00',
    }
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

function tomorrowAtNine(): { date: string; time: string } {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: '09:00',
  }
}

export function FollowupFormModal({
  mode,
  lockedCustomerId,
  lockedCustomerName,
  editing,
  onClose,
  onSaved,
  onUpdate,
}: FollowupFormModalProps) {
  const user = useAuthStore((s) => s.user)
  const users = useUsers()
  const { customers } = useCustomers()
  const { create } = useCreateFollowup()

  const initial = mode === 'edit' && editing
    ? toLocalDateParts(editing.dueDate)
    : tomorrowAtNine()

  const [customerId, setCustomerId] = useState(
    lockedCustomerId || editing?.customerId || ''
  )
  const [customerSearch, setCustomerSearch] = useState('')
  const [note, setNote] = useState(editing?.note ?? '')
  const [date, setDate] = useState(initial.date)
  const [time, setTime] = useState(initial.time)
  const [assignedTo, setAssignedTo] = useState(
    editing?.assignedTo || user?.email || user?.id || ''
  )
  const [saving, setSaving] = useState(false)

  const { enquiries, loading: enquiriesLoading } = useEnquiriesByCustomer(customerId)
  const latestEnquiry = enquiries[0] ?? null

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase()
    if (!q) return customers.slice(0, 8)
    return customers
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.phone.toLowerCase().includes(q)
      )
      .slice(0, 8)
  }, [customers, customerSearch])

  const selectedCustomer = customers.find((c) => c.id === customerId)

  useEffect(() => {
    if (lockedCustomerId) setCustomerId(lockedCustomerId)
  }, [lockedCustomerId])

  const applyPreset = (kind: 'tomorrow' | 'plus3' | 'nextweek') => {
    const d = new Date()
    if (kind === 'tomorrow') d.setDate(d.getDate() + 1)
    if (kind === 'plus3') d.setDate(d.getDate() + 3)
    if (kind === 'nextweek') d.setDate(d.getDate() + 7)
    d.setHours(9, 0, 0, 0)
    const pad = (n: number) => String(n).padStart(2, '0')
    setDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
    setTime('09:00')
  }

  const handleSubmit = async () => {
    if (!date) {
      toast('Pick a due date', 'error')
      return
    }
    const dt = new Date(`${date}T${time || '09:00'}`)
    if (Number.isNaN(dt.getTime())) {
      toast('Invalid date/time', 'error')
      return
    }

    setSaving(true)
    try {
      if (mode === 'edit' && editing && onUpdate) {
        const ok = await onUpdate(editing.id, {
          note: note.trim(),
          dueDate: dt.toISOString(),
          assignedTo,
        })
        if (ok) {
          toast('Follow-up updated', 'success')
          onSaved?.(dt.toISOString())
          onClose()
        }
        return
      }

      if (!customerId) {
        toast('Pick a customer', 'error')
        return
      }

      let enquiryId = latestEnquiry?.id
      if (!enquiryId) {
        const { data: ensured, error: ensureError } = await ensureEnquiryForCustomer(
          customerId,
          assignedTo || user?.email || null
        )
        if (ensureError || !ensured) {
          toast('Failed to prepare customer for follow-up', 'error')
          return
        }
        enquiryId = ensured.id
      }

      const result = await create(enquiryId, note.trim(), dt, assignedTo)
      if ((result as { error?: unknown })?.error) {
        toast('Failed to schedule follow-up', 'error')
        return
      }
      toast('Follow-up scheduled', 'success')
      onSaved?.(dt.toISOString())
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const title = mode === 'edit' ? 'Edit Follow-up' : 'Schedule Follow-up'
  const canSubmit =
    !!date &&
    !!assignedTo &&
    (mode === 'edit' || !!customerId)

  return (
    <div className="fixed inset-0 bg-black/30 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl p-5 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
        <h3 className="font-semibold text-gray-800 mb-4">{title}</h3>

        <div className="space-y-3">
          {mode === 'create' && !lockedCustomerId && (
            <div>
              <label className="block text-sm text-gray-600 mb-1">Customer</label>
              {customerId && selectedCustomer ? (
                <div className="flex items-center justify-between gap-2 border border-gray-200 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{selectedCustomer.name}</p>
                    <p className="text-xs text-gray-400">{selectedCustomer.phone}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setCustomerId(''); setCustomerSearch('') }}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <input
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    placeholder="Search by name or phone"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    autoFocus
                  />
                  <div className="mt-1 border border-gray-100 rounded-lg overflow-hidden divide-y divide-gray-50 max-h-40 overflow-y-auto">
                    {filteredCustomers.length === 0 ? (
                      <p className="text-xs text-gray-400 px-3 py-2">No customers found</p>
                    ) : (
                      filteredCustomers.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setCustomerId(c.id)}
                          className="w-full text-left px-3 py-2 hover:bg-gray-50"
                        >
                          <p className="text-sm text-gray-800 truncate">{c.name}</p>
                          <p className="text-xs text-gray-400">{c.phone}</p>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
              {customerId && !latestEnquiry && !enquiriesLoading && (
                <p className="text-xs text-gray-500 mt-1">
                  No pipeline enquiry yet — one will be created when you schedule.
                </p>
              )}
            </div>
          )}

          {(lockedCustomerId || (mode === 'edit' && editing)) && (
            <div>
              <label className="block text-sm text-gray-600 mb-1">Customer</label>
              <p className="text-sm font-medium text-gray-800">
                {lockedCustomerName || editing?.customerName || '—'}
              </p>
              {mode === 'create' && customerId && !latestEnquiry && !enquiriesLoading && (
                <p className="text-xs text-gray-500 mt-1">
                  No pipeline enquiry yet — one will be created when you schedule.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-600 mb-1">Note</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Call about pricing"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">Quick schedule</label>
            <div className="flex flex-wrap gap-2">
              {[
                { key: 'tomorrow' as const, label: 'Tomorrow 9am' },
                { key: 'plus3' as const, label: '+3 days' },
                { key: 'nextweek' as const, label: 'Next week' },
              ].map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => applyPreset(p.key)}
                  className="text-xs min-h-9 px-2.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">Due date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div className="w-28">
              <label className="block text-sm text-gray-600 mb-1">Time</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">Assign to</label>
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              {users.map((u) => (
                <option key={u.id} value={u.email}>
                  {userLabel(u)}
                </option>
              ))}
              {assignedTo && !users.some((u) => u.email === assignedTo || u.id === assignedTo) && (
                <option value={assignedTo}>{assignedTo}</option>
              )}
            </select>
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || saving}
            className="flex-1 bg-green-600 text-white py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-40"
          >
            {saving ? 'Saving…' : mode === 'edit' ? 'Save' : 'Schedule'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
