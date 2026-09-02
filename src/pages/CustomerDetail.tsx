import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getCustomer, getConversationByCustomer, updateCustomer, userLabel } from '../lib/db'
import { useEnquiriesByCustomer } from '../hooks/useEnquiries'
import { useNotes } from '../hooks/useNotes'
import { useActivities } from '../hooks/useActivities'
import { useMessages } from '../hooks/useConversations'
import { useCustomerFollowups } from '../hooks/useCustomerFollowups'
import { useUsers } from '../hooks/useUsers'
import { useAuthStore } from '../store/authStore'
import { assignEnquiryFn, updateEnquiryStatusFn } from '../lib/functions'
import { toast } from '../components/Toast'
import { MessageBubble } from '../components/MessageBubble'
import { FollowupFormModal } from '../components/FollowupFormModal'
import { formatPhoneDisplay, telHref } from '../lib/phone'
import type { Customer, Enquiry, Followup } from '../types'

type Tab = 'profile' | 'timeline' | 'whatsapp' | 'notes' | 'enquiries' | 'followups' | 'files' | 'calls' | 'payments'

const TABS: { key: Tab; label: string }[] = [
  { key: 'profile', label: 'Profile' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'notes', label: 'Notes' },
  { key: 'enquiries', label: 'Enquiries' },
  { key: 'followups', label: 'Follow-ups' },
  { key: 'files', label: 'Files' },
  { key: 'calls', label: 'Call Logs' },
  { key: 'payments', label: 'Payments' },
]

const STATUSES = [
  'new_lead', 'assigned', 'contact_attempted', 'interested', 'confused',
  'follow_up_required', 'negotiation', 'ready_to_buy',
  'payment_pending', 'sale_completed', 'after_sales', 'repeat_customer',
  'not_interested', 'lost', 'spam', 'duplicate',
]

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [convId, setConvId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('profile')
  const [loading, setLoading] = useState(true)
  const [selectedEnquiryIdx, setSelectedEnquiryIdx] = useState(0)

  const user = useAuthStore((s) => s.user)
  const users = useUsers()
  const { enquiries } = useEnquiriesByCustomer(id ?? '')
  const latestEnquiry = enquiries[0] ?? null
  const selectedEnquiry = enquiries[selectedEnquiryIdx] ?? latestEnquiry

  const { notes, add: addNote, remove: removeNote } = useNotes(selectedEnquiry?.id ?? null)
  const { activities, log: logActivity } = useActivities(selectedEnquiry?.id ?? null)
  const messages = useMessages(convId)
  const enquiryIds = enquiries.map((e) => e.id)
  const {
    pending: pendingFollowups,
    completed: completedFollowups,
    loading: followupsLoading,
    complete: completeFollowupItem,
    uncomplete: uncompleteFollowupItem,
    remove: removeFollowupItem,
    update: updateFollowupItem,
  } = useCustomerFollowups(enquiryIds)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [noteText, setNoteText] = useState('')
  const [showFollowupForm, setShowFollowupForm] = useState(false)
  const [editingFollowup, setEditingFollowup] = useState<Followup | null>(null)
  const [editName, setEditName] = useState('')
  const [editingName, setEditingName] = useState(false)

  useEffect(() => {
    if (!id) return
    getCustomer(id).then((c) => {
      setCustomer(c)
      setEditName(c?.name ?? '')
      setLoading(false)
    })
    getConversationByCustomer(id).then((c) => setConvId(c?.id ?? null))
  }, [id])

  const handleSaveName = async () => {
    if (!id || !editName.trim()) return
    const { error } = await updateCustomer(id, { name: editName.trim() })
    if (error) { toast('Failed to save name', 'error'); return }
    setCustomer((prev) => prev ? { ...prev, name: editName.trim() } : prev)
    setEditingName(false)
  }

  const handleAddNote = async () => {
    if (!noteText.trim()) return
    const result = await addNote(noteText.trim())
    if ((result as any)?.error) { toast('Failed to add note', 'error'); return }
    await logActivity('note_added', `Note added: "${noteText.slice(0, 80)}"`)
    setNoteText('')
  }

  const handleAssign = async (assignTo: string) => {
    if (!latestEnquiry || !assignTo) return
    try {
      await assignEnquiryFn({
        enquiryId: latestEnquiry.id,
        assignTo,
        customerId: customer?.id,
      })
      setCustomer((prev) => (prev ? { ...prev, assignedTo: assignTo } : prev))
      toast('Assigned successfully', 'success')
    } catch {
      toast('Failed to assign', 'error')
    }
  }

  const handleStatusChange = async (status: string) => {
    if (!latestEnquiry) return
    try {
      await updateEnquiryStatusFn({ enquiryId: latestEnquiry.id, status })
    } catch {
      toast('Failed to update status', 'error')
    }
  }

  if (loading) return <div className="p-6 text-gray-400 text-sm">Loading…</div>
  if (!customer) return <div className="p-6 text-gray-400 text-sm">Customer not found.</div>

  return (
    <div className="p-3 sm:p-6">
      {/* Header */}
      <div className="mb-4 md:mb-6 space-y-3">
        {/* Row 1: back + avatar + name */}
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/customers')} className="text-gray-400 hover:text-gray-600 text-sm flex-shrink-0 p-2 -ml-1 min-w-10 min-h-10" aria-label="Back">
            ←
          </button>
          <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-sm flex-shrink-0">
            {customer.name[0]?.toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-sm min-w-0 flex-1"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditingName(false) }}
                />
                <button onClick={handleSaveName} className="text-green-600 text-sm font-medium flex-shrink-0">Save</button>
                <button onClick={() => setEditingName(false)} className="text-gray-400 text-sm flex-shrink-0">✕</button>
              </div>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="text-base sm:text-xl font-semibold text-gray-800 truncate">{customer.name}</h2>
                <button onClick={() => setEditingName(true)} className="text-gray-400 hover:text-gray-600 text-xs flex-shrink-0">✏️</button>
              </div>
            )}
            <p className="text-xs text-gray-500 flex items-center gap-2">
              <span>{formatPhoneDisplay(customer.phone)}</span>
              {customer.phone && (
                <a href={telHref(customer.phone)} className="text-green-600 hover:text-green-700">
                  Call
                </a>
              )}
            </p>
          </div>
        </div>

        {/* Row 2: status + follow-up (full width on mobile) */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          {latestEnquiry ? (
            <select
              value={latestEnquiry.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
          ) : (
            <p className="flex-1 text-xs text-gray-400 self-center">No pipeline enquiry yet</p>
          )}
          <button
            type="button"
            onClick={() => setShowFollowupForm(true)}
            className="flex-shrink-0 bg-yellow-500 text-white px-3 py-2.5 rounded-lg text-sm hover:bg-yellow-600 w-full sm:w-auto"
          >
            + Follow-up
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-4 md:mb-6 overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 sm:px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
              tab === t.key
                ? 'border-green-600 text-green-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Enquiry selector for notes/timeline (shown only when relevant tab is active) */}
      {(tab === 'notes' || tab === 'timeline') && enquiries.length > 1 && (
        <div className="mb-4 flex items-center gap-2">
          <span className="text-xs text-gray-500">Enquiry:</span>
          <select
            value={selectedEnquiryIdx}
            onChange={(e) => setSelectedEnquiryIdx(Number(e.target.value))}
            className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            {enquiries.map((e, i) => (
              <option key={e.id} value={i}>
                #{enquiries.length - i} — {e.status.replace(/_/g, ' ')} ({e.createdAt ? new Date(e.createdAt).toLocaleDateString() : ''})
              </option>
            ))}
          </select>
        </div>
      )}

      {tab === 'profile' && (
        <ProfileTab customer={customer} latestEnquiry={latestEnquiry} users={users} onAssign={handleAssign} />
      )}
      {tab === 'timeline' && <TimelineTab activities={activities} />}
      {tab === 'whatsapp' && <WhatsAppTab messages={messages} customerPhone={customer.phone} />}
      {tab === 'notes' && (
        <NotesTab
          notes={notes}
          noteText={noteText}
          onNoteChange={setNoteText}
          onAddNote={handleAddNote}
          onDeleteNote={removeNote}
        />
      )}
      {tab === 'enquiries' && <EnquiriesTab enquiries={enquiries} />}
      {tab === 'followups' && (
        <CustomerFollowupsTab
          pending={pendingFollowups}
          completed={completedFollowups}
          loading={followupsLoading}
          users={users}
          onComplete={completeFollowupItem}
          onUncomplete={uncompleteFollowupItem}
          onDelete={removeFollowupItem}
          onEdit={setEditingFollowup}
          onSchedule={() => setShowFollowupForm(true)}
          canSchedule
        />
      )}
      {tab === 'files' && (
        <FilesTab
          customerId={id!}
          authorEmail={user?.email ?? ''}
          fileInputRef={fileInputRef}
          onActivity={(desc) => logActivity('file_uploaded', desc)}
        />
      )}
      {tab === 'calls' && <CallLogsTab customerId={id!} authorEmail={user?.email ?? ''} onActivity={logActivity} />}
      {tab === 'payments' && <PaymentsTab customerId={id!} authorEmail={user?.email ?? ''} onActivity={logActivity} />}

      {showFollowupForm && (
        <FollowupFormModal
          mode="create"
          lockedCustomerId={customer.id}
          lockedCustomerName={customer.name}
          onClose={() => setShowFollowupForm(false)}
          onSaved={() => {
            logActivity('followup_created', 'Follow-up scheduled')
          }}
        />
      )}
      {editingFollowup && (
        <FollowupFormModal
          mode="edit"
          editing={{
            ...editingFollowup,
            customerId: customer.id,
            customerName: customer.name,
            customerPhone: customer.phone,
          }}
          onClose={() => setEditingFollowup(null)}
          onUpdate={async (id, data) => updateFollowupItem(id, data)}
        />
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ProfileTab({
  customer,
  latestEnquiry,
  users,
  onAssign,
}: {
  customer: Customer
  latestEnquiry: Enquiry | null
  users: ReturnType<typeof useUsers>
  onAssign: (to: string) => void
}) {
  const [assignTo, setAssignTo] = useState(latestEnquiry?.assignedTo ?? '')
  const [assignSearch, setAssignSearch] = useState('')
  const [aiAutoreply, setAiAutoreply] = useState(customer.aiAutoreply ?? false)

  const toggleAiAutoreply = async () => {
    const next = !aiAutoreply
    setAiAutoreply(next)
    await supabase.from('customers').update({ ai_autoreply: next }).eq('id', customer.id)
  }

  useEffect(() => {
    setAssignTo(latestEnquiry?.assignedTo ?? customer.assignedTo ?? '')
  }, [latestEnquiry?.assignedTo, customer.assignedTo])

  const filteredUsers = users.filter((u) => {
    const q = assignSearch.trim().toLowerCase()
    if (!q) return true
    return (
      u.email.toLowerCase().includes(q)
      || (u.username ?? '').toLowerCase().includes(q)
    )
  })

  const labelFor = (u: { username: string | null; email: string }) =>
    u.username?.trim() || u.email

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 max-w-2xl">
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-700 mb-3">Contact Info</h3>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-500">Phone</dt>
            <dd className="text-gray-800 font-medium">{formatPhoneDisplay(customer.phone)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500 flex-shrink-0">Assigned to</dt>
            <dd className="text-gray-800 font-medium text-right truncate">
              {customer.assignedTo?.trim()
                || latestEnquiry?.assignedTo?.trim()
                || <span className="text-gray-400 font-normal">Unassigned</span>}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Customer since</dt>
            <dd className="text-gray-800">
              {customer.createdAt ? new Date(customer.createdAt).toLocaleDateString() : '—'}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Tags</dt>
            <dd className="flex gap-1 flex-wrap justify-end">
              {customer.tags?.length ? customer.tags.map((t) => (
                <span key={t} className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">{t}</span>
              )) : <span className="text-gray-400">None</span>}
            </dd>
          </div>
          <div className="flex justify-between items-center pt-2 border-t border-gray-100 mt-2">
            <dt className="text-gray-500 flex flex-col">
              <span>AI Auto-reply</span>
              <span className="text-xs text-gray-400">Auto-send AI replies (coming soon)</span>
            </dt>
            <dd>
              <button
                onClick={toggleAiAutoreply}
                className={`relative w-9 h-5 rounded-full transition-colors ${aiAutoreply ? 'bg-green-500' : 'bg-gray-200'}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${aiAutoreply ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </dd>
          </div>
        </dl>
      </div>

      {latestEnquiry && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-700 mb-3">Current Enquiry</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Status</dt>
              <dd className="text-gray-800 font-medium capitalize">{latestEnquiry.status.replace(/_/g, ' ')}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500 flex-shrink-0">Assigned to</dt>
              <dd className="text-gray-800 font-medium text-right truncate">
                {latestEnquiry.assignedTo?.trim()
                  || customer.assignedTo?.trim()
                  || <span className="text-gray-400 font-normal">Unassigned</span>}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Value</dt>
              <dd className="text-gray-800">₹{(latestEnquiry.value ?? 0).toLocaleString('en-IN')}</dd>
            </div>
            <div className="mt-3 space-y-2">
              <input
                type="search"
                value={assignSearch}
                onChange={(e) => setAssignSearch(e.target.value)}
                placeholder="Search by username or email…"
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <div className="flex gap-2">
                <select
                  value={assignTo}
                  onChange={(e) => setAssignTo(e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">Unassigned</option>
                  {assignTo && !filteredUsers.some((u) => labelFor(u) === assignTo || u.email === assignTo) && (
                    <option value={assignTo}>{assignTo}</option>
                  )}
                  {filteredUsers.map((u) => (
                    <option key={u.id} value={labelFor(u)}>
                      {labelFor(u)}{u.username ? ` · ${u.email}` : ''}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => onAssign(assignTo)}
                  disabled={!assignTo}
                  className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs hover:bg-green-700 disabled:opacity-40"
                >
                  Assign
                </button>
              </div>
            </div>
          </dl>
        </div>
      )}
    </div>
  )
}

function TimelineTab({ activities }: { activities: ReturnType<typeof useActivities>['activities'] }) {
  if (activities.length === 0) {
    return <p className="text-sm text-gray-400">No activity yet.</p>
  }
  return (
    <div className="max-w-lg space-y-1 w-full">
      {activities.map((a) => (
        <div key={a.id} className="flex gap-3 items-start">
          <div className="mt-1.5 w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
          <div>
            <p className="text-sm text-gray-800">{a.description}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {a.createdAt ? new Date(a.createdAt).toLocaleString() : ''} · {a.createdBy}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

function WhatsAppTab({
  messages,
  customerPhone,
}: {
  messages: ReturnType<typeof useMessages>
  customerPhone: string
}) {
  if (messages.length === 0) {
    return <p className="text-sm text-gray-400">No WhatsApp messages yet.</p>
  }
  return (
    <div className="max-w-lg w-full space-y-2 bg-gray-50 rounded-xl p-4">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} msg={msg} customerPhone={customerPhone} />
      ))}
    </div>
  )
}

function NotesTab({
  notes,
  noteText,
  onNoteChange,
  onAddNote,
  onDeleteNote,
}: {
  notes: ReturnType<typeof useNotes>['notes']
  noteText: string
  onNoteChange: (v: string) => void
  onAddNote: () => void
  onDeleteNote: (id: string) => void
}) {
  return (
    <div className="max-w-lg w-full">
      <div className="flex gap-2 mb-4">
        <textarea
          value={noteText}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="Add a note…"
          rows={2}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
        />
        <button
          onClick={onAddNote}
          disabled={!noteText.trim()}
          className="bg-green-600 text-white px-4 rounded-lg text-sm hover:bg-green-700 disabled:opacity-40"
        >
          Add
        </button>
      </div>
      {notes.length === 0 ? (
        <p className="text-sm text-gray-400">No notes yet.</p>
      ) : (
        <div className="space-y-2">
          {notes.map((n) => (
            <div key={n.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{n.content}</p>
              <div className="flex items-center justify-between mt-2">
                <p className="text-xs text-gray-400">
                  {n.author} · {n.createdAt ? new Date(n.createdAt).toLocaleString() : ''}
                </p>
                <button onClick={() => onDeleteNote(n.id)} className="text-xs text-red-400 hover:text-red-600">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function EnquiriesTab({ enquiries }: { enquiries: Enquiry[] }) {
  if (enquiries.length === 0) {
    return <p className="text-sm text-gray-400">No enquiries yet.</p>
  }
  return (
    <div className="max-w-lg w-full space-y-2">
      {enquiries.map((e, i) => (
        <div key={e.id} className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Enquiry #{enquiries.length - i}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${statusColor(e.status)}`}>
              {e.status.replace(/_/g, ' ')}
            </span>
          </div>
          <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
            <span>{e.createdAt ? new Date(e.createdAt).toLocaleDateString() : ''}</span>
            {e.value > 0 && <span className="font-medium text-gray-700">₹{e.value.toLocaleString('en-IN')}</span>}
            <span>{e.assignedTo ?? 'Unassigned'}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function CustomerFollowupsTab({
  pending,
  completed,
  loading,
  users,
  onComplete,
  onUncomplete,
  onDelete,
  onEdit,
  onSchedule,
  canSchedule,
}: {
  pending: Followup[]
  completed: Followup[]
  loading: boolean
  users: Array<{ id: string; email: string; username: string | null }>
  onComplete: (id: string) => Promise<boolean>
  onUncomplete: (id: string) => Promise<boolean>
  onDelete: (id: string) => Promise<boolean>
  onEdit: (f: Followup) => void
  onSchedule: () => void
  canSchedule: boolean
}) {
  const [subTab, setSubTab] = useState<'pending' | 'completed'>('pending')

  const labelFor = (assignedTo: string) => {
    const u = users.find((x) => x.email === assignedTo || x.id === assignedTo)
    return u ? userLabel(u) : assignedTo
  }

  const list = subTab === 'pending' ? pending : completed

  return (
    <div className="max-w-lg w-full">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div className="flex gap-1 border-b border-gray-200 overflow-x-auto min-w-0 -mx-1 px-1">
          {(
            [
              { key: 'pending' as const, label: 'Pending', count: pending.length },
              { key: 'completed' as const, label: 'Completed', count: completed.length },
            ]
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setSubTab(t.key)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
                subTab === t.key
                  ? 'border-green-600 text-green-700'
                  : 'border-transparent text-gray-500'
              }`}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>
        {canSchedule && (
          <button
            type="button"
            onClick={onSchedule}
            className="text-sm bg-yellow-500 text-white px-3 py-2.5 rounded-lg hover:bg-yellow-600 w-full sm:w-auto flex-shrink-0"
          >
            + Schedule
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-gray-400">
          {subTab === 'pending' ? 'No pending follow-ups for this customer.' : 'No completed follow-ups yet.'}
        </p>
      ) : (
        <div className="space-y-2">
          {list.map((f) => (
            <div key={f.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-start gap-3">
                {subTab === 'pending' ? (
                  <input
                    type="checkbox"
                    onChange={() => onComplete(f.id)}
                    className="mt-0.5 w-4 h-4 accent-green-600 cursor-pointer"
                    title="Mark complete"
                  />
                ) : (
                  <span className="mt-0.5 w-4 h-4 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-[10px]">✓</span>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800">{f.note || 'No note'}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(f.dueDate).toLocaleString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {' · '}
                    {labelFor(f.assignedTo)}
                    {f.completedAt && (
                      <>
                        {' · Done '}
                        {new Date(f.completedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      </>
                    )}
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-1 flex-shrink-0">
                  {subTab === 'pending' ? (
                    <button type="button" onClick={() => onEdit(f)} className="text-xs min-h-9 px-3 rounded-lg border border-gray-200 text-blue-600 hover:bg-blue-50">
                      Edit
                    </button>
                  ) : (
                    <button type="button" onClick={() => onUncomplete(f.id)} className="text-xs min-h-9 px-3 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                      Undo
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { if (confirm('Delete this follow-up?')) onDelete(f.id) }}
                    className="text-xs min-h-9 px-3 rounded-lg text-red-500 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function statusColor(status: string) {
  const map: Record<string, string> = {
    new_lead: 'bg-gray-100 text-gray-600',
    interested: 'bg-yellow-100 text-yellow-700',
    confused: 'bg-indigo-100 text-indigo-700',
    negotiation: 'bg-purple-100 text-purple-700',
    sale_completed: 'bg-green-100 text-green-700',
    lost: 'bg-red-100 text-red-600',
  }
  return map[status] ?? 'bg-gray-100 text-gray-600'
}

// ── Files tab ─────────────────────────────────────────────────────────────────

interface FileRecord {
  id: string
  name: string
  url: string
  size: number
  uploadedBy: string
  createdAt: string
}

function FilesTab({
  customerId,
  authorEmail,
  fileInputRef,
  onActivity,
}: {
  customerId: string
  authorEmail: string
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onActivity: (desc: string) => void
}) {
  const [files, setFiles] = useState<FileRecord[]>([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const fetchFiles = () =>
      supabase
        .from('customer_files')
        .select('*')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .then(({ data }) => {
          setFiles(
            (data ?? []).map((r) => ({
              id: r.id,
              name: r.name,
              url: r.url,
              size: r.size,
              uploadedBy: r.uploaded_by,
              createdAt: r.created_at,
            }))
          )
        })

    fetchFiles()

    const channel = supabase
      .channel(`customer_files:${customerId}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_files', filter: `customer_id=eq.${customerId}` }, fetchFiles)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [customerId])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setProgress(10)

    const path = `${customerId}/${Date.now()}_${file.name}`

    try {
      const { error: uploadError } = await supabase.storage
        .from('customer-files')
        .upload(path, file, { upsert: false })

      if (uploadError) throw uploadError

      setProgress(90)

      const { data: urlData } = supabase.storage.from('customer-files').getPublicUrl(path)
      const url = urlData.publicUrl

      const { error: dbError } = await supabase.from('customer_files').insert({
        customer_id: customerId,
        name: file.name,
        url,
        size: file.size,
        uploaded_by: authorEmail,
      })

      if (dbError) throw dbError

      onActivity(`File uploaded: ${file.name}`)
      toast(`${file.name} uploaded`, 'success')
    } catch {
      toast('Upload failed — please try again', 'error')
    } finally {
      // Always reset input so the same file can be retried
      if (fileInputRef.current) fileInputRef.current.value = ''
      setUploading(false)
      setProgress(0)
    }
  }

  return (
    <div className="max-w-lg w-full">
      <div className="mb-4 flex items-center gap-3">
        <input ref={fileInputRef} type="file" onChange={handleUpload} className="hidden" />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-40"
        >
          {uploading ? `Uploading ${progress}%…` : '+ Upload File'}
        </button>
        {uploading && (
          <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
      {files.length === 0 ? (
        <p className="text-sm text-gray-400">No files uploaded yet.</p>
      ) : (
        <div className="space-y-2">
          {files.map((f) => (
            <div key={f.id} className="bg-white rounded-xl border border-gray-200 p-3 flex items-center gap-3">
              <span className="text-2xl">📎</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{f.name}</p>
                <p className="text-xs text-gray-400">
                  {(f.size / 1024).toFixed(1)} KB · {f.uploadedBy} · {f.createdAt ? new Date(f.createdAt).toLocaleDateString() : ''}
                </p>
              </div>
              <a
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-green-600 hover:underline flex-shrink-0"
              >
                Download
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Call Logs tab ─────────────────────────────────────────────────────────────

interface CallLog {
  id: string
  direction: 'inbound' | 'outbound'
  duration: number
  outcome: string
  notes: string
  loggedBy: string
  createdAt: string
}

function CallLogsTab({
  customerId,
  authorEmail,
  onActivity,
}: {
  customerId: string
  authorEmail: string
  onActivity: (type: string, desc: string) => void
}) {
  const [logs, setLogs] = useState<CallLog[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ direction: 'outbound', duration: '', outcome: 'answered', notes: '' })

  useEffect(() => {
    const fetchLogs = () =>
      supabase
        .from('call_logs')
        .select('*')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .then(({ data }) => {
          setLogs(
            (data ?? []).map((r) => ({
              id: r.id,
              direction: r.direction,
              duration: r.duration,
              outcome: r.outcome,
              notes: r.notes,
              loggedBy: r.logged_by,
              createdAt: r.created_at,
            }))
          )
        })

    fetchLogs()

    const channel = supabase
      .channel(`call_logs:${customerId}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_logs', filter: `customer_id=eq.${customerId}` }, fetchLogs)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [customerId])

  const handleSave = async () => {
    const { error } = await supabase.from('call_logs').insert({
      customer_id: customerId,
      direction: form.direction,
      duration: Number(form.duration) || 0,
      outcome: form.outcome,
      notes: form.notes,
      logged_by: authorEmail,
    })
    if (error) { toast('Failed to log call', 'error'); return }
    onActivity('call_logged', `Call logged: ${form.outcome}, ${form.duration}min`)
    setForm({ direction: 'outbound', duration: '', outcome: 'answered', notes: '' })
    setShowForm(false)
    toast('Call logged', 'success')
  }

  return (
    <div className="max-w-lg w-full">
      <button
        onClick={() => setShowForm(true)}
        className="mb-4 bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700"
      >
        + Log Call
      </button>
      {showForm && (
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 mb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Direction</label>
              <select value={form.direction} onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none">
                <option value="outbound">Outbound</option>
                <option value="inbound">Inbound</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Outcome</label>
              <select value={form.outcome} onChange={(e) => setForm((f) => ({ ...f, outcome: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none">
                <option value="answered">Answered</option>
                <option value="no_answer">No Answer</option>
                <option value="voicemail">Voicemail</option>
                <option value="callback_requested">Callback Requested</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Duration (mins)</label>
              <input type="number" value={form.duration} onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))}
                min="0" placeholder="0"
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2} placeholder="Call summary…"
              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none resize-none" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} className="bg-green-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-green-700">Save</button>
            <button onClick={() => setShowForm(false)} className="text-gray-500 text-sm">Cancel</button>
          </div>
        </div>
      )}
      {logs.length === 0 ? (
        <p className="text-sm text-gray-400">No call logs yet.</p>
      ) : (
        <div className="space-y-2">
          {logs.map((l) => (
            <div key={l.id} className="bg-white rounded-xl border border-gray-200 p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs px-2 py-0.5 rounded-full ${l.direction === 'inbound' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                  {l.direction}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${l.outcome === 'answered' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                  {l.outcome.replace(/_/g, ' ')}
                </span>
                <span className="text-xs text-gray-400 ml-auto">{l.duration}min</span>
              </div>
              {l.notes && <p className="text-sm text-gray-700">{l.notes}</p>}
              <p className="text-xs text-gray-400 mt-1">
                {l.loggedBy} · {l.createdAt ? new Date(l.createdAt).toLocaleString() : ''}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Payments tab ──────────────────────────────────────────────────────────────

interface Payment {
  id: string
  amount: number
  currency: string
  method: string
  status: string
  reference: string
  notes: string
  recordedBy: string
  createdAt: string
}

const EMPTY_PAYMENT_FORM = {
  amount: '',
  currency: 'INR',
  method: 'bank_transfer',
  status: 'received',
  reference: '',
  notes: '',
}

function PaymentsTab({
  customerId,
  authorEmail,
  onActivity,
}: {
  customerId: string
  authorEmail: string
  onActivity: (type: string, desc: string) => void
}) {
  const [payments, setPayments] = useState<Payment[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(EMPTY_PAYMENT_FORM)

  const mapPayment = (r: Record<string, unknown>): Payment => ({
    id: r.id as string,
    amount: Number(r.amount),
    currency: (r.currency as string) || 'INR',
    method: (r.method as string) || 'cash',
    status: (r.status as string) || 'pending',
    reference: (r.reference as string) || '',
    notes: (r.notes as string) || '',
    recordedBy: (r.recorded_by as string) || '',
    createdAt: (r.created_at as string) || '',
  })

  const fetchPayments = async () => {
    const { data } = await supabase
      .from('payments')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
    setPayments((data ?? []).map((r) => mapPayment(r as Record<string, unknown>)))
  }

  useEffect(() => {
    fetchPayments()

    // Unique channel name — DELETE filters often miss without REPLICA IDENTITY FULL
    const channel = supabase
      .channel(`payments:${customerId}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments', filter: `customer_id=eq.${customerId}` }, () => {
        fetchPayments()
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_PAYMENT_FORM)
    setShowForm(true)
  }

  const openEdit = (p: Payment) => {
    setEditingId(p.id)
    setForm({
      amount: String(p.amount),
      currency: p.currency || 'INR',
      method: p.method || 'bank_transfer',
      status: p.status || 'received',
      reference: p.reference || '',
      notes: p.notes || '',
    })
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_PAYMENT_FORM)
  }

  const handleSave = async () => {
    if (!form.amount || Number(form.amount) < 0) {
      toast('Enter a valid amount', 'error')
      return
    }
    setSaving(true)
    const payload = {
      amount: Number(form.amount),
      currency: form.currency,
      method: form.method,
      status: form.status,
      reference: form.reference.trim(),
      notes: form.notes.trim(),
    }

    try {
      if (editingId) {
        const { data, error } = await supabase
          .from('payments')
          .update(payload)
          .eq('id', editingId)
          .select('*')
          .single()
        if (error) { toast('Failed to update payment', 'error'); return }
        if (data) {
          const updated = mapPayment(data as Record<string, unknown>)
          setPayments((prev) => prev.map((p) => (p.id === editingId ? updated : p)))
        } else {
          await fetchPayments()
        }
        onActivity('payment_updated', `Payment updated: ${form.currency} ${form.amount} (${form.status})`)
        toast('Payment updated', 'success')
      } else {
        const { data, error } = await supabase
          .from('payments')
          .insert({
            customer_id: customerId,
            ...payload,
            recorded_by: authorEmail,
          })
          .select('*')
          .single()
        if (error) { toast('Failed to record payment', 'error'); return }
        if (data) {
          const created = mapPayment(data as Record<string, unknown>)
          setPayments((prev) => [created, ...prev.filter((p) => p.id !== created.id)])
        } else {
          await fetchPayments()
        }
        onActivity('payment_recorded', `Payment recorded: ${form.currency} ${form.amount} (${form.status})`)
        toast('Payment recorded', 'success')
      }
      closeForm()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (p: Payment) => {
    if (!confirm(`Delete payment of ${p.currency === 'INR' ? '₹' : p.currency + ' '}${p.amount.toLocaleString('en-IN')}?`)) return
    const { error } = await supabase.from('payments').delete().eq('id', p.id)
    if (error) { toast('Failed to delete payment', 'error'); return }
    // Update list immediately — realtime DELETE with filters is unreliable
    setPayments((prev) => prev.filter((x) => x.id !== p.id))
    if (editingId === p.id) closeForm()
    onActivity('payment_deleted', `Payment deleted: ${p.currency} ${p.amount}`)
    toast('Payment deleted', 'success')
  }

  const total = payments.filter((p) => p.status === 'received').reduce((s, p) => s + p.amount, 0)
  const pendingTotal = payments.filter((p) => p.status === 'pending').reduce((s, p) => s + p.amount, 0)

  return (
    <div className="max-w-lg w-full">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <button
          type="button"
          onClick={openCreate}
          className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700"
        >
          + Record Payment
        </button>
        {payments.length > 0 && (
          <div className="text-right text-sm">
            <p className="font-semibold text-gray-700">Received: ₹{total.toLocaleString('en-IN')}</p>
            {pendingTotal > 0 && (
              <p className="text-xs text-amber-600">Pending: ₹{pendingTotal.toLocaleString('en-IN')}</p>
            )}
          </div>
        )}
      </div>

      {showForm && (
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 mb-4 space-y-3">
          <h4 className="text-sm font-semibold text-gray-800">
            {editingId ? 'Edit Payment' : 'Record Payment'}
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Amount</label>
              <input
                type="number"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0"
                min="0"
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Currency</label>
              <select
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option>INR</option><option>USD</option><option>EUR</option><option>GBP</option><option>AED</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Method</label>
              <select
                value={form.method}
                onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="cheque">Cheque</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="received">Received</option>
                <option value="pending">Pending</option>
                <option value="refunded">Refunded</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Reference</label>
            <input
              value={form.reference}
              onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
              placeholder="TXN-12345 / COD"
              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Notes</label>
            <input
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Optional note"
              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={!form.amount || saving}
              className="bg-green-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-green-700 disabled:opacity-40"
            >
              {saving ? 'Saving…' : editingId ? 'Update' : 'Save'}
            </button>
            <button type="button" onClick={closeForm} className="text-gray-500 text-sm px-2">
              Cancel
            </button>
          </div>
        </div>
      )}

      {payments.length === 0 ? (
        <p className="text-sm text-gray-400">No payments recorded yet.</p>
      ) : (
        <div className="space-y-2">
          {payments.map((p) => (
            <div
              key={p.id}
              className={`bg-white rounded-xl border p-3 ${
                editingId === p.id ? 'border-green-400 ring-1 ring-green-100' : 'border-gray-200'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-800">
                      {p.currency === 'INR' ? '₹' : `${p.currency} `}{p.amount.toLocaleString('en-IN')}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      p.status === 'received' ? 'bg-green-100 text-green-700'
                      : p.status === 'pending' ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-red-100 text-red-600'
                    }`}>{p.status}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-gray-400">
                    <span className="capitalize">{p.method.replace(/_/g, ' ')}</span>
                    {p.reference && <span>Ref: {p.reference}</span>}
                    <span>{p.createdAt ? new Date(p.createdAt).toLocaleDateString() : ''}</span>
                  </div>
                  {p.notes && <p className="text-xs text-gray-500 mt-1">{p.notes}</p>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto justify-stretch sm:justify-end">
                  <button
                    type="button"
                    onClick={() => openEdit(p)}
                    className="text-xs min-h-9 px-3 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 flex-1 sm:flex-none"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(p)}
                    className="text-xs min-h-9 px-3 rounded-lg text-red-500 hover:bg-red-50 flex-1 sm:flex-none"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
