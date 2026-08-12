import { useEffect, useState } from 'react'
import { getNotesForCustomer, getNotesForEnquiry } from '../lib/db'
import type { Note } from '../types'

interface CustomerNotesModalProps {
  customerName: string
  customerId?: string | null
  enquiryId: string
  followupNote?: string
  onClose: () => void
}

export function CustomerNotesModal({
  customerName,
  customerId,
  enquiryId,
  followupNote,
  onClose,
}: CustomerNotesModalProps) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const load = customerId
      ? getNotesForCustomer(customerId)
      : getNotesForEnquiry(enquiryId)
    load.then((data) => {
      if (!cancelled) {
        setNotes(data)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [customerId, enquiryId])

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl p-5 w-full max-w-md shadow-xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-800 truncate">Notes — {customerName}</h3>
            <p className="text-xs text-gray-400 mt-0.5">Customer notes from enquiries</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-sm flex-shrink-0 min-w-10 min-h-10 rounded-lg hover:bg-gray-100"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {followupNote && (
          <div className="mb-3 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-amber-700 font-semibold mb-0.5">
              This follow-up
            </p>
            <p className="text-sm text-amber-900 whitespace-pre-wrap">{followupNote}</p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-0 space-y-2">
          {loading ? (
            <p className="text-sm text-gray-400 py-6 text-center">Loading notes…</p>
          ) : notes.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No customer notes yet.</p>
          ) : (
            notes.map((n) => (
              <div key={n.id} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{n.content}</p>
                <p className="text-xs text-gray-400 mt-2">
                  {n.author}
                  {n.createdAt
                    ? ` · ${new Date(n.createdAt).toLocaleString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`
                    : ''}
                </p>
              </div>
            ))
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50"
        >
          Close
        </button>
      </div>
    </div>
  )
}
