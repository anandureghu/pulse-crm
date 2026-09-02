import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useConversations, useMessages } from '../hooks/useConversations'
import { useCustomers } from '../hooks/useCustomers'
import { useEnquiries } from '../hooks/useEnquiries'
import { useUsers } from '../hooks/useUsers'
import { useAuthStore } from '../store/authStore'
import { sendMessageFn, assignEnquiryFn } from '../lib/functions'
import { starMessage, clearConversationMessages, userLabel } from '../lib/db'
import { formatPhoneDisplay, telHref } from '../lib/phone'
import { toast } from '../components/Toast'
import { MessageBubble } from '../components/MessageBubble'
import type { Conversation, EnquiryStatus, Message } from '../types'

type AssigneeFilter = 'all' | 'me' | 'other'

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ')
}

function statusColor(status: string): string {
  const map: Record<string, string> = {
    new_lead: 'bg-gray-100 text-gray-600',
    assigned: 'bg-blue-100 text-blue-700',
    contact_attempted: 'bg-sky-100 text-sky-700',
    interested: 'bg-yellow-100 text-yellow-700',
    confused: 'bg-indigo-100 text-indigo-700',
    follow_up_required: 'bg-orange-100 text-orange-700',
    negotiation: 'bg-purple-100 text-purple-700',
    ready_to_buy: 'bg-teal-100 text-teal-700',
    payment_pending: 'bg-amber-100 text-amber-700',
    sale_completed: 'bg-green-100 text-green-700',
    after_sales: 'bg-emerald-100 text-emerald-700',
    repeat_customer: 'bg-green-100 text-green-700',
    not_interested: 'bg-red-100 text-red-600',
    lost: 'bg-red-100 text-red-600',
    spam: 'bg-red-100 text-red-600',
    duplicate: 'bg-red-100 text-red-600',
  }
  return map[status] ?? 'bg-gray-100 text-gray-600'
}

function smartTimestamp(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  if (now.getTime() - date.getTime() < 7 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString([], { weekday: 'short' })
  }
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

export default function Inbox() {
  const { conversations, loading } = useConversations()
  const { customers } = useCustomers()
  const { enquiries } = useEnquiries()
  const users = useUsers()
  const authUser = useAuthStore((s) => s.user)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selected, setSelected] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [search, setSearch] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>('all')
  const [optimistic, setOptimistic] = useState<Message[]>([])
  const [clearConfirm, setClearConfirm] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const actionsRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const messages = useMessages(selected)
  const conv = conversations.find((c) => c.id === selected)
  const selectedCustomer = conv
    ? customers.find((c) => c.id === conv.customerId)
    : undefined

  const meLabel = (() => {
    const row = users.find((u) => u.id === authUser?.id)
    if (row) return userLabel(row)
    return authUser?.email ?? ''
  })()

  useEffect(() => {
    if (optimistic.length === 0) return
    setOptimistic((prev) =>
      prev.filter((o) => {
        const sentTime = new Date(o.timestamp).getTime()
        return !messages.some(
          (m) =>
            m.text === o.text &&
            m.sender === 'agent' &&
            Math.abs(new Date(m.timestamp).getTime() - sentTime) < 30_000
        )
      })
    )
  }, [messages]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setAiSuggestion(null)
    setActionsOpen(false)
  }, [selected])

  // Deep-link from "Add customer" → open that conversation
  useEffect(() => {
    const c = searchParams.get('c')
    if (!c) return
    setSelected(c)
    searchParams.delete('c')
    setSearchParams(searchParams, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    if (!selected) return
    const c = conversations.find((cv) => cv.id === selected)
    if (c && c.unreadCount > 0) {
      supabase.from('conversations').update({ unread_count: 0 }).eq('id', selected).then(() => {})
    }
  }, [selected, conversations])

  useEffect(() => {
    if (!actionsOpen) return
    const onDoc = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setActionsOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [actionsOpen])

  // Latest enquiry status per customer (enquiries are ordered newest-first)
  const statusByCustomer = (() => {
    const map = new Map<string, EnquiryStatus>()
    for (const e of enquiries) {
      if (!map.has(e.customerId)) map.set(e.customerId, e.status)
    }
    return map
  })()

  const customerName = (c: Conversation) =>
    customers.find((cu) => cu.id === c.customerId)?.name ?? c.customerId

  const customerAssignee = (c: Conversation) =>
    customers.find((cu) => cu.id === c.customerId)?.assignedTo?.trim() || null

  const customerStatus = (c: Conversation) =>
    statusByCustomer.get(c.customerId) ?? null

  const matchesAssigneeFilter = (c: Conversation, filter: AssigneeFilter) => {
    if (filter === 'all') return true
    const assignee = customerAssignee(c)
    if (filter === 'me') return Boolean(meLabel) && assignee === meLabel
    // other: not assigned to me (unassigned or someone else)
    return !meLabel || assignee !== meLabel
  }

  const filterCounts = {
    all: conversations.length,
    me: conversations.filter((c) => matchesAssigneeFilter(c, 'me')).length,
    other: conversations.filter((c) => matchesAssigneeFilter(c, 'other')).length,
  }

  const filtered = conversations.filter((c) => {
    if (!matchesAssigneeFilter(c, assigneeFilter)) return false
    if (!search) return true
    const q = search.toLowerCase()
    const name = customerName(c).toLowerCase()
    const phone = customers.find((cu) => cu.id === c.customerId)?.phone ?? ''
    const assignee = customerAssignee(c)?.toLowerCase() ?? ''
    const status = customerStatus(c)?.replace(/_/g, ' ') ?? ''
    return name.includes(q) || phone.includes(q) || assignee.includes(q) || status.includes(q)
  })

  const selectedVisible = !selected || filtered.some((c) => c.id === selected)

  // Drop selection when the open chat no longer matches the active filters
  useEffect(() => {
    if (selected && !selectedVisible) setSelected(null)
  }, [selected, selectedVisible])

  const allMessages = [
    ...messages,
    ...optimistic.filter((o) => {
      const sentTime = new Date(o.timestamp).getTime()
      return !messages.some(
        (m) =>
          m.text === o.text &&
          m.sender === 'agent' &&
          Math.abs(new Date(m.timestamp).getTime() - sentTime) < 30_000
      )
    }),
  ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [allMessages.length])

  const handleSend = async () => {
    if (!text.trim() || !selected || sending) return
    const msgText = text.trim()
    setSending(true)
    setText('')

    const tmpMsg: Message = {
      id: `tmp-${Date.now()}`,
      conversationId: selected,
      sender: 'agent',
      type: 'text',
      text: msgText,
      status: 'sent',
      timestamp: new Date().toISOString(),
    }
    setOptimistic((prev) => [...prev, tmpMsg])

    try {
      await sendMessageFn({ conversationId: selected, text: msgText })
    } catch {
      setOptimistic((prev) => prev.filter((m) => m.id !== tmpMsg.id))
      setText(msgText)
      toast('Failed to send message', 'error')
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleStar = async (id: string, starred: boolean) => {
    await starMessage(id, starred)
  }

  const handleClear = async () => {
    if (!selected) return
    setClearing(true)
    try {
      const count = await clearConversationMessages(selected)
      toast(`Cleared ${count} message${count !== 1 ? 's' : ''}`, 'success')
      setClearConfirm(false)
    } catch {
      toast('Failed to clear messages', 'error')
    } finally {
      setClearing(false)
    }
  }

  const handleAssignToMe = async () => {
    if (!selectedCustomer || !meLabel) return
    setAssigning(true)
    setActionsOpen(false)
    try {
      const { data: enq } = await supabase
        .from('enquiries')
        .select('id')
        .eq('customer_id', selectedCustomer.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (enq?.id) {
        await assignEnquiryFn({
          enquiryId: enq.id,
          assignTo: meLabel,
          customerId: selectedCustomer.id,
        })
      } else {
        // No enquiry yet — still stamp the customer
        const { error } = await supabase
          .from('customers')
          .update({ assigned_to: meLabel })
          .eq('id', selectedCustomer.id)
        if (error) throw error
      }
      toast(`Assigned to ${meLabel}`, 'success')
    } catch {
      toast('Failed to assign', 'error')
    } finally {
      setAssigning(false)
    }
  }

  const copyPhone = async () => {
    if (!selectedCustomer?.phone) return
    const display = formatPhoneDisplay(selectedCustomer.phone)
    try {
      await navigator.clipboard.writeText(display)
      toast('Phone copied', 'success')
    } catch {
      toast('Could not copy', 'error')
    }
    setActionsOpen(false)
  }

  const starredCount = allMessages.filter((m) => m.starred).length
  const unstarredCount = allMessages.filter((m) => !m.starred && !m.id.startsWith('tmp-')).length

  const handleAiSuggest = async () => {
    if (!selected || aiLoading) return
    setAiLoading(true)
    setAiSuggestion(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-reply`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ conversationId: selected }),
        }
      )
      const body = await res.json()
      if (!res.ok) { toast(body.error ?? 'AI suggestion failed', 'error'); return }
      setAiSuggestion(body.reply)
    } catch {
      toast('AI suggestion failed', 'error')
    } finally {
      setAiLoading(false)
    }
  }

  const phoneDisplay = selectedCustomer ? formatPhoneDisplay(selectedCustomer.phone) : ''
  const assignedBadge = selectedCustomer?.assignedTo?.trim() || null
  const statusBadge = selectedCustomer
    ? statusByCustomer.get(selectedCustomer.id) ?? null
    : null

  return (
    <div className="flex h-full min-h-0 min-w-0">
      <div className={`${selected ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-72 border-r border-gray-200 bg-white flex-shrink-0 min-h-0`}>
        <div className="p-4 border-b border-gray-200 space-y-2">
          <h2 className="font-semibold text-gray-800">Inbox</h2>
          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value as AssigneeFilter)}
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50"
            aria-label="Filter by assignee"
          >
            <option value="all">All ({filterCounts.all})</option>
            <option value="me">Assigned to me ({filterCounts.me})</option>
            <option value="other">Other ({filterCounts.other})</option>
          </select>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations…"
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50"
          />
        </div>
        <div className="flex-1 overflow-auto">
          {loading && <p className="text-sm text-gray-400 p-4">Loading…</p>}
          {!loading && filtered.length === 0 && (
            <p className="text-sm text-gray-400 p-4">
              {search || assigneeFilter !== 'all' ? 'No matches.' : 'No conversations yet.'}
            </p>
          )}
          {filtered.map((c) => {
            const assignee = customerAssignee(c)
            const status = customerStatus(c)
            return (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                  selected === c.id ? 'bg-green-50' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm text-gray-800 truncate">
                    {customerName(c)}
                  </span>
                  <span className="text-xs text-gray-400 flex-shrink-0">
                    {c.updatedAt ? smartTimestamp(c.updatedAt) : ''}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1 gap-2">
                  <span className="text-xs text-gray-500 truncate">{c.lastMessage}</span>
                  {c.unreadCount > 0 && (
                    <span className="bg-green-500 text-white text-xs rounded-full min-w-[20px] h-5 flex items-center justify-center px-1 flex-shrink-0">
                      {c.unreadCount}
                    </span>
                  )}
                </div>
                {(assignee || status) && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {status && (
                      <span
                        className={`inline-flex max-w-full text-[11px] px-2 py-0.5 rounded-full truncate capitalize ${statusColor(status)}`}
                        title={`Status: ${statusLabel(status)}`}
                      >
                        {statusLabel(status)}
                      </span>
                    )}
                    {assignee && (
                      <span className="inline-flex max-w-full bg-blue-100 text-blue-700 text-[11px] px-2 py-0.5 rounded-full truncate">
                        {assignee}
                      </span>
                    )}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className={`${selected ? 'flex' : 'hidden md:flex'} flex-1 flex-col bg-gray-50 min-w-0 min-h-0`}>
        {conv ? (
          <>
            <div className="bg-white border-b border-gray-200 px-3 py-3 flex items-center gap-2">
              <button
                onClick={() => setSelected(null)}
                className="md:hidden text-gray-400 hover:text-gray-600 p-1 -ml-1 flex-shrink-0"
                aria-label="Back to conversations"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M13 16l-6-6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-sm flex-shrink-0">
                {customerName(conv)[0]?.toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm text-gray-800 truncate">{customerName(conv)}</p>
                {(statusBadge || assignedBadge) && (
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {statusBadge && (
                      <span
                        className={`inline-flex max-w-full text-[11px] px-2 py-0.5 rounded-full truncate capitalize ${statusColor(statusBadge)}`}
                        title={`Status: ${statusLabel(statusBadge)}`}
                      >
                        {statusLabel(statusBadge)}
                      </span>
                    )}
                    {assignedBadge && (
                      <span
                        className="inline-flex max-w-full bg-blue-100 text-blue-700 text-[11px] px-2 py-0.5 rounded-full truncate"
                        title={`Assigned to ${assignedBadge}`}
                      >
                        {assignedBadge}
                      </span>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span className="truncate">{phoneDisplay || '—'}</span>
                  {phoneDisplay && (
                    <button
                      type="button"
                      onClick={copyPhone}
                      className="text-gray-400 hover:text-gray-700 flex-shrink-0"
                      title="Copy number"
                    >
                      ⎘
                    </button>
                  )}
                </div>
              </div>

              <div className="relative flex-shrink-0" ref={actionsRef}>
                <button
                  type="button"
                  onClick={() => setActionsOpen((o) => !o)}
                  className="text-xs font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 px-2.5 py-1.5 rounded-lg"
                >
                  Actions ▾
                </button>
                {actionsOpen && (
                  <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1 text-sm">
                    <button
                      type="button"
                      disabled={assigning || !meLabel}
                      onClick={handleAssignToMe}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700 disabled:opacity-40"
                    >
                      {assigning ? 'Assigning…' : 'Assign to me'}
                    </button>
                    {selectedCustomer && (
                      <Link
                        to={`/customers/${selectedCustomer.id}`}
                        className="block px-3 py-2 hover:bg-gray-50 text-gray-700"
                        onClick={() => setActionsOpen(false)}
                      >
                        Customer details
                      </Link>
                    )}
                    {phoneDisplay && (
                      <a
                        href={telHref(selectedCustomer?.phone)}
                        className="block px-3 py-2 hover:bg-gray-50 text-gray-700"
                        onClick={() => setActionsOpen(false)}
                      >
                        Call {phoneDisplay}
                      </a>
                    )}
                    {phoneDisplay && (
                      <button
                        type="button"
                        onClick={copyPhone}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700"
                      >
                        Copy number
                      </button>
                    )}
                    {unstarredCount > 0 && (
                      <button
                        type="button"
                        onClick={() => { setClearConfirm(true); setActionsOpen(false) }}
                        className="w-full text-left px-3 py-2 hover:bg-red-50 text-red-600"
                      >
                        Clear messages
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {clearConfirm && (
              <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
                  <h3 className="text-base font-semibold text-gray-800 mb-2">Clear messages?</h3>
                  <p className="text-sm text-gray-500 mb-1">
                    This will permanently delete <span className="font-medium text-gray-800">{unstarredCount} message{unstarredCount !== 1 ? 's' : ''}</span> and their media files from storage.
                  </p>
                  {starredCount > 0 && (
                    <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2 mb-4">
                      ⭐ {starredCount} starred message{starredCount !== 1 ? 's' : ''} will be kept.
                    </p>
                  )}
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => setClearConfirm(false)}
                      className="flex-1 border border-gray-300 text-gray-700 text-sm font-medium py-2 rounded-lg hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleClear}
                      disabled={clearing}
                      className="flex-1 bg-red-500 text-white text-sm font-medium py-2 rounded-lg hover:bg-red-600 disabled:opacity-50"
                    >
                      {clearing ? 'Clearing…' : 'Clear messages'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-auto p-4 space-y-2">
              {allMessages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  customerPhone={selectedCustomer?.phone}
                  onStar={msg.id.startsWith('tmp-') ? undefined : handleStar}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>

            {aiSuggestion && (
              <div className="mx-3 mb-2 bg-purple-50 border border-purple-200 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-purple-700">✨ AI suggested reply</span>
                  <button
                    onClick={() => setAiSuggestion(null)}
                    className="text-purple-400 hover:text-purple-600 text-xs"
                  >
                    ✕
                  </button>
                </div>
                <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{aiSuggestion}</p>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(aiSuggestion)
                      toast('Copied to clipboard', 'success')
                    }}
                    className="text-xs text-purple-600 hover:text-purple-800 border border-purple-200 rounded-lg px-2.5 py-1 hover:bg-purple-100"
                  >
                    Copy
                  </button>
                  <button
                    onClick={() => {
                      setText(aiSuggestion)
                      setAiSuggestion(null)
                    }}
                    className="text-xs text-white bg-purple-600 hover:bg-purple-700 rounded-lg px-2.5 py-1"
                  >
                    Use reply
                  </button>
                </div>
              </div>
            )}

            <div className="bg-white border-t border-gray-200 p-3 flex gap-2 items-end">
              <button
                onClick={handleAiSuggest}
                disabled={aiLoading}
                title="Get AI suggested reply"
                className="text-purple-500 hover:text-purple-700 hover:bg-purple-50 rounded-full w-10 h-10 flex items-center justify-center flex-shrink-0 disabled:opacity-40 transition-colors"
              >
                {aiLoading ? (
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                ) : '✨'}
              </button>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message… (Enter to send)"
                rows={1}
                className="flex-1 border border-gray-300 rounded-2xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
              />
              <button
                onClick={handleSend}
                disabled={!text.trim() || sending}
                className="bg-green-600 text-white rounded-full w-10 h-10 flex items-center justify-center hover:bg-green-700 disabled:opacity-40 flex-shrink-0"
              >
                ➤
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 flex-col gap-2">
            <div className="text-4xl">💬</div>
            <p className="text-sm">Select a conversation to start chatting</p>
            <button
              type="button"
              onClick={() => navigate('/customers')}
              className="text-sm text-green-600 hover:text-green-700 mt-2"
            >
              Add a customer to start a chat
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
