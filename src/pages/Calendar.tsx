import { useEffect, useState } from 'react'
import { useFollowups } from '../hooks/useFollowups'
import { getEnquiry, getCustomer } from '../lib/db'
import type { Followup } from '../types'

interface EnrichedFollowup extends Followup { customerName: string }

export default function Calendar() {
  const { followups } = useFollowups()
  const [enriched, setEnriched] = useState<EnrichedFollowup[]>([])
  const [viewDate, setViewDate] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState<number | null>(null)

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const monthName = viewDate.toLocaleString('default', { month: 'long' })
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const todayDate = new Date()
  const isCurrentMonth = year === todayDate.getFullYear() && month === todayDate.getMonth()

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

  const followupsForDay = (day: number): EnrichedFollowup[] =>
    enriched.filter((f) => {
      if (!f.dueDate) return false
      const d = new Date(f.dueDate)
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day
    })

  const selectedFollowups = selectedDay ? followupsForDay(selectedDay) : []

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1))
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1))

  return (
    <div className="p-4 sm:p-6 max-w-full min-w-0">
      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-xl font-semibold text-gray-800">Calendar</h2>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">‹</button>
          <span className="text-sm font-medium text-gray-700 w-32 text-center">{monthName} {year}</span>
          <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">›</button>
        </div>
      </div>

      <div className="flex gap-6 items-start">
        <div className="bg-white rounded-xl border border-gray-200 p-4 w-80">
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-400 mb-2">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
              <div key={d} className="py-1 font-medium">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstDay }, (_, i) => <div key={`b${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1
              const isToday = isCurrentMonth && day === todayDate.getDate()
              const isSelected = day === selectedDay
              const dayFollowups = followupsForDay(day)
              return (
                <button
                  key={day}
                  onClick={() => setSelectedDay(isSelected ? null : day)}
                  className={`h-9 flex flex-col items-center justify-center rounded-lg text-sm relative transition-colors ${
                    isSelected
                      ? 'bg-green-600 text-white'
                      : isToday
                      ? 'bg-green-100 text-green-700 font-bold'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {day}
                  {dayFollowups.length > 0 && (
                    <span className={`absolute bottom-1 w-1 h-1 rounded-full ${isSelected ? 'bg-white' : 'bg-green-500'}`} />
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {selectedDay && (
          <div className="flex-1 bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-700 mb-3">
              {monthName} {selectedDay} — Follow-ups ({selectedFollowups.length})
            </h3>
            {selectedFollowups.length === 0 ? (
              <p className="text-sm text-gray-400">No follow-ups on this day.</p>
            ) : (
              <div className="space-y-2">
                {selectedFollowups.map((f) => (
                  <div key={f.id} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
                    <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{f.customerName}</p>
                      {f.note && <p className="text-xs text-gray-500">{f.note}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-blue-500 font-medium">
                        {f.dueDate ? new Date(f.dueDate).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}
                      </p>
                      {f.assignedTo && <p className="text-xs text-gray-400">{f.assignedTo}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
