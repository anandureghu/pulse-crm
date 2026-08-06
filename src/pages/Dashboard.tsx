import { useEnquiries } from '../hooks/useEnquiries'
import { useFollowups } from '../hooks/useFollowups'
import { useCustomers } from '../hooks/useCustomers'

export default function Dashboard() {
  const { enquiries } = useEnquiries()
  const { followups } = useFollowups()
  const { customers: allCustomers } = useCustomers()

  const today = new Date().toISOString().split('T')[0]

  const openEnquiries = enquiries.filter(
    (e) => !['sale_completed', 'not_interested', 'lost', 'spam', 'duplicate'].includes(e.status)
  ).length
  const todayFollowups = followups.filter(
    (f) => f.dueDate ? new Date(f.dueDate).toISOString().split('T')[0] === today : false
  )
  const completedSales = enquiries.filter((e) => e.status === 'sale_completed').length

  const statCards = [
    { label: 'Total Customers', value: allCustomers.length, color: 'bg-blue-50 text-blue-700' },
    { label: "Today's Follow-ups", value: todayFollowups.length, color: 'bg-yellow-50 text-yellow-700' },
    { label: 'Open Enquiries', value: openEnquiries, color: 'bg-green-50 text-green-700' },
    { label: 'Sales Completed', value: completedSales, color: 'bg-purple-50 text-purple-700' },
  ]

  const recentEnquiries = enquiries.slice(0, 5)

  return (
    <div className="p-4 sm:p-6 max-w-full min-w-0">
      <h2 className="text-xl font-semibold text-gray-800 mb-6">Dashboard</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((card) => (
          <div key={card.label} className={`rounded-xl p-4 ${card.color}`}>
            <p className="text-2xl font-bold">{card.value}</p>
            <p className="text-sm mt-1">{card.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-700 mb-3">Today's Follow-ups</h3>
          {todayFollowups.length === 0 ? (
            <p className="text-sm text-gray-400">No follow-ups due today.</p>
          ) : (
            <div className="space-y-2">
              {todayFollowups.map((f) => (
                <div key={f.id} className="flex items-center gap-3 text-sm">
                  <span className="w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0" />
                  <span className="text-gray-700 truncate">{f.note || f.enquiryId}</span>
                  <span className="text-gray-400 ml-auto text-xs">{f.assignedTo}</span>
                </div>
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
              {recentEnquiries.map((e) => (
                <div key={e.id} className="flex items-center gap-3 text-sm">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${statusColor(e.status)}`}>
                    {e.status.replace(/_/g, ' ')}
                  </span>
                  <span className="text-gray-500 text-xs">
                    {e.createdAt ? new Date(e.createdAt).toLocaleDateString() : ''}
                  </span>
                  <span className="text-gray-400 ml-auto text-xs">{e.assignedTo ?? 'Unassigned'}</span>
                </div>
              ))}
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
