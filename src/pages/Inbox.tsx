import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useConversations, useMessages } from '../hooks/useConversations'
import { useCustomers } from '../hooks/useCustomers'
import { useEnquiries } from '../hooks/useEnquiries'
import { useUsers } from '../hooks/useUsers'
import { useAuthStore } from '../store/authStore'
import { sendMessageFn, assignEnquiryFn, uploadMediaFile } from '../lib/functions'
import { starMessage, clearConversationMessages, userLabel } from '../lib/db'
import { formatPhoneDisplay, telHref } from '../lib/phone'
import {
  collectAssigneeOptions,
  collectTagOptions,
  countActiveInboxFilters,
  DEFAULT_INBOX_FILTERS,
  inboxFilterSummaries,
  matchesActivity,
  matchesAssignee,
  matchesStatus,
  matchesTag,
  matchesUnread,
  type InboxFilters,
} from '../lib/inboxFilters'
import { formatConversationTime } from '../lib/datetime'
import { toast } from '../components/Toast'
import { MessageBubble } from '../components/MessageBubble'
import { SlashCommandPicker } from '../components/SlashCommandPicker'
import { parseSlashInput } from '../lib/slashCommands'
import { formatProductCaption } from '../lib/shopifyProducts'
import { InboxFiltersDialog } from '../components/InboxFiltersDialog'
import type { Conversation, EnquiryStatus, Message, SendableProduct } from '../types'

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
  const [filters, setFilters] = useState<InboxFilters>(DEFAULT_INBOX_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [optimistic, setOptimistic] = useState<Message[]>([])
  const [clearConfirm, setClearConfirm] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const actionsRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const slashKeyRef = useRef<((e: React.KeyboardEvent) => boolean) | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordingStreamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)

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
    setPendingFiles([])
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

  const customerById = useMemo(() => {
    const map = new Map(customers.map((c) => [c.id, c]))
    return map
  }, [customers])

  const customerName = (c: Conversation) =>
    customerById.get(c.customerId)?.name ?? c.customerId

  const customerAssignee = (c: Conversation) =>
    customerById.get(c.customerId)?.assignedTo?.trim() || null

  const customerStatus = (c: Conversation) =>
    statusByCustomer.get(c.customerId) ?? null

  const teamLabels = useMemo(
    () => users.map((u) => userLabel(u)).filter(Boolean),
    [users],
  )

  const assigneeOptions = useMemo(
    () => collectAssigneeOptions(customers, teamLabels),
    [customers, teamLabels],
  )

  const tagOptions = useMemo(() => collectTagOptions(customers), [customers])

  const activeFilterCount = countActiveInboxFilters(filters)
  const filterChips = inboxFilterSummaries(filters, meLabel)

  const matchesFilters = (c: Conversation) => {
    const customer = customerById.get(c.customerId)
    if (!matchesUnread(c, filters.unread)) return false
    if (!matchesAssignee(customerAssignee(c), filters.assignee, meLabel)) return false
    if (!matchesStatus(customerStatus(c), filters.status)) return false
    if (!matchesActivity(c.updatedAt, filters.activity)) return false
    if (!matchesTag(customer, filters.tag)) return false
    return true
  }

  const filtered = conversations.filter((c) => {
    if (!matchesFilters(c)) return false
    if (!search) return true
    const q = search.toLowerCase()
    const name = customerName(c).toLowerCase()
    const phone = customerById.get(c.customerId)?.phone ?? ''
    const assignee = customerAssignee(c)?.toLowerCase() ?? ''
    const status = customerStatus(c)?.replace(/_/g, ' ') ?? ''
    const tags = (customerById.get(c.customerId)?.tags ?? []).join(' ').toLowerCase()
    return (
      name.includes(q)
      || phone.includes(q)
      || assignee.includes(q)
      || status.includes(q)
      || tags.includes(q)
    )
  })

  const clearFilterKey = (key: keyof InboxFilters) => {
    setFilters((prev) => ({ ...prev, [key]: DEFAULT_INBOX_FILTERS[key] }))
  }

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
    if (!selected || sending || !conv) return
    if (parseSlashInput(text).open) return
    const hasText = !!text.trim()
    const hasFiles = pendingFiles.length > 0
    if (!hasText && !hasFiles) return

    const msgText = text.trim()
    const filesToSend = [...pendingFiles]
    setSending(true)
    setText('')
    setPendingFiles([])

    try {
      for (const file of filesToSend) {
        const mediaType = detectMediaType(file)
        const previewUrl = URL.createObjectURL(file)
        const tmpId = `tmp-${Date.now()}-${Math.random()}`
        const tmpMsg: Message = {
          id: tmpId,
          organizationId: conv.organizationId,
          conversationId: selected,
          sender: 'agent',
          type: mediaType,
          text: '',
          media: previewUrl,
          status: 'sent',
          timestamp: new Date().toISOString(),
        }
        setOptimistic((prev) => [...prev, tmpMsg])
        const mediaUrl = await uploadMediaFile(file)
        if (!mediaUrl) {
          setOptimistic((prev) => prev.filter((m) => m.id !== tmpId))
          toast(`Failed to upload ${file.name}`, 'error')
          continue
        }
        await sendMessageFn({ conversationId: selected, mediaUrl, mediaType })
        setOptimistic((prev) => prev.filter((m) => m.id !== tmpId))
      }

      if (hasText) {
        const tmpMsg: Message = {
          id: `tmp-${Date.now()}`,
          organizationId: conv.organizationId,
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
        }
      }
    } finally {
      setSending(false)
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files)
    if (files.length > 0) {
      e.preventDefault()
      setPendingFiles((prev) => [...prev, ...files])
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length > 0) setPendingFiles((prev) => [...prev, ...files])
    e.target.value = ''
  }

  useEffect(() => {
    if (!isRecording) return
    const id = setInterval(() => setRecordingSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [isRecording])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      recordingStreamRef.current = stream
      const mimeType =
        MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus'
        : 'audio/webm'
      const mr = new MediaRecorder(stream, { mimeType })
      chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: mr.mimeType })
        const ext = mr.mimeType.includes('ogg') ? 'ogg' : 'webm'
        const file = new File([blob], `voice-message.${ext}`, { type: mr.mimeType })
        setPendingFiles((prev) => [...prev, file])
        setIsRecording(false)
        setRecordingSeconds(0)
      }
      mr.start()
      mediaRecorderRef.current = mr
      setIsRecording(true)
      setRecordingSeconds(0)
    } catch {
      toast('Microphone access denied', 'error')
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
  }

  const cancelRecording = () => {
    const mr = mediaRecorderRef.current
    if (!mr) return
    mr.onstop = null
    mr.stop()
    recordingStreamRef.current?.getTracks().forEach((t) => t.stop())
    setIsRecording(false)
    setRecordingSeconds(0)
  }

  const handleSendProduct = async (product: SendableProduct) => {
    if (!selected || sending || !conv) return
    const caption = formatProductCaption(product)
    const mediaUrl = product.imageUrl?.trim() || undefined
    setSending(true)
    setText('')

    const tmpMsg: Message = {
      id: `tmp-${Date.now()}`,
      organizationId: conv.organizationId,
      conversationId: selected,
      sender: 'agent',
      type: mediaUrl ? 'image' : 'text',
      text: caption,
      media: mediaUrl,
      status: 'sent',
      timestamp: new Date().toISOString(),
    }
    setOptimistic((prev) => [...prev, tmpMsg])

    try {
      await sendMessageFn({
        conversationId: selected,
        text: caption,
        ...(mediaUrl ? { mediaUrl, mediaType: 'image' } : {}),
      })
    } catch {
      setOptimistic((prev) => prev.filter((m) => m.id !== tmpMsg.id))
      toast('Failed to send product', 'error')
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (slashKeyRef.current?.(e)) return
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
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-gray-800">Inbox</h2>
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
                activeFilterCount > 0
                  ? 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100'
                  : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
              }`}
              aria-label="Open conversation filters"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M2 3.5h12M4 8h8M6 12.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Filters
              {activeFilterCount > 0 && (
                <span className="bg-green-600 text-white text-[10px] min-w-[16px] h-4 px-1 rounded-full inline-flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations…"
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50"
          />
          {filterChips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {filterChips.map((chip) => (
                <button
                  key={`${chip.key}-${chip.label}`}
                  type="button"
                  onClick={() => clearFilterKey(chip.key)}
                  className="inline-flex items-center gap-1 max-w-full bg-green-50 text-green-800 text-[11px] px-2 py-0.5 rounded-full hover:bg-green-100"
                  title={`Remove ${chip.label} filter`}
                >
                  <span className="truncate">{chip.label}</span>
                  <span aria-hidden className="text-green-600">×</span>
                </button>
              ))}
              {activeFilterCount > 1 && (
                <button
                  type="button"
                  onClick={() => setFilters({ ...DEFAULT_INBOX_FILTERS })}
                  className="text-[11px] text-gray-500 hover:text-gray-700 px-1"
                >
                  Clear all
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-auto">
          {loading && <p className="text-sm text-gray-400 p-4">Loading…</p>}
          {!loading && filtered.length === 0 && (
            <p className="text-sm text-gray-400 p-4">
              {search || activeFilterCount > 0 ? 'No matches.' : 'No conversations yet.'}
            </p>
          )}
          {filtered.map((c) => {
            const assignee = customerAssignee(c)
            const status = customerStatus(c)
            const cust = customerById.get(c.customerId)
            return (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                className={`w-full text-left px-3 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                  selected === c.id ? 'bg-green-50' : ''
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <div className="w-10 h-10 rounded-full flex-shrink-0 overflow-hidden bg-green-100 flex items-center justify-center text-green-700 font-bold text-sm">
                    {cust?.profilePicUrl ? (
                      <img src={cust.profilePicUrl} alt="" className="w-full h-full object-cover" />
                    ) : cust?.isGroup ? (
                      <span className="text-base">👥</span>
                    ) : (
                      customerName(c)[0]?.toUpperCase()
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm text-gray-800 truncate">{customerName(c)}</span>
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        {formatConversationTime(c.updatedAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5 gap-2">
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
                  </div>
                </div>
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
              <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-sm flex-shrink-0 overflow-hidden">
                {selectedCustomer?.profilePicUrl ? (
                  <img src={selectedCustomer.profilePicUrl} alt="" className="w-full h-full object-cover" />
                ) : selectedCustomer?.isGroup ? (
                  <span className="text-base">👥</span>
                ) : (
                  customerName(conv)[0]?.toUpperCase()
                )}
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
                  isGroup={selectedCustomer?.isGroup}
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

            <div className="relative bg-white border-t border-gray-200 p-3">
              <SlashCommandPicker
                text={text}
                onChange={setText}
                onSendProduct={handleSendProduct}
                onKeyIntercept={(handler) => { slashKeyRef.current = handler }}
              />
              {pendingFiles.length > 0 && (
                <div className="flex gap-2 flex-wrap mb-2 p-2 bg-gray-50 rounded-xl">
                  {pendingFiles.map((f, i) => (
                    <PendingFilePreview
                      key={i}
                      file={f}
                      onRemove={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
                    />
                  ))}
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xlsx,.xls,.csv,.txt"
                onChange={handleFileChange}
              />
              {isRecording ? (
                <div className="flex items-center gap-3 h-10">
                  <button
                    onClick={cancelRecording}
                    title="Cancel recording"
                    className="text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full w-10 h-10 flex items-center justify-center flex-shrink-0 transition-colors text-base"
                  >
                    ✕
                  </button>
                  <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-2xl">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                    <span className="text-sm font-mono text-red-600">{fmtRecordingTime(recordingSeconds)}</span>
                    <span className="text-xs text-red-400">Recording…</span>
                  </div>
                  <button
                    onClick={stopRecording}
                    title="Stop and attach"
                    className="bg-green-600 text-white rounded-full w-10 h-10 flex items-center justify-center hover:bg-green-700 flex-shrink-0 text-base"
                  >
                    ✓
                  </button>
                </div>
              ) : (
                <div className="flex gap-2 items-end">
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
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    title="Attach file"
                    className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full w-10 h-10 flex items-center justify-center flex-shrink-0 transition-colors text-lg"
                  >
                    📎
                  </button>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder="Type a message…  /products  /reply"
                    rows={1}
                    className="flex-1 border border-gray-300 rounded-2xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                  />
                  {!text.trim() && pendingFiles.length === 0 ? (
                    <button
                      onClick={startRecording}
                      title="Record voice message"
                      className="text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-full w-10 h-10 flex items-center justify-center flex-shrink-0 transition-colors text-lg"
                    >
                      🎤
                    </button>
                  ) : (
                    <button
                      onClick={handleSend}
                      disabled={sending || parseSlashInput(text).open}
                      className="bg-green-600 text-white rounded-full w-10 h-10 flex items-center justify-center hover:bg-green-700 disabled:opacity-40 flex-shrink-0"
                    >
                      ➤
                    </button>
                  )}
                </div>
              )}
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

      <InboxFiltersDialog
        open={filtersOpen}
        value={filters}
        meLabel={meLabel}
        assigneeOptions={assigneeOptions}
        tagOptions={tagOptions}
        onClose={() => setFiltersOpen(false)}
        onApply={(next) => {
          setFilters(next)
          setFiltersOpen(false)
        }}
      />
    </div>
  )
}

function fmtRecordingTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function detectMediaType(file: File): 'image' | 'video' | 'audio' | 'document' {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return 'document'
}

function PendingFilePreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    setObjectUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const isImage = file.type.startsWith('image/')
  const isAudio = file.type.startsWith('audio/')

  if (isAudio && objectUrl) {
    return (
      <div className="relative flex items-center gap-2 bg-gray-100 border border-gray-200 rounded-xl px-3 py-2 pr-6 max-w-[220px]">
        <span className="text-lg flex-shrink-0">🎤</span>
        <audio controls src={objectUrl} className="h-7 w-32" />
        <button
          onClick={onRemove}
          className="absolute -top-1 -right-1 bg-red-500 hover:bg-red-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] leading-none"
        >
          ✕
        </button>
      </div>
    )
  }

  return (
    <div className="relative flex-shrink-0">
      {isImage && objectUrl ? (
        <img src={objectUrl} alt={file.name} className="w-16 h-16 object-cover rounded-lg border border-gray-200" />
      ) : (
        <div className="w-16 h-16 rounded-lg border border-gray-200 bg-gray-100 flex flex-col items-center justify-center p-1 gap-0.5">
          <span className="text-xl leading-none">📄</span>
          <span className="text-[9px] text-gray-500 truncate w-full text-center leading-tight">{file.name}</span>
        </div>
      )}
      <button
        onClick={onRemove}
        className="absolute -top-1 -right-1 bg-red-500 hover:bg-red-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] leading-none"
      >
        ✕
      </button>
    </div>
  )
}
