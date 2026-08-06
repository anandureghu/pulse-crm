import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { toast } from '../components/Toast'

type TeamMember = { id: string; email: string; role: 'admin' | 'sales'; phone: string | null }

export default function Team() {
  const { user } = useAuthStore()
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitePhone, setInvitePhone] = useState('')
  const [inviteRole, setInviteRole] = useState<'sales' | 'admin'>('sales')
  const [editingPhone, setEditingPhone] = useState<string | null>(null)
  const [phoneInput, setPhoneInput] = useState('')
  const [inviting, setInviting] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('users').select('id, email, role, phone').order('email')
    setMembers((data ?? []) as TeamMember[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return
    setInviting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
        }
      )
      const body = await res.json()
      if (!res.ok) { toast(body.error ?? 'Invite failed', 'error'); return }
      // Save phone if provided — the user row is created by handle_new_user trigger
      if (invitePhone.trim() && body?.userId) {
        await supabase.from('users').update({ phone: invitePhone.trim() }).eq('id', body.userId)
      }
      toast(`Invite sent to ${inviteEmail.trim()}`, 'success')
      setShowInvite(false)
      setInviteEmail('')
      setInvitePhone('')
      setInviteRole('sales')
      load()
    } catch {
      toast('Invite failed', 'error')
    } finally {
      setInviting(false)
    }
  }

  const handleRoleChange = async (memberId: string, role: 'admin' | 'sales') => {
    const { error } = await supabase.from('users').update({ role }).eq('id', memberId)
    if (error) { toast('Failed to update role', 'error'); return }
    setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, role } : m)))
    toast('Role updated', 'success')
  }

  const handlePhoneSave = async (memberId: string) => {
    const phone = phoneInput.trim() || null
    const { error } = await supabase.from('users').update({ phone }).eq('id', memberId)
    if (error) { toast('Failed to save phone', 'error'); return }
    setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, phone } : m)))
    setEditingPhone(null)
    toast('Phone saved', 'success')
  }

  const handleRemove = async (memberId: string, email: string) => {
    if (!confirm(`Remove ${email} from the team? They will lose access immediately.`)) return
    setRemoving(memberId)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/remove-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ userId: memberId }),
        }
      )
      const body = await res.json()
      if (!res.ok) { toast(body.error ?? 'Remove failed', 'error'); return }
      toast(`${email} removed`, 'success')
      setMembers((prev) => prev.filter((m) => m.id !== memberId))
    } catch {
      toast('Remove failed', 'error')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto w-full">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-gray-800">Team</h2>
          <p className="text-sm text-gray-500 mt-0.5">Invite teammates and manage their roles</p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="flex-shrink-0 bg-green-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-green-700"
        >
          + Invite user
        </button>
      </div>

      {/* Invite modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-gray-800 mb-4">Invite team member</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Email address</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
                  placeholder="colleague@company.com"
                  autoFocus
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">WhatsApp number <span className="text-gray-400">(optional)</span></label>
                <input
                  type="tel"
                  value={invitePhone}
                  onChange={(e) => setInvitePhone(e.target.value)}
                  placeholder="91XXXXXXXXXX"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'sales' | 'admin')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="sales">Sales</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <p className="text-xs text-gray-400">
                They'll receive an email to set their password and join the team.
                Add their WhatsApp number to receive automatic event notifications.
              </p>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => { setShowInvite(false); setInviteEmail(''); setInviteRole('sales') }}
                className="flex-1 border border-gray-300 text-gray-700 text-sm font-medium py-2 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleInvite}
                disabled={inviting || !inviteEmail.trim()}
                className="flex-1 bg-green-600 text-white text-sm font-medium py-2 rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {inviting ? 'Sending…' : 'Send invite'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Members table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? (
          <p className="text-sm text-gray-400 p-6">Loading…</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-gray-400 p-6">No team members yet.</p>
        ) : (
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left text-xs font-medium text-gray-500 px-4 py-3">Email</th>
                <th className="text-left text-xs font-medium text-gray-500 px-4 py-3">WhatsApp</th>
                <th className="text-left text-xs font-medium text-gray-500 px-4 py-3">Role</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3 text-gray-800 whitespace-nowrap">
                    {m.email}
                    {m.id === user?.id && (
                      <span className="ml-2 text-xs text-gray-400">(you)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {editingPhone === m.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="tel"
                          value={phoneInput}
                          onChange={(e) => setPhoneInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handlePhoneSave(m.id)
                            if (e.key === 'Escape') setEditingPhone(null)
                          }}
                          autoFocus
                          placeholder="91XXXXXXXXXX"
                          className="border border-gray-300 rounded px-2 py-1 text-xs w-36 focus:outline-none focus:ring-2 focus:ring-green-500"
                        />
                        <button onClick={() => handlePhoneSave(m.id)} className="text-xs text-green-600 hover:text-green-800 font-medium">Save</button>
                        <button onClick={() => setEditingPhone(null)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditingPhone(m.id); setPhoneInput(m.phone ?? '') }}
                        className="text-xs text-gray-500 hover:text-gray-800 group flex items-center gap-1"
                      >
                        {m.phone ? (
                          <>
                            <span className="text-green-600">📱</span>
                            <span>{m.phone}</span>
                          </>
                        ) : (
                          <span className="text-gray-300 group-hover:text-gray-500">+ Add number</span>
                        )}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {m.id === user?.id ? (
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 capitalize">
                        {m.role}
                      </span>
                    ) : (
                      <select
                        value={m.role}
                        onChange={(e) => handleRoleChange(m.id, e.target.value as 'admin' | 'sales')}
                        className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
                      >
                        <option value="sales">Sales</option>
                        <option value="admin">Admin</option>
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {m.id !== user?.id && (
                      <button
                        onClick={() => handleRemove(m.id, m.email)}
                        disabled={removing === m.id}
                        className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40"
                      >
                        {removing === m.id ? 'Removing…' : 'Remove'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
