import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useFollowups, useEnrichedFollowups } from '../hooks/useFollowups'
import { toast } from '../components/Toast'
import type { EnrichedFollowup } from '../types'

export default function Calendar() {
  const navigate = useNavigate()
  const { followups, complete } = useFollowups()
  const { enriched } = useEnrichedFollowups(followups)
  const [viewDate, setViewDate] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const monthName = viewDate.toLocaleString('default', { month: 'long' })
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const todayDate = new Date()
  const isCurrentMonth = year === todayDate.getFullYear() && month === todayDate.getMonth()

  const followupsForDay = (day: number): EnrichedFollowup[] =>
    enriched.filter((f) => {
      if (!f.dueDate) return false
      const d = new Date(f.dueDate)
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day
    })

  const selectedFollowups = selectedDay ? followupsForDay(selectedDay) : []

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1))
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1))

  const handleComplete = async (id: string) => {
    setBusyId(id)
    const ok = await complete(id)
    setBusyId(null)
    if (ok) toast('Marked complete', 'success')
  }

  return (
    <div className="p-4 sm:p-6 max-w-full min-w-0">
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <h2 className="text-xl font-semibold text-gray-800">Calendar</h2>
        <p className="text-xs text-gray-400 hidden sm:block">Pending scheduled follow-ups</p>
        <div className="flex items-center gap-2 ml-auto">
          <Link to="/followups" className="text-xs text-green-600 hover:text-green-700 mr-2">
            Open Follow-ups
          </Link>
          <button type="button" onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">‹</button>
          <span className="text-sm font-medium text-gray-700 w-32 text-center">{monthName} {year}</span>
          <button type="button" onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">›</button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="bg-white rounded-xl border border-gray-200 p-4 w-full max-w-sm">
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
                  type="button"
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
          <div className="flex-1 w-full bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-700 mb-3">
              {monthName} {selectedDay} — Follow-ups ({selectedFollowups.length})
            </h3>
            {selectedFollowups.length === 0 ? (
              <p className="text-sm text-gray-400">No follow-ups on this day.</p>
            ) : (
              <div className="space-y-2">
                {selectedFollowups.map((f) => (
                  <div key={f.id} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
                    <input
                      type="checkbox"
                      disabled={busyId === f.id}
                      onChange={() => handleComplete(f.id)}
                      className="w-4 h-4 accent-green-600 cursor-pointer flex-shrink-0"
                      title="Mark complete"
                    />
                    <button
                      type="button"
                      onClick={() => f.customerId && navigate(`/customers/${f.customerId}`)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <p className="text-sm font-medium text-gray-800 truncate hover:text-green-700">{f.customerName}</p>
                      {f.note && <p className="text-xs text-gray-500">{f.note}</p>}
                    </button>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-blue-500 font-medium">
                        {f.dueDate
                          ? new Date(f.dueDate).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                          : ''}
                      </p>
                      {f.customerId && (
                        <Link to={`/customers/${f.customerId}`} className="text-xs text-gray-400 hover:text-green-600">
                          Open
                        </Link>
                      )}
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
