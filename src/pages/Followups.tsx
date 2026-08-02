import { useEffect, useState } from 'react'
import { useFollowups } from '../hooks/useFollowups'
import { getEnquiry, getCustomer } from '../lib/db'
import type { Followup } from '../types'

interface EnrichedFollowup extends Followup {
  customerName: string
}

function useEnrichedFollowups() {
  const { followups, loading, complete } = useFollowups()
  const [enriched, setEnriched] = useState<EnrichedFollowup[]>([])

  useEffect(() => {
    if (!followups.length) { setEnriched([]); return }
    let cancelled = false
    Promise.all(
      followups.map(async (f) => {
        try {
          const enq = await getEnquiry(f.enquiryId)
          const customer = enq ? await getCustomer(enq.customerId) : null
          return { ...f, customerName: customer?.name ?? f.enquiryId }
        } catch {
          return { ...f, customerName: f.enquiryId }
        }
      })
    ).then((res) => { if (!cancelled) setEnriched(res) })
    return () => { cancelled = true }
  }, [followups])

  return { enriched, loading, complete }
}

export default function Followups() {
  const { enriched, loading, complete } = useEnrichedFollowups()

  const today = new Date().toISOString().split('T')[0]
  const toKey = (f: EnrichedFollowup) => f.dueDate ? new Date(f.dueDate).toISOString().split('T')[0] : ''

  const overdue = enriched.filter((f) => toKey(f) < today)
  const todayItems = enriched.filter((f) => toKey(f) === today)
  const upcoming = enriched.filter((f) => toKey(f) > today)

  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold text-gray-800 mb-6">Follow-ups</h2>
      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <>
          <Section title="Overdue" accent="text-red-500" items={overdue} onComplete={complete} />
          <Section title="Today" accent="text-gray-700" items={todayItems} onComplete={complete} />
          <Section title="Upcoming" accent="text-gray-400" items={upcoming} onComplete={complete} />
          {enriched.length === 0 && (
            <p className="text-sm text-gray-400">No pending follow-ups.</p>
          )}
        </>
      )}
    </div>
  )
}

function Section({
  title,
  accent,
  items,
  onComplete,
}: {
  title: string
  accent: string
  items: EnrichedFollowup[]
  onComplete: (id: string) => void
}) {
  if (items.length === 0) return null
  return (
    <section className="mb-6">
      <h3 className={`text-sm font-semibold uppercase tracking-wide mb-3 ${accent}`}>
        {title} ({items.length})
      </h3>
      <div className="space-y-2">
        {items.map((f) => (
          <div key={f.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4">
            <input
              type="checkbox"
              onChange={() => onComplete(f.id)}
              className="w-4 h-4 accent-green-600 cursor-pointer flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm text-gray-800 truncate">{f.customerName}</p>
              {f.note && <p className="text-xs text-gray-500 truncate">{f.note}</p>}
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xs text-gray-500 font-medium">
                {f.dueDate ? new Date(f.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}
              </p>
              <p className="text-xs text-blue-500">
                {f.dueDate ? new Date(f.dueDate).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}
              </p>
              {f.assignedTo && <p className="text-xs text-gray-400">{f.assignedTo}</p>}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
