import { useEnquiries } from '../hooks/useEnquiries'
import { useCustomers } from '../hooks/useCustomers'

const PIPELINE_STAGES = [
  { key: 'new_lead', label: 'New Lead', color: 'bg-gray-400' },
  { key: 'assigned', label: 'Assigned', color: 'bg-blue-400' },
  { key: 'interested', label: 'Interested', color: 'bg-yellow-400' },
  { key: 'negotiation', label: 'Negotiation', color: 'bg-purple-400' },
  { key: 'ready_to_buy', label: 'Ready to Buy', color: 'bg-teal-400' },
  { key: 'sale_completed', label: 'Sale Completed', color: 'bg-green-500' },
]

export default function Analytics() {
  const { enquiries } = useEnquiries()
  const { customers } = useCustomers()

  const totalRevenue = enquiries
    .filter((e) => e.status === 'sale_completed')
    .reduce((sum, e) => sum + (e.value ?? 0), 0)

  const conversionRate =
    enquiries.length > 0
      ? Math.round(
          (enquiries.filter((e) => e.status === 'sale_completed').length / enquiries.length) * 100
        )
      : 0

  const stageCounts = PIPELINE_STAGES.map((s) => ({
    ...s,
    count: enquiries.filter((e) => e.status === s.key).length,
  }))

  const maxCount = Math.max(...stageCounts.map((s) => s.count), 1)

  const metrics = [
    { label: 'Total Customers', value: customers.length },
    { label: 'Total Enquiries', value: enquiries.length },
    { label: 'Conversion Rate', value: `${conversionRate}%` },
    { label: 'Total Revenue', value: `₹${totalRevenue.toLocaleString('en-IN')}` },
  ]

  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold text-gray-800 mb-6">Analytics</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {metrics.map((m) => (
          <div key={m.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-2xl font-bold text-gray-800">{m.value}</p>
            <p className="text-sm text-gray-500 mt-1">{m.label}</p>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-xl">
        <h3 className="font-semibold text-gray-700 mb-4">Pipeline Funnel</h3>
        <div className="space-y-3">
          {stageCounts.map((s) => (
            <div key={s.key}>
              <div className="flex justify-between text-sm text-gray-600 mb-1">
                <span>{s.label}</span>
                <span className="font-medium">{s.count}</span>
              </div>
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full ${s.color} rounded-full transition-all duration-500`}
                  style={{ width: `${(s.count / maxCount) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
