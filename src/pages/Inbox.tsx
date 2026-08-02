import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useConversations, useMessages } from '../hooks/useConversations'
import { useCustomers } from '../hooks/useCustomers'
import { sendMessageFn } from '../lib/functions'
import { toast } from '../components/Toast'
import { MessageBubble } from '../components/MessageBubble'
import type { Conversation, Message } from '../types'

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
  const [selected, setSelected] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [search, setSearch] = useState('')
  const [optimistic, setOptimistic] = useState<Message[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const messages = useMessages(selected)
  const conv = conversations.find((c) => c.id === selected)

  // Purge optimistic messages that now exist in the real data
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

  // Clear unread count — depends on both selected and conversations
  useEffect(() => {
    if (!selected) return
    const c = conversations.find((cv) => cv.id === selected)
    if (c && c.unreadCount > 0) {
      supabase.from('conversations').update({ unread_count: 0 }).eq('id', selected).then(() => {})
    }
  }, [selected, conversations])

  const customerName = (c: Conversation) =>
    customers.find((cu) => cu.id === c.customerId)?.name ?? c.customerId

  const filtered = conversations.filter((c) =>
    search ? customerName(c).toLowerCase().includes(search.toLowerCase()) : true
  )

  // Combined and sorted message list (real + optimistic)
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

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-72 border-r border-gray-200 bg-white flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-gray-200 space-y-2">
          <h2 className="font-semibold text-gray-800">Inbox</h2>
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
              {search ? 'No matches.' : 'No conversations yet.'}
            </p>
          )}
          {filtered.map((c) => (
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
            </button>
          ))}
        </div>
      </div>

      {/* Chat pane */}
      <div className="flex-1 flex flex-col bg-gray-50 min-w-0">
        {conv ? (
          <>
            <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-sm flex-shrink-0">
                {customerName(conv)[0]?.toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-medium text-sm text-gray-800 truncate">{customerName(conv)}</p>
                <p className="text-xs text-gray-500">
                  {customers.find((c) => c.id === conv.customerId)?.phone}
                </p>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-2">
              {allMessages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  customerPhone={customers.find((c) => c.id === conv.customerId)?.phone}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="bg-white border-t border-gray-200 p-3 flex gap-2">
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
          </div>
        )}
      </div>
    </div>
  )
}
