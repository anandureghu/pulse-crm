import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCustomers } from '../hooks/useCustomers'

export default function Customers() {
  const { customers, loading } = useCustomers()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search)
  )

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-800">Customers</h2>
        <span className="text-sm text-gray-400">{customers.length} total</span>
      </div>
      <div className="mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or phone…"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
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
                  {search ? 'No customers match your search.' : 'No customers yet. They will appear when WhatsApp messages arrive.'}
                </td>
              </tr>
            )}
            {filtered.map((c) => (
              <tr key={c.id} onClick={() => navigate(`/customers/${c.id}`)} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer">
                <td className="px-4 py-3 font-medium text-gray-800">{c.name}</td>
                <td className="px-4 py-3 text-gray-600">{c.phone}</td>
                <td className="px-4 py-3 text-gray-600">{c.assignedTo ?? '—'}</td>
                <td className="px-4 py-3">
                  {c.tags?.map((t) => (
                    <span key={t} className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full mr-1">
                      {t}
                    </span>
                  ))}
                </td>
                <td className="px-4 py-3 text-gray-500">
                  {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
