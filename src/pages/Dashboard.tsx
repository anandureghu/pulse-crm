import { Link } from 'react-router-dom'
import { useEnquiries } from '../hooks/useEnquiries'
import { useFollowups, useEnrichedFollowups } from '../hooks/useFollowups'
import { useCustomers } from '../hooks/useCustomers'
import { useUsers } from '../hooks/useUsers'
import { userLabel } from '../lib/db'

function localDateKey(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function dueDateKey(iso: string | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return localDateKey(d)
}

export default function Dashboard() {
  const { enquiries } = useEnquiries()
  const { followups } = useFollowups()
  const { customers: allCustomers } = useCustomers()
  const users = useUsers()
  const { enriched } = useEnrichedFollowups(followups)

  const today = localDateKey()

  const openEnquiries = enquiries.filter(
    (e) => !['sale_completed', 'not_interested', 'lost', 'spam', 'duplicate'].includes(e.status)
  ).length
  const todayFollowups = enriched.filter((f) => dueDateKey(f.dueDate) === today)
  const completedSales = enquiries.filter((e) => e.status === 'sale_completed').length

  const statCards = [
    { label: 'Total Customers', value: allCustomers.length, color: 'bg-blue-50 text-blue-700', to: '/customers' },
    { label: "Today's Follow-ups", value: todayFollowups.length, color: 'bg-yellow-50 text-yellow-700', to: '/followups' },
    { label: 'Open Enquiries', value: openEnquiries, color: 'bg-green-50 text-green-700', to: '/pipeline' },
    { label: 'Sales Completed', value: completedSales, color: 'bg-purple-50 text-purple-700', to: '/pipeline' },
  ]

  const recentEnquiries = enquiries.slice(0, 5)
  const customerNameById = new Map(allCustomers.map((c) => [c.id, c.name]))
  const assigneeDisplay = (assignedTo: string | null | undefined) => {
    if (!assignedTo?.trim()) return 'Unassigned'
    const u = users.find((x) => x.email === assignedTo || x.id === assignedTo || userLabel(x) === assignedTo)
    return u ? userLabel(u) : assignedTo
  }

  return (
    <div className="p-4 sm:p-6 max-w-full min-w-0">
      <h2 className="text-xl font-semibold text-gray-800 mb-6">Dashboard</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((card) => (
          <Link key={card.label} to={card.to} className={`rounded-xl p-4 ${card.color} hover:opacity-90 transition-opacity`}>
            <p className="text-2xl font-bold">{card.value}</p>
            <p className="text-sm mt-1">{card.label}</p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-700">Today's Follow-ups</h3>
            <Link to="/followups" className="text-xs text-green-600 hover:text-green-700">View all</Link>
          </div>
          {todayFollowups.length === 0 ? (
            <p className="text-sm text-gray-400">No follow-ups due today.</p>
          ) : (
            <div className="space-y-2">
              {todayFollowups.map((f) => (
                <Link
                  key={f.id}
                  to={f.customerId ? `/customers/${f.customerId}` : '/followups'}
                  className="flex items-center gap-3 text-sm hover:bg-gray-50 rounded-lg px-1 py-1 -mx-1"
                >
                  <span className="w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-gray-800 font-medium truncate">{f.customerName}</p>
                    {f.note && <p className="text-xs text-gray-400 truncate">{f.note}</p>}
                  </div>
                  <span className="text-gray-400 text-xs flex-shrink-0">
                    {new Date(f.dueDate).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-700 mb-3">Recent Enquiries</h3>
          {recentEnquiries.length === 0 ? (
            <p className="text-sm text-gray-400">No enquiries yet.</p>
          ) : (
            <div className="space-y-2">
              {recentEnquiries.map((e) => {
                const name = customerNameById.get(e.customerId) ?? 'Unknown customer'
                const assignee =
                  e.assignedTo?.trim()
                  || allCustomers.find((c) => c.id === e.customerId)?.assignedTo?.trim()
                  || null
                return (
                  <Link
                    key={e.id}
                    to={`/customers/${e.customerId}`}
                    className="flex items-center gap-3 text-sm hover:bg-gray-50 rounded-lg px-1 py-1 -mx-1"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-gray-800 font-medium truncate">{name}</p>
                      <p className="text-xs text-gray-400 truncate">{assigneeDisplay(assignee)}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs capitalize flex-shrink-0 ${statusColor(e.status)}`}>
                      {e.status.replace(/_/g, ' ')}
                    </span>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function statusColor(status: string) {
  const map: Record<string, string> = {
    new_lead: 'bg-gray-100 text-gray-600',
    assigned: 'bg-blue-100 text-blue-600',
    interested: 'bg-yellow-100 text-yellow-700',
    negotiation: 'bg-purple-100 text-purple-700',
    sale_completed: 'bg-green-100 text-green-700',
    lost: 'bg-red-100 text-red-600',
  }
  return map[status] ?? 'bg-gray-100 text-gray-600'
}
